/**
 * Phase 7: Load & Stress Tests
 * Test system performance under load
 */

import { describe, it, expect } from 'vitest';

describe('Phase 7: Load & Stress Tests', () => {
  const BASE_URL = process.env.OPENCLAW_LOAD_TEST_BASE_URL ?? 'http://localhost:3000';
  const CONCURRENT_REQUESTS = 100;
  const REQUEST_ITERATIONS = 5;
  const API_KEY = process.env.API_KEY?.trim() ?? '';

  function authHeaders() {
    return API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
  }

  async function fetchKnowledgeLoadTarget() {
    if (API_KEY) {
      return fetch(`${BASE_URL}/api/knowledge/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ query: `test-${Math.random()}` }),
      });
    }

    return fetch(`${BASE_URL}/api/knowledge/summary`);
  }

  async function fetchPersistenceLoadTarget() {
    if (API_KEY) {
      return fetch(`${BASE_URL}/api/persistence/summary`, {
        headers: authHeaders(),
      });
    }

    return fetch(`${BASE_URL}/api/persistence/health`);
  }

  function average(values: number[]) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function median(values: number[]) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  function isHandledResponse(response: Response) {
    return response.ok || response.status === 429;
  }

  function summarizeResponses(responses: Response[]) {
    return {
      okCount: responses.filter((response) => response.ok).length,
      rateLimitedCount: responses.filter((response) => response.status === 429).length,
      handledCount: responses.filter((response) => isHandledResponse(response)).length,
    };
  }

  // =========================================================================
  // LOAD TEST: KNOWLEDGE BASE QUERIES
  // =========================================================================

  describe('Load Test: KB Queries', () => {
    it('should handle 100 concurrent KB queries', async () => {
      const startTime = Date.now();
      const requests = Array.from({ length: CONCURRENT_REQUESTS }, () =>
        fetchKnowledgeLoadTarget()
      );

      const responses = await Promise.all(requests);
      const { okCount, rateLimitedCount, handledCount } = summarizeResponses(responses);
      const duration = Date.now() - startTime;

      console.log(
        `\n📊 KB Query Load Test: ${okCount}/${CONCURRENT_REQUESTS} ok, ${rateLimitedCount} rate-limited in ${duration}ms`
      );
      expect(handledCount).toBe(CONCURRENT_REQUESTS);
      expect(okCount + rateLimitedCount).toBe(CONCURRENT_REQUESTS);
    });

    it('should maintain performance across iterations', async () => {
      const times: number[] = [];

      for (let i = 0; i < REQUEST_ITERATIONS; i++) {
        const startTime = Date.now();
        const response = await fetchKnowledgeLoadTarget();
        const duration = Date.now() - startTime;
        times.push(duration);
        expect(isHandledResponse(response)).toBe(true);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);

      console.log(
        `\n⏱️  KB Summary Performance: avg=${avgTime.toFixed(2)}ms, max=${maxTime}ms`
      );
      expect(maxTime).toBeLessThan(5000);
    });
  });

  // =========================================================================
  // LOAD TEST: PERSISTENCE QUERIES
  // =========================================================================

  describe('Load Test: Persistence Queries', () => {
    it('should handle 100 concurrent persistence health checks', async () => {
      const startTime = Date.now();
      const requests = Array.from({ length: CONCURRENT_REQUESTS }, () =>
        fetchPersistenceLoadTarget()
      );

      const responses = await Promise.all(requests);
      const successCount = responses.filter((r) => r.ok).length;
      const duration = Date.now() - startTime;

      console.log(
        `\n📊 Persistence Health Load Test: ${successCount}/${CONCURRENT_REQUESTS} succeeded in ${duration}ms`
      );
      expect(successCount).toBeGreaterThan(
        CONCURRENT_REQUESTS * 0.95
      );
    });

    it('should handle persistence summary payloads', async () => {
      const startTime = Date.now();
      const response = await fetchPersistenceLoadTarget();
      const data = await response.json();
      const duration = Date.now() - startTime;

      console.log(
        `\n📤 Persistence Summary Payload: ${JSON.stringify(data).length} bytes in ${duration}ms`
      );
      expect(response.ok).toBe(true);
      expect(duration).toBeLessThan(5000);
    });
  });

  // =========================================================================
  // STRESS TEST: API TIMEOUT HANDLING
  // =========================================================================

  describe('Stress Test: Timeout Resilience', () => {
    it('should gracefully handle slow responses', async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      try {
        const response = await fetch(`${BASE_URL}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        expect(response.ok).toBe(true);
      } catch (error: any) {
        clearTimeout(timeoutId);
        // Timeout is expected in some cases
        expect(error.name).toMatch(/AbortError|timeout/i);
      }
    });
  });

  // =========================================================================
  // STRESS TEST: RAPID SEQUENTIAL REQUESTS
  // =========================================================================

  describe('Stress Test: Rapid Requests', () => {
    it('should handle 50 rapid sequential knowledge queries', async () => {
      const startTime = Date.now();
      let successCount = 0;

      for (let i = 0; i < 50; i++) {
        const response = await fetchKnowledgeLoadTarget();
        if (isHandledResponse(response)) successCount++;
      }

      const duration = Date.now() - startTime;

      console.log(
        `\n⚡ Rapid Sequential Queries: ${successCount}/50 handled in ${duration}ms (avg ${(duration / 50).toFixed(0)}ms per request)`
      );
      expect(successCount).toBe(50);
    });
  });

  // =========================================================================
  // STRESS TEST: MIXED WORKLOAD
  // =========================================================================

  describe('Stress Test: Mixed Workload', () => {
    it('should handle concurrent mixed API calls', async () => {
      const startTime = Date.now();
      const endpoints = [
        () => fetch(`${BASE_URL}/health`),
        () => fetch(`${BASE_URL}/api/knowledge/summary`),
        () => fetch(`${BASE_URL}/api/persistence/health`),
        () => fetch(`${BASE_URL}/api/command-center/overview`),
      ];

      let successCount = 0;
      let totalRequests = 0;

      for (let batch = 0; batch < 10; batch++) {
        const requests = endpoints.map((fn) => fn());
        const responses = await Promise.all(requests);
        successCount += responses.filter((response) => isHandledResponse(response)).length;
        totalRequests += responses.length;
      }

      const duration = Date.now() - startTime;

      console.log(
        `\n🔀 Mixed Workload: ${successCount}/${totalRequests} requests handled in ${duration}ms`
      );
      expect(successCount).toBe(totalRequests);
    });
  });

  // =========================================================================
  // PERFORMANCE BENCHMARKS
  // =========================================================================

  describe('Performance Benchmarks', () => {
    it('should keep health checks fast on median latency', async () => {
      const durations: number[] = [];
      for (let i = 0; i < REQUEST_ITERATIONS; i++) {
        const startTime = Date.now();
        const response = await fetch(`${BASE_URL}/health`);
        durations.push(Date.now() - startTime);
        expect(response.ok).toBe(true);
      }

      const medianDuration = median(durations);
      const avgDuration = average(durations);

      console.log(`\n⚡ Health Check: median=${medianDuration}ms avg=${avgDuration.toFixed(2)}ms`);
      expect(medianDuration).toBeLessThan(1000);
    });

    it('should keep KB summary fast on median latency', async () => {
      const durations: number[] = [];
      for (let i = 0; i < REQUEST_ITERATIONS; i++) {
        const startTime = Date.now();
        const response = await fetchKnowledgeLoadTarget();
        durations.push(Date.now() - startTime);
        expect(isHandledResponse(response)).toBe(true);
      }

      const medianDuration = median(durations);
      const avgDuration = average(durations);

      console.log(`\n⚡ KB Summary: median=${medianDuration}ms avg=${avgDuration.toFixed(2)}ms`);
      expect(medianDuration).toBeLessThan(1000);
    });

    it('should keep persistence health fast on median latency', async () => {
      const durations: number[] = [];
      for (let i = 0; i < REQUEST_ITERATIONS; i++) {
        const startTime = Date.now();
        const response = await fetch(`${BASE_URL}/api/persistence/health`);
        durations.push(Date.now() - startTime);
        expect(response.ok).toBe(true);
      }

      const medianDuration = median(durations);
      const avgDuration = average(durations);

      console.log(`\n⚡ Persistence Health: median=${medianDuration}ms avg=${avgDuration.toFixed(2)}ms`);
      expect(medianDuration).toBeLessThan(1000);
    });
  });
});
