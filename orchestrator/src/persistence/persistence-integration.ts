/**
 * Persistence Integration Layer
 * Phase 6: Metrics Persistence Layer
 *
 * Integrates MongoDB persistence with existing Phase 4 & 5 systems
 */

import { MongoConnection } from './mongo-connection.js';
import { DataPersistence } from './data-persistence.js';
import { SqliteDataPersistence } from './sqlite-data-persistence.js';
import { SnapshotDocument, ConsolidationDocument, COLLECTIONS } from './schemas.js';
import type { OrchestratorState } from '../types.js';
import { getRuntimeCoordinationHealth } from "../coordination/runtime-coordination.js";
import { getStateStoreKind, resolveSqliteStatePath } from "../state-store.js";

const PERSISTENCE_HEALTH_CACHE_TTL_MS = 60_000;
type PersistenceStoreKind = "file" | "mongo" | "sqlite";

type PersistenceHealthSnapshot = {
  status: string;
  database: boolean;
  store: PersistenceStoreKind;
  collections: number;
  coordination: {
    status: string;
    store: string;
    redisConfigured: boolean;
    redisReachable: boolean;
    detail: string;
    checkedAt: string;
    disabledUntil: string | null;
  };
};

export class PersistenceIntegration {
  private static initialized = false;
  private static coreStateStoreKind: PersistenceStoreKind = "mongo";
  private static coreStateStoreTarget: string | null = null;
  private static historicalStoreMode: "disabled" | "mongo" | "sqlite" = "mongo";
  private static healthSnapshot:
    | {
        value: PersistenceHealthSnapshot;
        expiresAt: number;
      }
    | null = null;
  private static healthSnapshotPromise: Promise<PersistenceHealthSnapshot> | null = null;

  private static cacheHealthSnapshot(value: PersistenceHealthSnapshot) {
    this.healthSnapshot = {
      value,
      expiresAt: Date.now() + PERSISTENCE_HEALTH_CACHE_TTL_MS,
    };
    return value;
  }

  static resetHealthCacheForTests() {
    this.initialized = false;
    this.coreStateStoreKind = "mongo";
    this.coreStateStoreTarget = null;
    this.historicalStoreMode = "mongo";
    this.healthSnapshot = null;
    this.healthSnapshotPromise = null;
  }

  static setCoreStateStoreKind(kind: PersistenceStoreKind) {
    this.resetHealthCacheForTests();
    this.coreStateStoreKind = kind;
  }

  static setCoreStateStoreTarget(target: string) {
    this.resetHealthCacheForTests();
    this.coreStateStoreTarget = target;
    this.coreStateStoreKind = getStateStoreKind(target);
  }

  static useLocalCoreStateOnly() {
    this.healthSnapshot = null;
    this.healthSnapshotPromise = null;
    this.historicalStoreMode = "disabled";
    this.initialized = true;
  }

  private static historicalStore(): typeof DataPersistence {
    if (this.historicalStoreMode === "sqlite") {
      return SqliteDataPersistence as unknown as typeof DataPersistence;
    }
    return DataPersistence;
  }

  private static isMongoConfigured() {
    return Boolean(process.env.DATABASE_URL?.trim());
  }

  private static isCoordinationOperational(status: string) {
    return status === "healthy" || status === "disabled";
  }

  private static async getCoordinationHealthFallback(detail: string) {
    return getRuntimeCoordinationHealth().catch(() => ({
      status: "unknown",
      store: "memory",
      redisConfigured: Boolean(process.env.REDIS_URL?.trim()),
      redisReachable: false,
      detail,
      checkedAt: new Date().toISOString(),
      disabledUntil: null,
    }));
  }

  /**
   * Initialize persistence layer on startup
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      console.log('[Persistence] 🔗 Initializing...');

      if (this.coreStateStoreKind === "sqlite") {
        if (!this.coreStateStoreTarget) {
          throw new Error("SQLite persistence requires the configured state target");
        }
        const sqlitePath = resolveSqliteStatePath(this.coreStateStoreTarget);
        await SqliteDataPersistence.initialize(sqlitePath);
        const isHealthy = await SqliteDataPersistence.healthCheck();
        if (!isHealthy) throw new Error("SQLite integrity check failed during initialization");
        const coordination = await this.getCoordinationHealthFallback(
          "Coordination health unavailable during SQLite persistence initialization.",
        );
        this.historicalStoreMode = "sqlite";
        this.initialized = true;
        this.cacheHealthSnapshot({
          status: this.isCoordinationOperational(coordination.status) ? "healthy" : "degraded",
          database: true,
          store: "sqlite",
          collections: Object.keys(COLLECTIONS).length,
          coordination,
        });
        console.log(`[Persistence] ✅ Initialized normalized SQLite persistence at ${sqlitePath}`);
        return;
      }

      if (!this.isMongoConfigured()) {
        if (this.coreStateStoreKind === "mongo") {
          throw new Error(
            "DATABASE_URL is required when the configured runtime state target is Mongo-backed",
          );
        }

        const coordination = await this.getCoordinationHealthFallback(
          "Coordination health unavailable during file-backed persistence initialization.",
        );
        this.historicalStoreMode = "disabled";
        this.initialized = true;
        this.cacheHealthSnapshot({
          status: this.isCoordinationOperational(coordination.status)
            ? "healthy"
            : "degraded",
          database: true,
          store: this.coreStateStoreKind,
          collections: 0,
          coordination,
        });
        console.log(
          `[Persistence] ✅ Initialized in local ${this.coreStateStoreKind}-backed mode (Mongo historical persistence disabled)`,
        );
        return;
      }

      // Connect to MongoDB
      await MongoConnection.connect();

      // Verify connection
      const isHealthy = await MongoConnection.healthCheck();
      if (!isHealthy) {
        throw new Error('MongoDB health check failed');
      }

      const coordination = await this.getCoordinationHealthFallback(
        "Coordination health unavailable during persistence initialization.",
      );

      this.cacheHealthSnapshot({
        status: isHealthy && this.isCoordinationOperational(coordination.status)
          ? "healthy"
          : isHealthy
            ? "degraded"
            : "unhealthy",
        database: isHealthy,
        store: "mongo",
        collections: Object.keys(COLLECTIONS).length,
        coordination,
      });

      this.historicalStoreMode = "mongo";
      this.initialized = true;
      console.log('[Persistence] ✅ Initialized successfully');
    } catch (error) {
      console.error('[Persistence] ❌ Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Save an hourly snapshot to the active historical store.
   * Called by Phase 4 (SnapshotService)
   */
  static async onSnapshotCreated(snapshot: any): Promise<void> {
    try {
      if (!this.initialized || this.historicalStoreMode === "disabled") return;

      const doc: SnapshotDocument = {
        snapshotDate: snapshot.date || new Date().toISOString().split('T')[0],
        timestamp: new Date(),
        metrics: {
          activeMetrics: snapshot.metrics?.count || 0,
          anomalies: snapshot.metrics?.anomalies || 0,
          p50Latency: snapshot.latency?.p50 || 0,
          p95Latency: snapshot.latency?.p95 || 0,
          p99Latency: snapshot.latency?.p99 || 0,
        },
        alerts: {
          total: snapshot.alerts?.total || 0,
          active: snapshot.alerts?.active || 0,
          resolved: snapshot.alerts?.resolved || 0,
          bySeverity: snapshot.alerts?.bySeverity || {},
        },
        health: {
          orchestratorUp: true,
          prometheusUp: snapshot.health?.prometheus || false,
          mongoUp: snapshot.health?.mongo || false,
          redisUp: snapshot.health?.redis || false,
        },
        cost: snapshot.cost,
      };

      await this.historicalStore().saveSnapshot(doc);
      console.log('[Persistence] 📊 Snapshot saved for', doc.snapshotDate);
    } catch (error) {
      console.error('[Persistence] ❌ Failed to save snapshot:', error);
    }
  }

  /**
   * Save a consolidation to the active historical store.
   * Called by Phase 4 (ConsolidationEngine)
   */
  static async onConsolidationCreated(consolidation: any): Promise<void> {
    try {
      if (!this.initialized || this.historicalStoreMode === "disabled") return;

      const doc: ConsolidationDocument = {
        date: consolidation.date,
        timestamp: new Date(),
        snapshots: consolidation.snapshots || { count: 0, timeRange: {} },
        alerts: consolidation.alerts || {},
        metrics: consolidation.metrics || {},
        summary: consolidation.summary || '',
        insights: consolidation.insights || [],
        recommendations: consolidation.recommendations || [],
        kbEntriesGenerated: consolidation.kbEntriesGenerated || 0,
      };

      await this.historicalStore().saveConsolidation(doc);
      console.log('[Persistence] 📈 Consolidation saved for', doc.date);
    } catch (error) {
      console.error('[Persistence] ❌ Failed to save consolidation:', error);
    }
  }

  /**
   * Save a KB entry to the active historical store.
   * Called by Phase 5 (KnowledgeOrchestrator)
   */
  static async onKBEntryCreated(entry: any): Promise<void> {
    try {
      if (!this.initialized || this.historicalStoreMode === "disabled") return;

      await this.historicalStore().saveKBEntry({
        id: entry.id,
        title: entry.title,
        description: entry.description,
        category: entry.category,
        severity: entry.severity,
        rootCause: entry.rootCause,
        solution: entry.solution,
        prerequisites: entry.prerequisites,
        steps: entry.steps,
        expectedOutcome: entry.expectedOutcome,
        tags: entry.tags,
        relatedEntries: entry.relatedEntries,
        relatedConcepts: entry.relatedConcepts,
        occurrences: entry.occurrences || 1,
        successRate: entry.successRate,
        firstSeen: entry.firstSeen ? new Date(entry.firstSeen) : new Date(),
        lastSeen: entry.lastUpdated ? new Date(entry.lastUpdated) : new Date(),
        createdAt: entry.firstSeen ? new Date(entry.firstSeen) : new Date(),
        updatedAt: new Date(),
      });

      console.log('[Persistence] 🧠 KB entry saved:', entry.id);
    } catch (error) {
      console.error('[Persistence] ❌ Failed to save KB entry:', error);
    }
  }

  /**
   * Load KB entries from the active historical store for startup hydration.
   */
  static async loadKBEntries(): Promise<any[]> {
    try {
      if (!this.initialized || this.historicalStoreMode === "disabled") return [];

      const docs = await this.historicalStore().getAllKBEntries();

      const entries = docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        severity: doc.severity,
        description: doc.description || '',
        rootCause: doc.rootCause,
        solution: doc.solution,
        prerequisites: doc.prerequisites || [],
        steps: doc.steps || [],
        expectedOutcome: doc.expectedOutcome || '',
        tags: doc.tags || [],
        relatedEntries: doc.relatedEntries || [],
        firstSeen: doc.firstSeen ? new Date(doc.firstSeen).getTime() : Date.now(),
        lastUpdated: doc.updatedAt ? new Date(doc.updatedAt).getTime() : Date.now(),
        occurrences: doc.occurrences || 1,
        successRate: doc.successRate,
      }));

      console.log(`[Persistence] 🧠 Loaded KB entries from ${this.historicalStoreMode}:`, entries.length);
      return entries;
    } catch (error) {
      console.error('[Persistence] ❌ Failed to load KB entries:', error);
      return [];
    }
  }

  /**
   * Get historical data for reporting
   */
  static async getHistoricalData(days: number = 30): Promise<any> {
    try {
      if (!this.initialized || this.historicalStoreMode === "disabled") return null;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const endDate = new Date();

      const [metrics, alerts, kb, consolidations] = await Promise.all([
        this.historicalStore().getMetrics(undefined, startDate, endDate, 5000),
        this.historicalStore().getAlerts(undefined, undefined, 1000),
        this.historicalStore().getKBStats(),
        this.historicalStore().getConsolidations(days),
      ]);

      const alertsBySeverity = alerts.reduce<Record<string, number>>((acc, alert: any) => {
        const severity = typeof alert.severity === 'string' ? alert.severity : 'unknown';
        acc[severity] = (acc[severity] || 0) + 1;
        return acc;
      }, {});

      const metricsByName = metrics.reduce<Record<string, number>>((acc, metric: any) => {
        const name = typeof metric.name === 'string' ? metric.name : 'unknown';
        acc[name] = (acc[name] || 0) + 1;
        return acc;
      }, {});

      return {
        period: { startDate, endDate, days },
        metricsCount: metrics.length,
        alertsCount: alerts.length,
        alertsBySeverity,
        metricsByName,
        knowledgeBase: kb,
        consolidations: consolidations.length,
      };
    } catch (error) {
      console.error('[Persistence] ❌ Failed to retrieve historical data:', error);
      return null;
    }
  }

  /**
   * Export all data for backup
   */
  static async exportAllData(): Promise<any> {
    try {
      if (!this.initialized || this.historicalStoreMode === "disabled") return null;

      const stats = await this.historicalStore().getCollectionStats();
      const dbSize = await this.historicalStore().getDatabaseSize();

      return {
        exportDate: new Date().toISOString(),
        collections: stats,
        databaseSizeBytes: dbSize,
        databaseSizeMB: (dbSize / 1024 / 1024).toFixed(2),
      };
    } catch (error) {
      console.error('[Persistence] ❌ Failed to export data:', error);
      return null;
    }
  }

  static async getOperatorSummary(state: Pick<OrchestratorState, 'taskExecutions' | 'taskHistory' | 'taskRetryRecoveries'>): Promise<any> {
    if (!this.initialized) {
      return {
        generatedAt: new Date().toISOString(),
        status: 'degraded',
        persistenceAvailable: false,
        storage: null,
        collections: {},
        retention: {
          taskExecutions: state.taskExecutions.length,
          taskHistory: state.taskHistory.length,
          taskRetryRecoveries: state.taskRetryRecoveries.length,
        },
      };
    }

    if (this.historicalStoreMode === "disabled") {
      const health = await this.healthCheck();
      return {
        generatedAt: new Date().toISOString(),
        status: health.status,
        persistenceAvailable: true,
        storage: {
          driver: this.coreStateStoreKind,
          stateTarget: "local",
        },
        collections: {},
        indicators: {},
        retention: {
          taskExecutions: state.taskExecutions.length,
          taskHistory: state.taskHistory.length,
          taskRetryRecoveries: state.taskRetryRecoveries.length,
        },
      };
    }

    const [health, stats, dbSize, alerts7d, consolidations7d] = await Promise.all([
      this.healthCheck(),
      this.historicalStore().getCollectionStats(),
      this.historicalStore().getDatabaseSize(),
      this.historicalStore().getAlerts(undefined, undefined, 500),
      this.historicalStore().getConsolidations(7),
    ]);

    const firingAlerts = alerts7d.filter((alert: any) => alert.status === 'firing').length;

    return {
      generatedAt: new Date().toISOString(),
      status: health.status,
      persistenceAvailable: health.database,
      storage: {
        driver: this.historicalStoreMode,
        databaseSizeBytes: dbSize,
        databaseSizeMB: Number((dbSize / 1024 / 1024).toFixed(2)),
      },
      collections: stats,
      indicators: {
        alertRecordsLastWindow: alerts7d.length,
        activeAlertRecords: firingAlerts,
        consolidationsLast7Days: consolidations7d.length,
      },
      retention: {
        taskExecutions: state.taskExecutions.length,
        taskHistory: state.taskHistory.length,
        taskRetryRecoveries: state.taskRetryRecoveries.length,
      },
    };
  }

  /**
   * Health check endpoint
   */
  static async healthCheck(): Promise<{
    status: string;
    database: boolean;
    store: PersistenceStoreKind;
    collections: number;
    coordination: {
      status: string;
      store: string;
      redisConfigured: boolean;
      redisReachable: boolean;
      detail: string;
      checkedAt: string;
      disabledUntil: string | null;
    };
  }> {
    const cached = this.healthSnapshot;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (this.healthSnapshotPromise) {
      return this.healthSnapshotPromise;
    }

    this.healthSnapshotPromise = (async () => {
      try {
        if (this.coreStateStoreKind === "sqlite") {
          const [dbHealthy, coordination] = await Promise.all([
            SqliteDataPersistence.healthCheck(),
            getRuntimeCoordinationHealth(),
          ]);
          return this.cacheHealthSnapshot({
            status: dbHealthy && this.isCoordinationOperational(coordination.status)
              ? "healthy"
              : dbHealthy
                ? "degraded"
                : "unhealthy",
            database: dbHealthy,
            store: "sqlite",
            collections: dbHealthy ? Object.keys(COLLECTIONS).length : 0,
            coordination,
          });
        }
        if (this.historicalStoreMode === "disabled" && this.coreStateStoreKind !== "mongo") {
          const coordination = await getRuntimeCoordinationHealth();
          return this.cacheHealthSnapshot({
            status: this.isCoordinationOperational(coordination.status)
              ? "healthy"
              : "degraded",
            database: true,
            store: this.coreStateStoreKind,
            collections: 0,
            coordination,
          });
        }

        const [dbHealthy, coordination] = await Promise.all([
          MongoConnection.healthCheck(),
          getRuntimeCoordinationHealth(),
        ]);

        return this.cacheHealthSnapshot({
          status: dbHealthy && this.isCoordinationOperational(coordination.status)
            ? 'healthy'
            : dbHealthy
              ? 'degraded'
              : 'unhealthy',
          database: dbHealthy,
          store: "mongo",
          collections: Object.keys(COLLECTIONS).length,
          coordination,
        });
      } catch (error) {
        const coordination = await this.getCoordinationHealthFallback(
          "Coordination health unavailable during persistence error handling.",
        );
        const fileBackedLocalMode =
          !this.isMongoConfigured() && this.coreStateStoreKind !== "mongo";
        return this.cacheHealthSnapshot({
          status: fileBackedLocalMode ? "degraded" : 'unhealthy',
          database: fileBackedLocalMode,
          store: fileBackedLocalMode ? this.coreStateStoreKind : "mongo",
          collections: 0,
          coordination,
        });
      } finally {
        this.healthSnapshotPromise = null;
      }
    })();

    return this.healthSnapshotPromise;
  }

  /**
   * Cleanup old data based on retention policies
   */
  static async cleanupOldData(): Promise<void> {
    try {
      if (!this.initialized || this.historicalStoreMode === "disabled") return;

      console.log('[Persistence] 🧹 Cleaning old data...');

      // Remove metrics older than 90 days
      const metricsDeleted = await this.historicalStore().deleteOldMetrics(90);
      console.log('[Persistence] Deleted', metricsDeleted, 'old metric records');
    } catch (error) {
      console.error('[Persistence] ❌ Cleanup failed:', error);
    }
  }

  /**
   * Close persistence resources
   */
  static async close(): Promise<void> {
    try {
      await MongoConnection.disconnect();
      await SqliteDataPersistence.close();
      this.initialized = false;
      this.historicalStoreMode = "mongo";
      this.resetHealthCacheForTests();
      console.log('[Persistence] ✅ Closed successfully');
    } catch (error) {
      console.error('[Persistence] ❌ Close failed:', error);
      throw error;
    }
  }
}

export default PersistenceIntegration;
