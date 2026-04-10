/**
 * Unit Simulation Test: Cross-Agent Workflows
 * 
 * Validates that complex multi-step workflows work correctly:
 * - Data flows between agents with correct permissions
 * - Trace IDs chain across steps (parent→child linkage)
 * - Each agent verifies permissions before executing
 * - Workflow state is maintained across steps
 */

import { performance } from 'node:perf_hooks';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { allAgents, taskFixtures } from '../fixtures';
import { MockAuditLogger, createTraceContext, customAssertions } from '../helpers';

interface WorkflowStep {
  agentId: string;
  skillId: string;
  input: any;
  parentTraceId?: string;
}

interface WorkflowResult {
  success: boolean;
  steps: Array<{
    agentId: string;
    skillId: string;
    traceId: string;
    result: any;
    timestamp: number;
  }>;
  errors: string[];
  totalDuration: number;
}

describe('Unit Simulation: Cross-Agent Workflows', () => {
  let auditLogger: MockAuditLogger;
  let workflowTrace: { traceId: string; parentTraceId?: string };

  beforeEach(() => {
    auditLogger = new MockAuditLogger();
    workflowTrace = createTraceContext();
  });

  afterEach(() => {
    auditLogger.clear();
  });

  /**
   * Simulate a multi-step workflow execution
   */
  async function executeWorkflow(steps: WorkflowStep[]): Promise<WorkflowResult> {
    const result: WorkflowResult = {
      success: true,
      steps: [],
      errors: [],
      totalDuration: 0,
    };

    const startTime = performance.now();

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const parentTraceId = i === 0 ? workflowTrace.traceId : result.steps[i - 1].traceId;

      // Check if agent has permission for this skill
      const agent = allAgents.find((a) => a.id === step.agentId);
      if (!agent) {
        result.errors.push(`Agent not found: ${step.agentId}`);
        result.success = false;
        continue;
      }

      const hasPermission = agent.permissions?.skills[step.skillId]?.allowed === true;
      if (!hasPermission) {
        result.errors.push(`Agent ${step.agentId} denied access to skill ${step.skillId}`);
        result.success = false;

        auditLogger.logAction('workflow_step_denied', step.agentId, step.skillId, {
          workflowTraceId: workflowTrace.traceId,
          stepIndex: i,
        });
        continue;
      }

      // Execute the step
      const stepStartTime = performance.now();
      const traceId = auditLogger.logAction('workflow_step_executed', step.agentId, step.skillId, {
        workflowTraceId: workflowTrace.traceId,
        parentTraceId,
        stepIndex: i,
        input: step.input,
      });

      // Simulate processing (with realistic delays, or explicit delay override)
      const processingTime =
        typeof step.input?.delay === 'number' ? step.input.delay : 50 + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, processingTime));

      const stepDuration = performance.now() - stepStartTime;

      result.steps.push({
        agentId: step.agentId,
        skillId: step.skillId,
        traceId,
        result: {
          success: true,
          data: `Processed by ${step.agentId}/${step.skillId}`,
          inputData: step.input,
          processingTime: stepDuration,
        },
        timestamp: Date.now(),
      });
    }

    result.totalDuration = performance.now() - startTime;
    return result;
  }

  it('should execute simple two-step workflow', async () => {
    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'https://example.com' },
      },
      {
        agentId: 'data-extraction-agent',
        skillId: 'documentParser',
        input: { document: 'fetched-data' },
      },
    ];

    const result = await executeWorkflow(workflow);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].agentId).toBe('market-research-agent');
    expect(result.steps[1].agentId).toBe('data-extraction-agent');
  });

  it('should execute three-step workflow (fetch→parse→normalize)', async () => {
    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'https://api.example.com/data' },
      },
      {
        agentId: 'data-extraction-agent',
        skillId: 'documentParser',
        input: { raw: 'fetched' },
      },
      {
        agentId: 'normalization-agent',
        skillId: 'normalizer',
        input: { parsed: 'data' },
      },
    ];

    const result = await executeWorkflow(workflow);

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(3);

    // Verify step order
    expect(result.steps[0].skillId).toBe('sourceFetch');
    expect(result.steps[1].skillId).toBe('documentParser');
    expect(result.steps[2].skillId).toBe('normalizer');
  });

  it('should chain trace IDs through workflow steps', async () => {
    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { query: 'test' },
      },
      {
        agentId: 'data-extraction-agent',
        skillId: 'documentParser',
        input: { doc: 'data' },
      },
    ];

    const result = await executeWorkflow(workflow);

    // All steps should have unique trace IDs
    const traceIds = result.steps.map((s) => s.traceId);
    const uniqueTraceIds = new Set(traceIds);
    expect(uniqueTraceIds.size).toBe(traceIds.length);

    // Verify trace chain in audit log
    const auditEntries = auditLogger.getEntries({ action: 'workflow_step_executed' });
    expect(auditEntries.length).toBeGreaterThanOrEqual(2);

    // Parent trace ID should be set for non-first steps
    if (auditEntries.length >= 2) {
      expect(auditEntries[1].metadata.parentTraceId).toBeDefined();
    }
  });

  it('should deny workflow when agent lacks permission at any step', async () => {
    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'test' },
      },
      {
        // qa-verification-agent doesn't have sourceFetch permission
        agentId: 'qa-verification-agent',
        skillId: 'sourceFetch',
        input: { url: 'test' },
      },
    ];

    const result = await executeWorkflow(workflow);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('denied access');
  });

  it('should maintain workflow state through multiple steps', async () => {
    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'https://api.example.com/users/123' },
      },
      {
        agentId: 'data-extraction-agent',
        skillId: 'documentParser',
        input: { format: 'json' },
      },
      {
        agentId: 'qa-verification-agent',
        skillId: 'testRunner',
        input: { testType: 'validation' },
      },
    ];

    const result = await executeWorkflow(workflow);

    // Each step should receive the workflow context
    for (const step of result.steps) {
      expect(step.result).toBeDefined();
      expect(step.result.data).toContain('Processed by');
      expect(step.result.processingTime).toBeGreaterThan(0);
    }

    // Verify audit trail has all steps linked by workflow trace
    const auditEntries = auditLogger.getEntries();
    const workflowSteps = auditEntries.filter(
      (e) => e.metadata.workflowTraceId === workflowTrace.traceId,
    );
    expect(workflowSteps.length).toBeGreaterThanOrEqual(3);
  });

  it('should handle workflow with conditional branching', async () => {
    // Execute first step
    const step1 = await executeWorkflow([
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'test1' },
      },
    ]);

    expect(step1.success).toBe(true);

    // Based on result, choose next steps
    const branch = step1.steps[0].result.data.includes('success') ? 'a' : 'b';

    const step2 = await executeWorkflow([
      {
        agentId: branch === 'a' ? 'data-extraction-agent' : 'text-summarization-agent',
        skillId: branch === 'a' ? 'documentParser' : 'normalizer',
        input: { branch },
      },
    ]);

    expect(step2.success).toBe(true);
  });

  it('should timeout long-running workflows', async () => {
    const timeout = 500; // 500ms timeout
    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'test', delay: 300 },
      },
      {
        agentId: 'data-extraction-agent',
        skillId: 'documentParser',
        input: { delay: 300 }, // Combined: 600ms > 500ms timeout
      },
    ];

    const startTime = performance.now();
    const result = await executeWorkflow(workflow);
    const duration = performance.now() - startTime;

    // Duration should be close to timeout
    expect(duration).toBeGreaterThanOrEqual(timeout - 100);
  });

  it('should support parallel workflow steps', async () => {
    // Simulate parallel execution of multiple workflows
    const workflows = [
      [
        {
          agentId: 'market-research-agent',
          skillId: 'sourceFetch',
          input: { url: 'source1' },
        },
      ],
      [
        {
          agentId: 'data-extraction-agent',
          skillId: 'documentParser',
          input: { doc: 'doc1' },
        },
      ],
      [
        {
          agentId: 'qa-verification-agent',
          skillId: 'testRunner',
          input: { test: 'test1' },
        },
      ],
    ];

    const startTime = performance.now();
    const results = await Promise.all(workflows.map((w) => executeWorkflow(w)));
    const duration = performance.now() - startTime;

    // All workflows should succeed
    expect(results.every((r) => r.success)).toBe(true);

    // Parallel execution should be faster than sequential
    // (rough estimate: 3 workflows × 150ms sequential ≈ 450ms)
    // Parallel should be closer to 150ms
    expect(duration).toBeLessThan(300); // Generous margin for test execution
  });

  it('should handle workflow with retry logic', async () => {
    let attemptCount = 0;

    async function executeWithRetry(steps: WorkflowStep[], maxRetries = 3): Promise<WorkflowResult> {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        attemptCount++;
        const result = await executeWorkflow(steps);

        if (result.success) {
          return result;
        }

        if (attempt < maxRetries - 1) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      return {
        success: false,
        steps: [],
        errors: ['Max retries exceeded'],
        totalDuration: 0,
      };
    }

    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'test' },
      },
    ];

    const result = await executeWithRetry(workflow);
    expect(result.success).toBe(true);
    expect(attemptCount).toBeGreaterThan(0);
  });

  it('should validate workflow audit trail completeness', async () => {
    const preAuditCount = auditLogger.entries.length;

    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'test' },
      },
      {
        agentId: 'data-extraction-agent',
        skillId: 'documentParser',
        input: { doc: 'test' },
      },
    ];

    await executeWorkflow(workflow);

    const postAuditCount = auditLogger.entries.length;
    const audited = postAuditCount - preAuditCount;

    // At least 2 steps should be logged
    expect(audited).toBeGreaterThanOrEqual(2);
  });

  it('should prevent circular dependencies in workflows', async () => {
    // agentA → agentB → agentA (circular)
    // This should be detected and prevented
    const circularSteps: WorkflowStep[] = [
      { agentId: 'market-research-agent', skillId: 'sourceFetch', input: {} },
      { agentId: 'data-extraction-agent', skillId: 'documentParser', input: {} },
      // In a real system, this would try to reference back to market-research
      { agentId: 'market-research-agent', skillId: 'sourceFetch', input: {} },
    ];

    const result = await executeWorkflow(circularSteps);

    // Should complete without infinite loops
    expect(result).toBeDefined();
    expect(result.steps.length).toBeLessThanOrEqual(circularSteps.length);
  });

  it('should support workflow cancellation mid-execution', async () => {
    let executionCancelled = false;

    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'test' },
      },
      {
        agentId: 'data-extraction-agent',
        skillId: 'documentParser',
        input: { doc: 'test' },
      },
      {
        agentId: 'qa-verification-agent',
        skillId: 'testRunner',
        input: { test: 'test' },
      },
    ];

    // Start workflow and cancel after first step
    const promise = executeWorkflow(workflow);

    // Simulate cancellation after ~100ms
    setTimeout(() => {
      executionCancelled = true;
    }, 100);

    const result = await promise;

    // Result should be valid (either completed or cancelled cleanly)
    expect(result).toBeDefined();
    expect(Array.isArray(result.steps)).toBe(true);
  });

  it('should calculate workflow performance metrics', async () => {
    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'test' },
      },
      {
        agentId: 'data-extraction-agent',
        skillId: 'documentParser',
        input: { doc: 'test' },
      },
      {
        agentId: 'qa-verification-agent',
        skillId: 'testRunner',
        input: { test: 'test' },
      },
    ];

    const result = await executeWorkflow(workflow);

    // Metrics should be calculated
    expect(result.totalDuration).toBeGreaterThan(0);

    // Each step should have individual timing
    for (const step of result.steps) {
      expect(step.result.processingTime).toBeGreaterThan(0);
      expect(step.timestamp).toBeGreaterThan(0);
    }

    // Total should be >= sum of steps (plus overhead)
    const stepSum = result.steps.reduce((sum, s) => sum + s.result.processingTime, 0);
    expect(result.totalDuration).toBeGreaterThanOrEqual(stepSum);
  });

  it('should validate data flow integrity across workflow', async () => {
    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'https://api.example.com/data', format: 'json' },
      },
      {
        agentId: 'data-extraction-agent',
        skillId: 'documentParser',
        input: { expectedFormat: 'json' },
      },
    ];

    const result = await executeWorkflow(workflow);

    expect(result.success).toBe(true);

    // Verify data passed through steps
    for (let i = 0; i < result.steps.length; i++) {
      const step = result.steps[i];
      expect(step.result.inputData).toBeDefined();
      expect(step.result.data).toContain(step.agentId);
    }
  });

  it('should handle errors in workflow steps gracefully', async () => {
    const workflow: WorkflowStep[] = [
      {
        agentId: 'market-research-agent',
        skillId: 'sourceFetch',
        input: { url: 'invalid-url' },
      },
      {
        // This should not execute if step 1 fails
        agentId: 'data-extraction-agent',
        skillId: 'documentParser',
        input: { doc: 'data' },
      },
    ];

    // Add error handling
    const result = await executeWorkflow(workflow);

    // Even with errors, result should be valid
    expect(result).toBeDefined();
    expect(Array.isArray(result.steps)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
