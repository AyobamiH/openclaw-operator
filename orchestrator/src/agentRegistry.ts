/**
 * Agent Registry & Lifecycle Manager
 * 
 * Manages agent spawning, configuration validation, and state tracking.
 * Maps agent ID → configuration and runtime state.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  orchestratorTask?: string;
  orchestratorTasks?: string[];
  model: {
    primary: string;
    fallback: string;
    tier: 'cheap' | 'balanced' | 'heavy' | 'strategic';
  };
  permissions?: {
    skills?: Record<string, { allowed: boolean }>;
    fileSystem?: {
      readPaths?: string[];
      writePaths?: string[];
    };
    network?: {
      allowed?: boolean;
      allowedDomains?: string[];
    };
  };
  constraints?: {
    timeout?: number;
    maxRetries?: number;
    memory?: string;
    cpu?: string;
  };
  heartbeat?: {
    enabled?: boolean;
    interval?: number;
    checks?: string[];
  };
}

export interface AgentState {
  id: string;
  status: 'idle' | 'running' | 'error' | 'stopped';
  pid?: number;
  startedAt?: string;
  lastHeartbeat?: string;
  taskCount: number;
  errorCount: number;
  uptime: number; // ms
}

/**
 * Agent Registry - manages all agents in the swarm
 */
export class AgentRegistry {
  private agents: Map<string, AgentConfig> = new Map();
  private state: Map<string, AgentState> = new Map();
  private agentsPath: string;

  constructor(agentsPath: string = path.join(__dirname, '../../agents')) {
    this.agentsPath = agentsPath;
  }

  /**
   * Initialize registry - discover and validate all agents
   */
  async initialize(): Promise<void> {
    console.log('[AgentRegistry] Initializing...');

    try {
      const agentEntries = await fs.readdir(this.agentsPath, {
        withFileTypes: true,
      });

      for (const entry of agentEntries) {
        const agentDir = entry.name;
        // Skip special directories
        if (
          !entry.isDirectory() ||
          agentDir.startsWith('.') ||
          agentDir === 'AGENT_TEMPLATE' ||
          agentDir === 'shared'
        ) {
          continue;
        }

        const configPath = path.join(this.agentsPath, agentDir, 'agent.config.json');

        try {
          const configContent = await fs.readFile(configPath, 'utf-8');
          const config: AgentConfig = JSON.parse(configContent);

          // Validate config
          if (!config.id || !config.name) {
            console.warn(`[AgentRegistry] Invalid config in ${agentDir}: missing id or name`);
            continue;
          }

          this.agents.set(config.id, config);

          // Initialize agent state
          this.state.set(config.id, {
            id: config.id,
            status: 'stopped',
            taskCount: 0,
            errorCount: 0,
            uptime: 0,
          });

          console.log(`[AgentRegistry] ✓ Loaded ${config.id} (${config.name})`);
        } catch (error: any) {
          console.warn(`[AgentRegistry] Error loading agent ${agentDir}:`, error.message);
        }
      }

      console.log(`[AgentRegistry] Initialization complete: ${this.agents.size} agents loaded`);
    } catch (error: any) {
      console.error('[AgentRegistry] Error during initialization:', error.message);
      throw error;
    }
  }

  /**
   * Get agent configuration by ID
   */
  getAgent(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get agent runtime state
   */
  getState(agentId: string): AgentState | undefined {
    return this.state.get(agentId);
  }

  /**
   * List all registered agents
   */
  listAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * Check if agent can use a skill
   */
  canUseSkill(agentId: string, skillId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    const skillPerms = agent.permissions?.skills?.[skillId];
    return skillPerms?.allowed === true;
  }

  /**
   * Get allowed skills for an agent
   */
  getAllowedSkills(agentId: string): string[] {
    const agent = this.agents.get(agentId);
    if (!agent) return [];

    const skills = agent.permissions?.skills ?? {};

    return Object.entries(skills)
      .filter(([_, perms]) => perms.allowed === true)
      .map(([skillId, _]) => skillId);
  }

  /**
   * Update agent state
   */
  setState(agentId: string, updates: Partial<AgentState>): void {
    const current = this.state.get(agentId);
    if (!current) return;

    this.state.set(agentId, {
      ...current,
      ...updates,
    });
  }

  /**
   * Mark agent as running
   */
  markRunning(agentId: string, pid?: number): void {
    this.setState(agentId, {
      status: 'running',
      pid,
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * Mark agent as idle
   */
  markIdle(agentId: string): void {
    this.setState(agentId, {
      status: 'idle',
    });
  }

  /**
   * Mark agent as error
   */
  markError(agentId: string): void {
    const current = this.state.get(agentId);
    if (!current) return;

    this.setState(agentId, {
      status: 'error',
      errorCount: current.errorCount + 1,
    });
  }

  /**
   * Record task completion
   */
  recordTask(agentId: string): void {
    const current = this.state.get(agentId);
    if (!current) return;

    this.setState(agentId, {
      taskCount: current.taskCount + 1,
    });
  }

  /**
   * Update heartbeat timestamp
   */
  recordHeartbeat(agentId: string): void {
    const current = this.state.get(agentId);
    if (!current) return;

    const uptime = current.startedAt
      ? Date.now() - new Date(current.startedAt).getTime()
      : 0;

    this.setState(agentId, {
      lastHeartbeat: new Date().toISOString(),
      uptime,
    });
  }

  /**
   * Get agent configuration path
   */
  getAgentPath(agentId: string): string {
    return path.join(this.agentsPath, agentId);
  }

  /**
   * Validate agent can be spawned
   */
  validateAgent(agentId: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const agent = this.agents.get(agentId);

    if (!agent) {
      errors.push(`Agent not found: ${agentId}`);
      return { valid: false, errors };
    }

    // Check required fields
    if (!agent.model?.primary) {
      errors.push('Missing model.primary');
    }

    if (!agent.constraints?.timeout) {
      errors.push('Missing constraints.timeout');
    }

    // Check at least one skill is allowed
    const allowedSkills = Object.values(agent.permissions?.skills ?? {}).filter(
      (p) => p.allowed,
    );
    if (allowedSkills.length === 0) {
      errors.push('No skills are allowed for this agent');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get agent statistics
   */
  getStats(): {
    totalAgents: number;
    running: number;
    idle: number;
    error: number;
    totalTasks: number;
    totalErrors: number;
  } {
    const states = Array.from(this.state.values());

    return {
      totalAgents: states.length,
      running: states.filter(s => s.status === 'running').length,
      idle: states.filter(s => s.status === 'idle').length,
      error: states.filter(s => s.status === 'error').length,
      totalTasks: states.reduce((sum, s) => sum + s.taskCount, 0),
      totalErrors: states.reduce((sum, s) => sum + s.errorCount, 0),
    };
  }

  /**
   * Export agent directory for spawning
   */
  getAgentEntryPoint(agentId: string): string {
    return path.join(this.getAgentPath(agentId), 'src', 'index.ts');
  }
}

// Singleton instance
let registry: AgentRegistry | null = null;

/**
 * Get or create agent registry
 */
export async function getAgentRegistry(agentsPath?: string): Promise<AgentRegistry> {
  if (!registry) {
    registry = new AgentRegistry(agentsPath);
    await registry.initialize();
  }
  return registry;
}
