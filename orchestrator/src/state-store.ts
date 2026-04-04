import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DataPersistence } from "./persistence/data-persistence.js";

const MONGO_STATE_PREFIX = "mongo:";

export type StateStoreKind = "file" | "mongo";

export interface StateStore<T> {
  target: string;
  kind: StateStoreKind;
  ensureReady(): Promise<void>;
  load(): Promise<T | null>;
  save(value: T): Promise<void>;
}

export function isMongoStateTarget(target: string) {
  return typeof target === "string" && target.startsWith(MONGO_STATE_PREFIX);
}

function resolveMongoStateKey(target: string) {
  const key = target.slice(MONGO_STATE_PREFIX.length).trim();
  if (!key) {
    throw new Error("mongo state target must include a non-empty key");
  }
  return key;
}

function createFileStateStore<T>(target: string): StateStore<T> {
  return {
    target,
    kind: "file",
    async ensureReady() {
      await mkdir(dirname(target), { recursive: true });
    },
    async load() {
      if (!existsSync(target)) {
        return null;
      }
      const raw = await readFile(target, "utf-8");
      return JSON.parse(raw) as T;
    },
    async save(value) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(value, null, 2), "utf-8");
    },
  };
}

function createMongoStateStore<T>(target: string): StateStore<T> {
  const key = resolveMongoStateKey(target);
  return {
    target,
    kind: "mongo",
    async ensureReady() {
      // Mongo-backed state does not require local directory setup.
    },
    async load() {
      const persisted = await DataPersistence.getSystemState(key);
      if (!persisted || typeof persisted !== "object") {
        return null;
      }
      return persisted as T;
    },
    async save(value) {
      await DataPersistence.saveSystemState(key, value);
    },
  };
}

export function createStateStore<T>(target: string): StateStore<T> {
  return isMongoStateTarget(target)
    ? createMongoStateStore<T>(target)
    : createFileStateStore<T>(target);
}
