/**
 * Test Helpers - Utility functions for integration tests
 * Provides setup/teardown, mocking, assertions
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import * as fs from 'fs';
import * as path from 'path';

export interface TestContext {
  testDataDir: string;
  auditLog: Array<Record<string, any>>;
  costTracker: Map<string, number>;
  stateSnapshots: Map<string, Record<string, any>>;
}

// Create test data directory
export function createTestDataDir(testName: string): string {
  const dir = path.join(process.cwd(), 'test', '.tmp', testName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Cleanup test data
export function cleanupTestDataDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Create test context
export function createTestContext(testName: string): TestContext {
  return {
    testDataDir: createTestDataDir(testName),
    auditLog: [],
    costTracker: new Map(),
    stateSnapshots: new Map(),
  };
}

// Cleanup test context
export function cleanupTestContext(ctx: TestContext): void {
  cleanupTestDataDir(ctx.testDataDir);
  ctx.auditLog = [];
  ctx.costTracker.clear();
  ctx.stateSnapshots.clear();
}

/**
 * Mock agent state management
 */
export class MockAgentState {
  agentId: string;
  status: 'idle' | 'running' | 'error' | 'unknown' = 'idle';
  taskCount = 0;
  errorCount = 0;
  uptime = 0;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  markRunning(): void {
    this.status = 'running';
    this.uptime++;
  }

  markIdle(): void {
    this.status = 'idle';
  }

  markError(error: unknown): void {
    this.status = 'error';
    this.errorCount++;
  }

  recordTask(): void {
    this.taskCount++;
  }

  reset(): void {
    this.status = 'idle';
    this.taskCount = 0;
    this.errorCount = 0;
    this.uptime = 0;
  }
}

/**
 * Mock audit logger
 */
export class MockAuditLogger {
  entries: Array<Record<string, any>> = [];
  private traceCounter = 0;

  logAction(
    action: string,
    agentId: string,
    skillId?: string,
    details?: Record<string, any>,
  ): string {
    const traceId = `trace-${Date.now()}-${this.traceCounter++}`;
    const metadata = details ? structuredClone(details) : {};
    if (!('traceId' in metadata)) {
      metadata.traceId = traceId;
    }

    const entry = {
      traceId,
      timestamp: new Date().toISOString(),
      action,
      agentId,
      skillId: skillId || null,
      metadata,
    };
    this.entries.push(entry);
    return traceId;
  }

  getEntries(filter?: { action?: string; agentId?: string }): Array<Record<string, any>> {
    const source = !filter
      ? this.entries
      : this.entries.filter((entry) => {
      if (filter.action && entry.action !== filter.action) return false;
      if (filter.agentId && entry.agentId !== filter.agentId) return false;
      return true;
    });

    return source.map((entry) => structuredClone(entry));
  }

  clear(): void {
    this.entries = [];
    this.traceCounter = 0;
  }

  // Verify trace ID chains (for workflow validation)
  getTraceChain(startTraceId: string): string[] {
    const chain = [startTraceId];
    let currentTrace = startTraceId;

    for (const entry of this.entries) {
      if (entry.metadata?.parentTraceId === currentTrace) {
        chain.push(entry.traceId);
        currentTrace = entry.traceId;
      }
    }

    return chain;
  }
}

/**
 * Mock cost tracker
 */
export class MockCostTracker {
  costs: Map<string, { total: number; calls: number }> = new Map();

  recordCall(agentId: string, skillId: string, cost: number): void {
    const key = `${agentId}:${skillId}`;
    const current = this.costs.get(key) || { total: 0, calls: 0 };
    this.costs.set(key, {
      total: current.total + cost,
      calls: current.calls + 1,
    });
  }

  getCost(agentId: string, skillId?: string): number {
    if (skillId) {
      const key = `${agentId}:${skillId}`;
      return this.costs.get(key)?.total || 0;
    }

    let total = 0;
    for (const [key] of this.costs) {
      if (key.startsWith(`${agentId}:`)) {
        total += this.costs.get(key)?.total || 0;
      }
    }
    return total;
  }

  getTotalCost(): number {
    let total = 0;
    for (const entry of this.costs.values()) {
      total += entry.total;
    }
    return total;
  }

  getCallCount(agentId: string, skillId?: string): number {
    if (skillId) {
      const key = `${agentId}:${skillId}`;
      return this.costs.get(key)?.calls || 0;
    }

    let total = 0;
    for (const [key] of this.costs) {
      if (key.startsWith(`${agentId}:`)) {
        total += this.costs.get(key)?.calls || 0;
      }
    }
    return total;
  }

  reset(): void {
    this.costs.clear();
  }
}

/**
 * Common assertions
 */
export const customAssertions = {
  agentHealthy(state: MockAgentState, expectedStatus: string = 'idle'): void {
    expect(state.status).toBe(expectedStatus);
    expect(state.errorCount).toBe(0);
  },

  agentFailed(state: MockAgentState): void {
    expect(state.status).toBe('error');
    expect(state.errorCount).toBeGreaterThan(0);
  },

  auditLogContains(logger: MockAuditLogger, action: string, agentId: string): void {
    const found = logger.entries.some((e) => e.action === action && e.agentId === agentId);
    expect(found).toBe(true);
  },

  auditLogNotContains(logger: MockAuditLogger, action: string, agentId: string): void {
    const found = logger.entries.some((e) => e.action === action && e.agentId === agentId);
    expect(found).toBe(false);
  },

  costWithinBudget(tracker: MockCostTracker, budget: number): void {
    const total = tracker.getTotalCost();
    expect(total).toBeLessThanOrEqual(budget);
  },

  traceIdValid(traceId: string | null | undefined): void {
    expect(traceId).toBeDefined();
    expect(typeof traceId).toBe('string');
    expect(traceId).toMatch(/^trace-/);
  },

  stateIdempotent(before: Record<string, any>, after: Record<string, any>): void {
    // Running same operation twice should produce same result
    expect(after).toEqual(before);
  },
};

/**
 * Helper to wait for async operations
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 5000,
): Promise<void> {
  const startTime = performance.now();
  while (performance.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

/**
 * Helper to create deterministic trace context
 */
export interface TraceContext {
  traceId: string;
  parentTraceId?: string;
  startTime: number;
  metadata: Record<string, any>;
}

export function createTraceContext(parentTraceId?: string): TraceContext {
  return {
    traceId: `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    parentTraceId,
    startTime: Date.now(),
    metadata: {},
  };
}

/**
 * Helper to simulate task execution with timing
 */
export async function simulateTaskExecution(
  duration: number = 100,
  shouldFail: boolean = false,
): Promise<{ executionTime: number; result: any; error?: Error }> {
  const startTime = performance.now();

  await new Promise((resolve) => setTimeout(resolve, duration));

  const executionTime = performance.now() - startTime;

  if (shouldFail) {
    return {
      executionTime,
      result: null,
      error: new Error('Simulated task failure'),
    };
  }

  return {
    executionTime,
    result: { success: true, data: 'task result' },
  };
}

export default {
  createTestContext,
  cleanupTestContext,
  MockAgentState,
  MockAuditLogger,
  MockCostTracker,
  customAssertions,
  waitFor,
  createTraceContext,
  simulateTaskExecution,
};
