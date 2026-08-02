import type { GraphDefinition } from "./types.js";
import { sha256 } from "./reducer.js";
import { validateGraphDefinition } from "./schema.js";

export class GraphRegistry {
  private readonly definitions = new Map<string, GraphDefinition>();

  register(rawDefinition: unknown): GraphDefinition {
    const definition = validateGraphDefinition(rawDefinition);
    const key = this.key(definition.graphId, definition.version);
    const existing = this.definitions.get(key);
    if (existing && sha256(existing) !== sha256(definition)) {
      throw new Error(`graph_definition_version_immutable:${key}`);
    }
    const frozen = Object.freeze(structuredClone(definition));
    this.definitions.set(key, frozen);
    return frozen;
  }

  get(graphId: string, version: string): GraphDefinition {
    const definition = this.definitions.get(this.key(graphId, version));
    if (!definition) throw new Error(`graph_definition_not_found:${graphId}@${version}`);
    return definition;
  }

  latest(graphId: string): GraphDefinition {
    const candidates = this.list().filter((definition) => definition.graphId === graphId);
    if (candidates.length === 0) throw new Error(`graph_definition_not_found:${graphId}`);
    return candidates.sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))[0]!;
  }

  list(): GraphDefinition[] {
    return [...this.definitions.values()].map((definition) => structuredClone(definition));
  }

  private key(graphId: string, version: string): string {
    return `${graphId}@${version}`;
  }
}

