/** Durable runtime permission enforcement for every governed task and skill path. */
import { createHash } from "node:crypto";
import { posix, join } from "node:path";
import type { ToolInvocation, ToolInvocationLog } from "./types.js";
import { getAgentRegistry, type AgentConfig, type AgentRegistry } from "./agentRegistry.js";
import { ToolGateStore, type DurableToolGateCapability } from "./toolGateStore.js";

export { ToolInvocation, ToolInvocationLog };

type AuthorizationRequest = {
  action: "preflight" | "execute";
  subjectType: "skill" | "task";
  subjectId: string;
  agentId: string;
  args?: Record<string, unknown>;
  scopeId?: string;
  fileRead?: boolean;
  fileWrite?: boolean;
  network?: boolean;
  skipSubjectPolicy?: boolean;
};

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function defaultStatePath(): string {
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return ":memory:";
  const explicit = process.env.OPENCLAW_TOOLGATE_DATABASE_PATH?.trim();
  if (explicit) return explicit;
  const stateRoot = process.env.OPENCLAW_OPERATOR_STATE_DIR?.trim();
  return stateRoot ? join(stateRoot, "database", "toolgate.sqlite") : join(process.cwd(), "data", "toolgate.sqlite");
}

export class ToolGate {
  private invocationLog: ToolInvocation[] = [];
  private agentRegistry: AgentRegistry | null = null;
  private store: ToolGateStore | null = null;

  constructor(private readonly options: { statePath?: string; agentRegistry?: AgentRegistry } = {}) {}

  private normalizeBoundaryPath(value: string): string {
    const sanitizedValue = value.replace(/\\/g, "/").trim();
    if (!sanitizedValue) return "";
    const normalizedValue = posix.normalize(sanitizedValue).replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/$/, "");
    return normalizedValue === "." ? "" : normalizedValue;
  }

  private pathMatchesBoundary(targetPath: string, boundary: string): boolean {
    const target = this.normalizeBoundaryPath(targetPath);
    const allowed = this.normalizeBoundaryPath(boundary);
    return Boolean(target && allowed && (target === allowed || target.startsWith(`${allowed}/`) || target.endsWith(`/${allowed}`) || target.includes(`/${allowed}/`)));
  }

  async initialize(): Promise<void> {
    this.agentRegistry = this.options.agentRegistry ?? await getAgentRegistry();
    this.store = new ToolGateStore(this.options.statePath ?? defaultStatePath());
    for (const agent of this.agentRegistry.listAgents()) this.store.registerPolicy(agent.id, this.policy(agent));
    console.log(`[ToolGate] durable enforcement initialized (${this.store.path})`);
  }

  close(): void {
    this.store?.close();
    this.store = null;
  }

  capabilities(): {
    executionMode: "inline_capability_enforcement";
    auditPersistence: "sqlite_hash_chain";
    hostContainment: false;
    enforcedPolicies: string[];
    declaredButNotEnforced: string[];
    decisionChainValid: boolean;
  } {
    return { executionMode: "inline_capability_enforcement", auditPersistence: "sqlite_hash_chain", hostContainment: false, enforcedPolicies: ["agent-exists", "task-assignment", "skill-allowlist", "skill-max-calls", "network-domain-allowlist", "read-path-allowlist", "write-path-allowlist", "single-use-execution-capability", "durable-denial"], declaredButNotEnforced: [], decisionChainValid: this.requireStore().verifyDecisionChain() };
  }

  private policy(agent: AgentConfig): unknown {
    return { agentId: agent.id, tasks: agent.orchestratorTasks?.length ? agent.orchestratorTasks : agent.orchestratorTask ? [agent.orchestratorTask] : [], permissions: agent.permissions ?? {}, constraints: agent.constraints ?? {} };
  }

  private scope(args: Record<string, unknown> = {}, explicit?: string): string {
    const candidate = explicit ?? (typeof args.scopeId === "string" ? args.scopeId : typeof args.taskId === "string" ? args.taskId : typeof args.runId === "string" ? args.runId : undefined);
    return candidate?.trim() || new Date().toISOString().slice(0, 10);
  }

  private targetPath(args: Record<string, unknown>, access: "read" | "write" | "any" = "any"): string | null {
    const keys = access === "read"
      ? ["filePath", "inputPath", "path", "targetPath", "outputPath"]
      : access === "write"
        ? ["outputPath", "targetPath", "filePath", "path"]
        : ["filePath", "inputPath", "outputPath", "targetPath", "path"];
    for (const key of keys) if (typeof args[key] === "string" && String(args[key]).trim()) return String(args[key]);
    return null;
  }

  private targetUrl(args: Record<string, unknown>): URL | null {
    for (const key of ["url", "uri", "endpoint"]) {
      if (typeof args[key] !== "string") continue;
      try { return new URL(String(args[key])); } catch { return null; }
    }
    return null;
  }

  private evaluate(request: AuthorizationRequest): { allowed: boolean; reason?: string; policyHash: string; scopeId: string; requestHash: string } {
    const registry = this.agentRegistry;
    const store = this.requireStore();
    const args = request.args ?? {};
    const scopeId = this.scope(args, request.scopeId);
    const readPath = this.targetPath(args, "read");
    const writePath = this.targetPath(args, "write");
    const digest = requestHash({ agentId: request.agentId, subjectId: request.subjectId, subjectType: request.subjectType, action: request.action, scopeId, keys: Object.keys(args).sort(), readPath, writePath, targetUrl: this.targetUrl(args)?.toString() ?? null });
    const policyHash = store.policyHash(request.agentId) ?? requestHash({ missingPolicy: request.agentId });
    if (!registry) return { allowed: false, reason: "Agent registry unavailable", policyHash, scopeId, requestHash: digest };
    const agent = registry.getAgent(request.agentId);
    if (!agent) return { allowed: false, reason: `Agent not found: ${request.agentId}`, policyHash, scopeId, requestHash: digest };
    if (!request.skipSubjectPolicy && request.subjectType === "task") {
      const tasks = agent.orchestratorTasks?.length ? agent.orchestratorTasks : agent.orchestratorTask ? [agent.orchestratorTask] : [];
      if (tasks.length > 0 && !tasks.includes(request.subjectId)) return { allowed: false, reason: `Agent ${request.agentId} not assigned to task ${request.subjectId}`, policyHash, scopeId, requestHash: digest };
    } else if (!request.skipSubjectPolicy) {
      const permission = agent.permissions?.skills?.[request.subjectId];
      if (permission?.allowed !== true) return { allowed: false, reason: `Skill not in agent allowlist: ${request.subjectId}`, policyHash, scopeId, requestHash: digest };
      if (request.action === "execute" && typeof permission.maxCalls === "number" && store.consumedCount(request.agentId, request.subjectId, "skill", scopeId) >= permission.maxCalls) return { allowed: false, reason: `Skill call ceiling exhausted: ${request.subjectId}`, policyHash, scopeId, requestHash: digest };
    }
    if (request.fileRead && readPath && !(agent.permissions?.fileSystem?.readPaths ?? []).some((boundary) => this.pathMatchesBoundary(readPath, boundary))) return { allowed: false, reason: `Path not in agent manifest read allowlist: ${readPath}`, policyHash, scopeId, requestHash: digest };
    if (request.fileWrite && writePath && !(agent.permissions?.fileSystem?.writePaths ?? []).some((boundary) => this.pathMatchesBoundary(writePath, boundary))) return { allowed: false, reason: `Path not in agent manifest write allowlist: ${writePath}`, policyHash, scopeId, requestHash: digest };
    const url = this.targetUrl(args);
    if (request.network || url) {
      if (agent.permissions?.network?.allowed !== true) return { allowed: false, reason: `Agent ${request.agentId} has no network authority`, policyHash, scopeId, requestHash: digest };
      const domains = agent.permissions.network.allowedDomains ?? [];
      if (url && domains.length > 0 && !domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return { allowed: false, reason: `Network domain not in agent manifest allowlist: ${url.hostname}`, policyHash, scopeId, requestHash: digest };
    }
    return { allowed: true, policyHash, scopeId, requestHash: digest };
  }

  private decide(request: AuthorizationRequest) {
    const evaluated = this.evaluate(request);
    return this.requireStore().recordDecision({ agentId: request.agentId, subjectId: request.subjectId, subjectType: request.subjectType, action: request.action, scopeId: evaluated.scopeId, allowed: evaluated.allowed, reason: evaluated.reason, policyHash: evaluated.policyHash, requestHash: evaluated.requestHash });
  }

  canExecuteTask(agentId: string, taskType: string): { allowed: boolean; reason?: string } {
    const decision = this.decide({ agentId, subjectId: taskType, subjectType: "task", action: "preflight" });
    return { allowed: decision.allowed, reason: decision.reason };
  }

  canReadPath(agentId: string, targetPath: string): { allowed: boolean; reason?: string } {
    const decision = this.decide({ agentId, subjectId: "filesystem.read", subjectType: "task", action: "preflight", args: { filePath: targetPath }, fileRead: true, skipSubjectPolicy: true });
    return { allowed: decision.allowed, reason: decision.reason };
  }

  canWritePath(agentId: string, targetPath: string): { allowed: boolean; reason?: string } {
    const decision = this.decide({ agentId, subjectId: "filesystem.write", subjectType: "task", action: "preflight", args: { filePath: targetPath }, fileWrite: true, skipSubjectPolicy: true });
    return { allowed: decision.allowed, reason: decision.reason };
  }

  async preflightSkillAccess(agentId: string, skillId: string, args: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const decision = this.decide({ agentId, subjectId: skillId, subjectType: "skill", action: "preflight", args });
    this.log(agentId, skillId, args, decision.allowed, decision.reason);
    return decision.allowed ? { success: true, data: { authorized: true, mode: "preflight", skillId, decisionId: decision.decisionId } } : { success: false, error: decision.reason ?? "Permission denied" };
  }

  authorizeSkillExecution(agentId: string, skillId: string, args: Record<string, unknown>, requirements: { fileRead?: boolean; fileWrite?: boolean; network?: boolean; scopeId?: string } = {}): { success: boolean; capability?: DurableToolGateCapability; error?: string } {
    const decision = this.decide({ agentId, subjectId: skillId, subjectType: "skill", action: "execute", args, ...requirements });
    this.log(agentId, skillId, args, decision.allowed, decision.reason);
    return decision.allowed ? { success: true, capability: this.requireStore().issueCapability(decision) } : { success: false, error: decision.reason ?? "Permission denied" };
  }

  authorizeTaskExecution(agentId: string, taskType: string, args: Record<string, unknown> = {}): { success: boolean; capability?: DurableToolGateCapability; error?: string } {
    const decision = this.decide({ agentId, subjectId: taskType, subjectType: "task", action: "execute", args, scopeId: typeof args.taskId === "string" ? args.taskId : undefined });
    return decision.allowed ? { success: true, capability: this.requireStore().issueCapability(decision) } : { success: false, error: decision.reason ?? "Permission denied" };
  }

  completeExecutionCapability(capabilityId: string, status: "consumed" | "failed" | "revoked" = "consumed"): DurableToolGateCapability {
    return this.requireStore().completeCapability(capabilityId, status);
  }

  async executeSkill(agentId: string, skillId: string, args: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> {
    return this.preflightSkillAccess(agentId, skillId, args);
  }

  getLog(): ToolInvocationLog { return { success: true, invocations: structuredClone(this.invocationLog), deniedCount: this.invocationLog.filter((item) => !item.allowed).length, allowedCount: this.invocationLog.filter((item) => item.allowed).length }; }
  getLogForAgent(agentId: string): ToolInvocation[] { return this.getLog().invocations.filter((item) => item.agentId === agentId); }
  getLogForSkill(skillId: string): ToolInvocation[] { return this.getLog().invocations.filter((item) => item.skillId === skillId); }
  getDeniedInvocations(): ToolInvocation[] { return this.getLog().invocations.filter((item) => !item.allowed); }
  clearLog(): void { this.invocationLog = []; }
  exportLog(): string { return JSON.stringify({ timestamp: new Date().toISOString(), durable: this.requireStore().stats(), ...this.getLog() }, null, 2); }
  durableStats() { return this.requireStore().stats(); }

  private log(agentId: string, skillId: string, args: Record<string, unknown>, allowed: boolean, reason?: string): void {
    this.invocationLog.push({ id: `${agentId}/${skillId}/${Date.now()}`, agentId, skillId, args: { keys: Object.keys(args).sort() }, timestamp: new Date().toISOString(), mode: typeof args.mode === "string" ? args.mode : undefined, taskType: typeof args.taskType === "string" ? args.taskType : undefined, allowed, reason });
  }

  private requireStore(): ToolGateStore {
    if (!this.store) throw new Error("ToolGate not initialized");
    return this.store;
  }
}

let gate: ToolGate | null = null;
let gateInitialization: Promise<ToolGate> | null = null;

export async function getToolGate(): Promise<ToolGate> {
  if (gate) return gate;
  if (!gateInitialization) gateInitialization = (async () => { const initialized = new ToolGate(); await initialized.initialize(); gate = initialized; return initialized; })().finally(() => { gateInitialization = null; });
  return gateInitialization;
}

export function resetToolGateForTest(): void {
  gate?.close();
  gate = null;
  gateInitialization = null;
}
