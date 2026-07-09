/**
 * Tool Gate - Runtime Permission Enforcement
 *
 * ToolGate is a runtime authorization and audit preflight. It does not execute
 * skill bodies or provide host-level containment; it validates task/skill
 * intent and records the attempt for audit.
 */

import { posix } from 'node:path';
import type { ToolInvocation, ToolInvocationLog } from './types.js';
import { getAgentRegistry } from './agentRegistry.js';

export { ToolInvocation, ToolInvocationLog };

export class ToolGate {
  private invocationLog: ToolInvocation[] = [];
  private agentRegistry: Awaited<ReturnType<typeof getAgentRegistry>> | null = null;

  private normalizeBoundaryPath(value: string): string {
    const sanitizedValue = value.replace(/\\/g, '/').trim();
    if (!sanitizedValue) {
      return '';
    }

    const normalizedValue = posix.normalize(sanitizedValue)
      .replace(/^\.\//, '')
      .replace(/^\/+/, '')
      .replace(/\/$/, '');

    return normalizedValue === '.' ? '' : normalizedValue;
  }

  private pathMatchesBoundary(targetPath: string, boundary: string): boolean {
    const normalizedTarget = this.normalizeBoundaryPath(targetPath);
    const normalizedBoundary = this.normalizeBoundaryPath(boundary);

    if (!normalizedTarget || !normalizedBoundary) {
      return false;
    }

    return normalizedTarget === normalizedBoundary
      || normalizedTarget.startsWith(`${normalizedBoundary}/`)
      || normalizedTarget.endsWith(`/${normalizedBoundary}`)
      || normalizedTarget.includes(`/${normalizedBoundary}/`);
  }

  async initialize(): Promise<void> {
    this.agentRegistry = await getAgentRegistry();
    console.log('[ToolGate] Initialized');
  }

  /**
   * Check if an agent can call a skill
   */
  private canCall(agentId: string, skillId: string): { allowed: boolean; reason?: string } {
    if (!this.agentRegistry) {
      return {
        allowed: false,
        reason: 'Agent registry unavailable',
      };
    }

    // Check agent exists
    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) {
      return {
        allowed: false,
        reason: `Agent not found: ${agentId}`,
      };
    }

    // Check skill is in allowlist
    if (!this.agentRegistry.canUseSkill(agentId, skillId)) {
      return {
        allowed: false,
        reason: `Skill not in agent allowlist: ${skillId}`,
      };
    }

    return { allowed: true };
  }

  canExecuteTask(agentId: string, taskType: string): { allowed: boolean; reason?: string } {
    if (!this.agentRegistry) {
      return {
        allowed: false,
        reason: 'Agent registry unavailable',
      };
    }

    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) {
      return {
        allowed: false,
        reason: `Agent not found: ${agentId}`,
      };
    }

    const configuredTask = (agent as { orchestratorTask?: string }).orchestratorTask;
    if (configuredTask && configuredTask !== taskType) {
      return {
        allowed: false,
        reason: `Agent ${agentId} not assigned to task ${taskType}`,
      };
    }

    return { allowed: true };
  }

  canReadPath(agentId: string, targetPath: string): { allowed: boolean; reason?: string } {
    if (!this.agentRegistry) {
      return {
        allowed: false,
        reason: 'Agent registry unavailable',
      };
    }

    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) {
      return {
        allowed: false,
        reason: `Agent not found: ${agentId}`,
      };
    }

    const readPaths = agent.permissions?.fileSystem?.readPaths ?? [];
    if (!Array.isArray(readPaths) || readPaths.length === 0) {
      return {
        allowed: false,
        reason: `Agent ${agentId} has no manifest file read paths`,
      };
    }

    const allowed = readPaths.some((allowedPath) => this.pathMatchesBoundary(targetPath, allowedPath));
    if (!allowed) {
      return {
        allowed: false,
        reason: `Path not in agent manifest read allowlist: ${targetPath}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Run a ToolGate preflight for an agent -> skill intent.
   *
   * This method validates the declared call and records an audit event. It does
   * not execute the downstream skill implementation.
   */
  async preflightSkillAccess(
    agentId: string,
    skillId: string,
    args: Record<string, any>,
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    const invocationId = `${agentId}/${skillId}/${Date.now()}`;
    const permission = this.canCall(agentId, skillId);

    // Log invocation
    const invocation: ToolInvocation = {
      id: invocationId,
      agentId,
      skillId,
      args,
      timestamp: new Date().toISOString(),
      mode: typeof args.mode === 'string' ? args.mode : undefined,
      taskType: typeof args.taskType === 'string' ? args.taskType : undefined,
      allowed: permission.allowed,
      reason: permission.reason,
    };

    this.invocationLog.push(invocation);

    // If not allowed, return error
    if (!permission.allowed) {
      console.warn(`[ToolGate] ✗ DENIED: ${agentId} → ${skillId} (${permission.reason})`);
      return {
        success: false,
        error: permission.reason || 'Permission denied',
      };
    }

    try {
      console.log(`[ToolGate] ✓ ALLOWED: ${agentId} → ${skillId} (preflight)`);

      return {
        success: true,
        data: {
          authorized: true,
          mode: "preflight",
          skillId,
        },
      };
    } catch (error: any) {
      console.error(`[ToolGate] ERROR in ${skillId}:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Backward-compatible alias retained for existing callers.
   *
   * Important: despite the legacy name, this still performs ToolGate preflight
   * only. It does not execute the skill body.
   */
  async executeSkill(
    agentId: string,
    skillId: string,
    args: Record<string, any>,
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    return this.preflightSkillAccess(agentId, skillId, args);
  }

  /**
   * Get invocation log
   */
  getLog(): ToolInvocationLog {
    return {
      success: true,
      invocations: this.invocationLog,
      deniedCount: this.invocationLog.filter(i => !i.allowed).length,
      allowedCount: this.invocationLog.filter(i => i.allowed).length,
    };
  }

  /**
   * Get log filtered by agent
   */
  getLogForAgent(agentId: string): ToolInvocation[] {
    return this.invocationLog.filter(i => i.agentId === agentId);
  }

  /**
   * Get log filtered by skill
   */
  getLogForSkill(skillId: string): ToolInvocation[] {
    return this.invocationLog.filter(i => i.skillId === skillId);
  }

  /**
   * Get denied invocations (security violations)
   */
  getDeniedInvocations(): ToolInvocation[] {
    return this.invocationLog.filter(i => !i.allowed);
  }

  /**
   * Clear log (after archival)
   */
  clearLog(): void {
    this.invocationLog = [];
  }

  /**
   * Export log for audit
   */
  exportLog(): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      totalInvocations: this.invocationLog.length,
      allowed: this.invocationLog.filter(i => i.allowed).length,
      denied: this.invocationLog.filter(i => !i.allowed).length,
      invocations: this.invocationLog,
    }, null, 2);
  }
}

// Singleton instance
let gate: ToolGate | null = null;

/**
 * Get or create tool gate
 */
export async function getToolGate(): Promise<ToolGate> {
  if (!gate) {
    gate = new ToolGate();
    await gate.initialize();
  }
  return gate;
}
