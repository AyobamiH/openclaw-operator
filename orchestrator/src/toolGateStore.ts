import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type SqliteDatabase = InstanceType<typeof DatabaseSync>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function secure(path: string): void {
  if (path === ":memory:" || !existsSync(path)) return;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("toolgate_state_path_unsafe");
  if ((stat.mode & 0o777) !== 0o600) chmodSync(path, 0o600);
}

export type DurableToolGateDecision = {
  decisionId: string;
  agentId: string;
  subjectId: string;
  subjectType: "skill" | "task";
  action: "preflight" | "execute";
  scopeId: string;
  allowed: boolean;
  reason?: string;
  policyHash: string;
  requestHash: string;
  decidedAt: string;
  previousHash: string | null;
  decisionHash: string;
};

export type DurableToolGateCapability = {
  capabilityId: string;
  decisionId: string;
  agentId: string;
  subjectId: string;
  subjectType: "skill" | "task";
  scopeId: string;
  policyHash: string;
  requestHash: string;
  status: "issued" | "consumed" | "failed" | "revoked";
  issuedAt: string;
  consumedAt?: string;
};

export class ToolGateStore {
  private readonly database: SqliteDatabase;

  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS toolgate_meta(schema_version INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS toolgate_policies(
        policy_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, policy_hash TEXT NOT NULL,
        policy_json TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)), created_at TEXT NOT NULL,
        UNIQUE(agent_id, policy_hash)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS toolgate_active_policy_idx ON toolgate_policies(agent_id) WHERE active=1;
      CREATE TABLE IF NOT EXISTS toolgate_decisions(
        decision_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, subject_id TEXT NOT NULL,
        subject_type TEXT NOT NULL CHECK(subject_type IN ('skill','task')),
        action TEXT NOT NULL CHECK(action IN ('preflight','execute')), scope_id TEXT NOT NULL,
        allowed INTEGER NOT NULL CHECK(allowed IN (0,1)), reason TEXT, policy_hash TEXT NOT NULL,
        request_hash TEXT NOT NULL, decided_at TEXT NOT NULL, previous_hash TEXT, decision_hash TEXT NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS toolgate_decisions_subject_idx ON toolgate_decisions(agent_id,subject_id,subject_type,scope_id,decided_at);
      CREATE TABLE IF NOT EXISTS toolgate_capabilities(
        capability_id TEXT PRIMARY KEY, decision_id TEXT NOT NULL UNIQUE, agent_id TEXT NOT NULL,
        subject_id TEXT NOT NULL, subject_type TEXT NOT NULL CHECK(subject_type IN ('skill','task')),
        scope_id TEXT NOT NULL, policy_hash TEXT NOT NULL, request_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('issued','consumed','failed','revoked')),
        issued_at TEXT NOT NULL, consumed_at TEXT,
        FOREIGN KEY(decision_id) REFERENCES toolgate_decisions(decision_id)
      );
      CREATE INDEX IF NOT EXISTS toolgate_capabilities_usage_idx ON toolgate_capabilities(agent_id,subject_id,subject_type,scope_id,status);
      CREATE TRIGGER IF NOT EXISTS toolgate_decisions_immutable_update BEFORE UPDATE ON toolgate_decisions BEGIN SELECT RAISE(ABORT,'toolgate decisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS toolgate_decisions_immutable_delete BEFORE DELETE ON toolgate_decisions BEGIN SELECT RAISE(ABORT,'toolgate decisions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS toolgate_capability_bindings_immutable BEFORE UPDATE OF capability_id,decision_id,agent_id,subject_id,subject_type,scope_id,policy_hash,request_hash,issued_at ON toolgate_capabilities BEGIN SELECT RAISE(ABORT,'toolgate capability bindings are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS toolgate_capability_terminal_immutable BEFORE UPDATE ON toolgate_capabilities WHEN OLD.status IN ('consumed','failed','revoked') BEGIN SELECT RAISE(ABORT,'toolgate terminal capability is immutable'); END;
    `);
    const meta = this.database.prepare("SELECT schema_version FROM toolgate_meta").all() as Array<{ schema_version: number }>;
    if (meta.length === 0) this.database.prepare("INSERT INTO toolgate_meta(schema_version,created_at) VALUES (1,?)").run(new Date().toISOString());
    else if (meta.length !== 1 || Number(meta[0]?.schema_version) !== 1) throw new Error("toolgate_schema_version_unsupported");
    secure(path);
  }

  close(): void {
    this.database.close();
    secure(this.path);
  }

  registerPolicy(agentId: string, policy: unknown): string {
    const policyJson = JSON.stringify(policy);
    const policyHash = hash(policy);
    const current = this.database.prepare("SELECT policy_hash FROM toolgate_policies WHERE agent_id=? AND active=1").get(agentId) as { policy_hash?: string } | undefined;
    if (current?.policy_hash === policyHash) return policyHash;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE toolgate_policies SET active=0 WHERE agent_id=? AND active=1").run(agentId);
      this.database.prepare("INSERT INTO toolgate_policies(policy_id,agent_id,policy_hash,policy_json,active,created_at) VALUES (?,?,?,?,1,?) ON CONFLICT(agent_id,policy_hash) DO UPDATE SET active=1").run(`tgp_${randomUUID()}`, agentId, policyHash, policyJson, new Date().toISOString());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return policyHash;
  }

  policyHash(agentId: string): string | null {
    const row = this.database.prepare("SELECT policy_hash FROM toolgate_policies WHERE agent_id=? AND active=1").get(agentId) as { policy_hash?: string } | undefined;
    return row?.policy_hash ?? null;
  }

  recordDecision(input: Omit<DurableToolGateDecision, "decisionId" | "decidedAt" | "previousHash" | "decisionHash">): DurableToolGateDecision {
    const previousHash = (this.database.prepare("SELECT decision_hash FROM toolgate_decisions ORDER BY rowid DESC LIMIT 1").get() as { decision_hash?: string } | undefined)?.decision_hash ?? null;
    const decision = { ...input, decisionId: `tgd_${randomUUID()}`, decidedAt: new Date().toISOString(), previousHash, decisionHash: "" };
    decision.decisionHash = hash({ ...decision, decisionHash: undefined });
    this.database.prepare("INSERT INTO toolgate_decisions(decision_id,agent_id,subject_id,subject_type,action,scope_id,allowed,reason,policy_hash,request_hash,decided_at,previous_hash,decision_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(decision.decisionId, decision.agentId, decision.subjectId, decision.subjectType, decision.action, decision.scopeId, decision.allowed ? 1 : 0, decision.reason ?? null, decision.policyHash, decision.requestHash, decision.decidedAt, decision.previousHash, decision.decisionHash);
    return decision;
  }

  issueCapability(decision: DurableToolGateDecision): DurableToolGateCapability {
    if (!decision.allowed || decision.action !== "execute") throw new Error("toolgate_capability_requires_allowed_execute_decision");
    const capability: DurableToolGateCapability = { capabilityId: `tgc_${randomUUID()}`, decisionId: decision.decisionId, agentId: decision.agentId, subjectId: decision.subjectId, subjectType: decision.subjectType, scopeId: decision.scopeId, policyHash: decision.policyHash, requestHash: decision.requestHash, status: "issued", issuedAt: new Date().toISOString() };
    this.database.prepare("INSERT INTO toolgate_capabilities(capability_id,decision_id,agent_id,subject_id,subject_type,scope_id,policy_hash,request_hash,status,issued_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(capability.capabilityId, capability.decisionId, capability.agentId, capability.subjectId, capability.subjectType, capability.scopeId, capability.policyHash, capability.requestHash, capability.status, capability.issuedAt);
    return capability;
  }

  completeCapability(capabilityId: string, status: "consumed" | "failed" | "revoked"): DurableToolGateCapability {
    const consumedAt = new Date().toISOString();
    const result = this.database.prepare("UPDATE toolgate_capabilities SET status=?,consumed_at=? WHERE capability_id=? AND status='issued'").run(status, consumedAt, capabilityId);
    if (Number(result.changes) !== 1) throw new Error("toolgate_capability_not_issued");
    return this.capability(capabilityId)!;
  }

  capability(capabilityId: string): DurableToolGateCapability | null {
    const row = this.database.prepare("SELECT * FROM toolgate_capabilities WHERE capability_id=?").get(capabilityId) as Record<string, unknown> | undefined;
    return row ? this.mapCapability(row) : null;
  }

  consumedCount(agentId: string, subjectId: string, subjectType: "skill" | "task", scopeId: string): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM toolgate_capabilities WHERE agent_id=? AND subject_id=? AND subject_type=? AND scope_id=? AND status='consumed'").get(agentId, subjectId, subjectType, scopeId) as { count: number };
    return Number(row.count);
  }

  decisions(): DurableToolGateDecision[] {
    return (this.database.prepare("SELECT * FROM toolgate_decisions ORDER BY rowid").all() as Record<string, unknown>[]).map((row) => ({ decisionId: String(row.decision_id), agentId: String(row.agent_id), subjectId: String(row.subject_id), subjectType: String(row.subject_type) as "skill" | "task", action: String(row.action) as "preflight" | "execute", scopeId: String(row.scope_id), allowed: Number(row.allowed) === 1, reason: row.reason === null ? undefined : String(row.reason), policyHash: String(row.policy_hash), requestHash: String(row.request_hash), decidedAt: String(row.decided_at), previousHash: row.previous_hash === null ? null : String(row.previous_hash), decisionHash: String(row.decision_hash) }));
  }

  verifyDecisionChain(): boolean {
    let previous: string | null = null;
    for (const decision of this.decisions()) {
      if (decision.previousHash !== previous) return false;
      if (hash({ ...decision, decisionHash: undefined }) !== decision.decisionHash) return false;
      previous = decision.decisionHash;
    }
    return true;
  }

  stats(): { decisions: number; denials: number; issued: number; consumed: number; chainValid: boolean } {
    const decisions = this.decisions();
    const caps = this.database.prepare("SELECT status,COUNT(*) AS count FROM toolgate_capabilities GROUP BY status").all() as Array<{ status: string; count: number }>;
    return { decisions: decisions.length, denials: decisions.filter((item) => !item.allowed).length, issued: Number(caps.find((item) => item.status === "issued")?.count ?? 0), consumed: Number(caps.find((item) => item.status === "consumed")?.count ?? 0), chainValid: this.verifyDecisionChain() };
  }

  private mapCapability(row: Record<string, unknown>): DurableToolGateCapability {
    return { capabilityId: String(row.capability_id), decisionId: String(row.decision_id), agentId: String(row.agent_id), subjectId: String(row.subject_id), subjectType: String(row.subject_type) as "skill" | "task", scopeId: String(row.scope_id), policyHash: String(row.policy_hash), requestHash: String(row.request_hash), status: String(row.status) as DurableToolGateCapability["status"], issuedAt: String(row.issued_at), consumedAt: row.consumed_at === null ? undefined : String(row.consumed_at) };
  }
}
