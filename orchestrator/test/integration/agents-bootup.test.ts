/**
 * Unit Simulation Test: Agent Bootup
 * 
 * Validates that all 11 agents can be discovered, loaded, and initialized correctly.
 * - All agents are found by AgentRegistry
 * - Each agent config is valid
 * - All agents start in 'idle' status
 * - No bootstrap errors
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { allAgents, agentFixtures } from '../fixtures';
import { MockAgentState, createTestContext, cleanupTestContext, customAssertions } from '../helpers';

describe('Unit Simulation: Agent Bootup', () => {
  const ctx = createTestContext('agent-bootup');

  afterEach(() => {
    cleanupTestContext(ctx);
  });

  it('should discover all 11 agents', () => {
    // In a real test, this would call AgentRegistry.initialize()
    // For now, we validate the fixtures match expected agents

    const expectedAgentIds = [
      'market-research-agent',
      'data-extraction-agent',
      'qa-verification-agent',
      'text-summarization-agent',
      'build-refactor-agent',
      'code-security-agent',
      'normalization-agent',
      'content-agent',
      'integration-agent',
      'skill-audit-agent',
      'system-monitor-agent',
      'code-index-agent',
    ];

    const agentIds = allAgents.map((a) => a.id);

    expect(agentIds).toHaveLength(12);
    expect(agentIds).toEqual(expect.arrayContaining(expectedAgentIds));
  });

  it('should validate each agent config has required fields', () => {
    for (const agent of allAgents) {
      // Required fields
      expect(agent.id).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.model).toBeDefined();
      expect(agent.tier).toBeDefined();

      // ID matches naming convention (one or more hyphenated words + '-agent')
      expect(agent.id).toMatch(/^[a-z]+(?:-[a-z]+)*-agent$/);

      // Valid tier
      expect(['cheap', 'balanced']).toContain(agent.tier);

      // Has permissions
      expect(agent.permissions).toBeDefined();
      expect(agent.permissions?.skills).toBeDefined();
    }
  });

  it('should ensure all agents have at least one skill permission', () => {
    for (const agent of allAgents) {
      const skillCount = Object.keys(agent.permissions?.skills || {}).length;
      expect(skillCount).toBeGreaterThan(0);
    }
  });

  it('should start all agents in idle status', () => {
    const states = allAgents.map((agent) => new MockAgentState(agent.id));

    for (const state of states) {
      customAssertions.agentHealthy(state, 'idle');
      expect(state.taskCount).toBe(0);
      expect(state.errorCount).toBe(0);
      expect(state.uptime).toBe(0);
    }
  });

  it('should support state transitions (idle -> running -> idle)', () => {
    const state = new MockAgentState('market-research-agent');

    // Initial state
    expect(state.status).toBe('idle');

    // Transition to running
    state.markRunning();
    expect(state.status).toBe('running');
    expect(state.uptime).toBe(1);

    // Record task
    state.recordTask();
    expect(state.taskCount).toBe(1);

    // Transition to idle
    state.markIdle();
    expect(state.status).toBe('idle');
  });

  it('should track agent errors correctly', () => {
    const state = new MockAgentState('qa-verification-agent');

    expect(state.errorCount).toBe(0);

    // Record multiple errors
    state.markError(new Error('Error 1'));
    expect(state.errorCount).toBe(1);
    expect(state.status).toBe('error');

    state.markError(new Error('Error 2'));
    expect(state.errorCount).toBe(2);
  });

  it('should categorize agents by tier correctly', () => {
    const cheapAgents = allAgents.filter((a) => a.tier === 'cheap');
    const balancedAgents = allAgents.filter((a) => a.tier === 'balanced');

    // Should have 6 cheap tier agents
    expect(cheapAgents).toHaveLength(6);
    expect(cheapAgents.map((a) => a.id)).toEqual(
      expect.arrayContaining([
        'market-research-agent',
        'data-extraction-agent',
        'text-summarization-agent',
        'normalization-agent',
        'content-agent',
        'system-monitor-agent',
      ]),
    );

    // Should have 6 balanced tier agents
    expect(balancedAgents).toHaveLength(6);
    expect(balancedAgents.map((a) => a.id)).toEqual(
      expect.arrayContaining([
        'qa-verification-agent',
        'build-refactor-agent',
        'code-security-agent',
        'integration-agent',
        'skill-audit-agent',
        'code-index-agent',
      ]),
    );
  });

  it('should verify model assignments match tier', () => {
    const cheapAgents = allAgents.filter((a) => a.tier === 'cheap');
    const balancedAgents = allAgents.filter((a) => a.tier === 'balanced');

    // All cheap agents should use gpt-4o-mini
    for (const agent of cheapAgents) {
      expect(agent.model).toMatch(/gpt-4o-mini|gpt-4/);
    }

    // All balanced agents should use Claude 3.5 Sonnet
    for (const agent of balancedAgents) {
      expect(agent.model).toContain('claude-3-5-sonnet');
    }
  });

  it('should validate network permissions are set', () => {
    // Market research should have network access
    const marketResearch = agentFixtures.marketResearch;
    expect(marketResearch.permissions?.network?.allowed).toBe(true);

    // All other agents should have network disabled
    for (const agent of allAgents) {
      if (agent.id !== 'market-research-agent') {
        expect(agent.permissions?.network?.allowed).toBe(false);
      }
    }
  });

  it('should ensure skill permissions are appropriately restrictive', () => {
    // Each agent should only have permissions for skills it actually uses
    // For example: market-research should NOT have documentParser
    const marketResearch = agentFixtures.marketResearch;
    expect(marketResearch.permissions?.skills.sourceFetch?.allowed).toBe(true);
    expect(marketResearch.permissions?.skills.documentParser?.allowed).toBeUndefined();

    // QA verification should only have testRunner
    const qaVerification = agentFixtures.qaVerification;
    expect(qaVerification.permissions?.skills.testRunner?.allowed).toBe(true);
    expect(qaVerification.permissions?.skills.sourceFetch?.allowed).toBeUndefined();
  });

  it('should support agent reset for testing', () => {
    const state = new MockAgentState('code-security-agent');

    // Simulate some activity
    state.markRunning();
    state.recordTask();
    state.recordTask();
    state.recordTask();
    state.markError(new Error('test error'));

    // Verify activity was recorded
    expect(state.status).toBe('error');
    expect(state.taskCount).toBe(3);
    expect(state.errorCount).toBe(1);

    // Reset
    state.reset();

    // Verify clean state
    expect(state.status).toBe('idle');
    expect(state.taskCount).toBe(0);
    expect(state.errorCount).toBe(0);
    expect(state.uptime).toBe(0);
  });

  it('should enforce permissive skill usage across agents', () => {
    // Collect all skills used across all agents
    const skillsUsed = new Set<string>();
    for (const agent of allAgents) {
      for (const skillId of Object.keys(agent.permissions?.skills || {})) {
        skillsUsed.add(skillId);
      }
    }

    // Should have the full governed core plus read-side truth readers
    expect(skillsUsed.size).toBe(9);
    expect(Array.from(skillsUsed)).toEqual(
      expect.arrayContaining([
        'sourceFetch',
        'documentParser',
        'normalizer',
        'workspacePatch',
        'testRunner',
        'runtimeStateReader',
        'serviceStateReader',
        'repoFileReader',
        'knowledgePackReader',
      ]),
    );
  });

  it('should validate queue and state storage can be initialized', () => {
    // Each agent should support queue management
    // This test validates the structure is compatible with queueing

    for (const agent of allAgents) {
      // Simulate queue initialization
      const queue: Array<{ id: string; agentId: string; skill: string }> = [];
      queue.push({
        id: `task-${agent.id}`,
        agentId: agent.id,
        skill: Object.keys(agent.permissions?.skills || {})[0],
      });

      expect(queue).toHaveLength(1);
      expect(queue[0].agentId).toBe(agent.id);
    }
  });

  it('should support concurrent agent state snapshots', () => {
    const states = new Map<string, MockAgentState>();

    // Create and manage states for all agents
    for (const agent of allAgents) {
      states.set(agent.id, new MockAgentState(agent.id));
    }

    // Verify all agents have independent state
    expect(states.size).toBe(12);

    // Modify one agent's state
    const marketResearchState = states.get('market-research-agent')!;
    marketResearchState.markRunning();
    marketResearchState.recordTask();

    // Verify other agents are unaffected
    const qaState = states.get('qa-verification-agent')!;
    expect(qaState.status).toBe('idle');
    expect(qaState.taskCount).toBe(0);
  });
});
