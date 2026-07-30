/**
 * MongoDB Connection Module
 * Phase 6: Metrics Persistence Layer
 *
 * Manages database connection, initialization, and health checks
 */

import { MongoClient, Db, Collection } from 'mongodb';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

interface ConnectionConfig {
  url: string;
  dbName: string;
  maxPoolSize: number;
  maxIdleTimeMS: number;
}

let mongoClient: MongoClient | null = null;
let database: Db | null = null;

export class MongoConnection {
  private static config: ConnectionConfig = {
    url: process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/orchestrator',
    dbName: process.env.DB_NAME || 'orchestrator',
    maxPoolSize: 10,
    maxIdleTimeMS: 60000,
  };

  /**
   * Initialize MongoDB connection
   */
  static async connect(): Promise<Db> {
    if (database) {
      return database;
    }

    try {
      mongoClient = new MongoClient(this.config.url, {
        maxPoolSize: this.config.maxPoolSize,
        maxIdleTimeMS: this.config.maxIdleTimeMS,
      });

      await mongoClient.connect();
      database = mongoClient.db(this.config.dbName);

      console.log('[MongoDB] ✅ Connected successfully');

      // Create indexes
      await this.createIndexes();

      return database;
    } catch (error) {
      console.error('[MongoDB] ❌ Connection failed:', error);
      throw error;
    }
  }

  /**
   * Get database instance
   */
  static getDb(): Db {
    if (!database) {
      throw new Error('Database not connected');
    }
    return database;
  }

  /**
   * Get specific collection
   */
  static getCollection<T extends { _id?: string } = any>(name: string) {
    const db = this.getDb();
    return db.collection(name) as any;
  }

  /**
   * Create database indexes for performance
   */
  private static async createIndexes(): Promise<void> {
    const db = this.getDb();

    try {
      // Metrics collection indexes
      const metricsCol = db.collection('metrics');
      await metricsCol.createIndex({ timestamp: -1 });
      await metricsCol.createIndex({ name: 1 });
      await metricsCol.createIndex({ timestamp: -1, name: 1 });

      // Alerts collection indexes
      const alertsCol = db.collection('alerts');
      await alertsCol.createIndex({ timestamp: -1 });
      await alertsCol.createIndex({ fingerprint: 1 });
      await alertsCol.createIndex({ severity: 1 });

      // Knowledge base collection indexes
      const kbCol = db.collection('knowledge_base');
      await kbCol.createIndex({ title: 'text', solution: 'text' });
      await kbCol.createIndex({ category: 1 });
      await kbCol.createIndex({ severity: 1 });
      await kbCol.createIndex({ createdAt: -1 });

      // Consolidations collection indexes
      const consolidationsCol = db.collection('consolidations');
      await consolidationsCol.createIndex({ date: -1 });
      await consolidationsCol.createIndex({ timestamp: -1 });

      // Snapshots collection indexes
      const snapshotsCol = db.collection('snapshots');
      await snapshotsCol.createIndex({ snapshotDate: -1 });
      await snapshotsCol.createIndex({ timestamp: -1 });

      // System state collection indexes
      const systemStateCol = db.collection('system_state');
      await systemStateCol.createIndex({ key: 1 }, { unique: true });
      await systemStateCol.createIndex({ updatedAt: -1 });

      console.log('[MongoDB] ✅ Indexes created');
    } catch (error) {
      console.error('[MongoDB] ⚠️  Index creation failed:', error);
      // Don't throw - indexes might already exist
    }
  }

  /**
   * Health check
   */
  static async healthCheck(): Promise<boolean> {
    try {
      if (!database) return false;
      const result = await database.admin().ping();
      return result.ok === 1;
    } catch {
      return false;
    }
  }

  /**
   * Disconnect
   */
  static async disconnect(): Promise<void> {
    if (mongoClient) {
      await mongoClient.close();
      mongoClient = null;
      database = null;
      console.log('[MongoDB] Disconnected');
    }
  }

  /**
   * Drop all collections (dev only)
   */
  static async dropAllCollections(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot drop collections in production');
    }
    const db = this.getDb();
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.dropCollection(col.name);
    }
    console.log('[MongoDB] ⚠️  All collections dropped');
  }
}

export default MongoConnection;
