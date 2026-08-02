import { z } from "zod";
import type { NodeExecutorRegistry } from "./engine.js";
import { failure } from "./failures.js";
import { authorityRank } from "./authority.js";
import type {
  AuthorityClass,
  GraphDefinition,
  GraphNodeDefinition,
  NodeExecutionContext,
  NodeExecutionResult,
} from "./types.js";

export type ProductionAdapterContract = {
  adapterId: string;
  version: string;
  sourceOwner: string;
  bindingStatus: "production" | "test_only";
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  sideEffectClass: AuthorityClass;
  shadowSafe: boolean;
  idempotencyStrategy: "run_node_payload" | "external_operation" | "none";
  authority: AuthorityClass;
  timeoutMs: number;
  retryableFailures: string[];
  evidenceProduced: string[];
  redactedKeys: string[];
  execute(input: unknown, context: NodeExecutionContext): Promise<NodeExecutionResult>;
};

export class ProductionAdapterRegistry {
  private readonly contracts = new Map<string, ProductionAdapterContract>();

  register(contract: ProductionAdapterContract): void {
    if (!/^production\.[a-z0-9._-]+\.v\d+$/.test(contract.adapterId)) {
      throw new Error(`production_adapter_id_invalid:${contract.adapterId}`);
    }
    if (this.contracts.has(contract.adapterId)) {
      throw new Error(`production_adapter_duplicate:${contract.adapterId}`);
    }
    this.contracts.set(contract.adapterId, Object.freeze(contract));
  }

  list(): Array<Omit<ProductionAdapterContract, "inputSchema" | "outputSchema" | "execute"> & { inputSchema: string; outputSchema: string }> {
    return [...this.contracts.values()].map((contract) => ({
      ...contract,
      inputSchema: contract.inputSchema.description ?? "zod-schema",
      outputSchema: contract.outputSchema.description ?? "zod-schema",
      execute: undefined,
    })).map(({ execute: _execute, ...contract }) => contract);
  }

  resolve(adapterId: string): ProductionAdapterContract {
    const contract = this.contracts.get(adapterId);
    if (!contract) throw new Error(`production_adapter_not_registered:${adapterId}`);
    return contract;
  }

  bindExecutors(executors: NodeExecutorRegistry): void {
    for (const contract of this.contracts.values()) {
      if (executors.has(contract.adapterId)) continue;
      executors.register(contract.adapterId, async (context) => {
        const rawInput = context.run.input.adapterInputs && typeof context.run.input.adapterInputs === "object" && !Array.isArray(context.run.input.adapterInputs)
          ? (context.run.input.adapterInputs as Record<string, unknown>)[contract.adapterId] ?? context.run.input
          : context.run.input;
        const parsedInput = contract.inputSchema.safeParse(rawInput);
        if (!parsedInput.success) {
          return { outcome: "failed_terminal", output: {}, failure: failure("validation_error", `Adapter input rejected: ${contract.adapterId}`, { issues: parsedInput.error.issues.map((issue) => issue.message) }) };
        }
        if (context.run.input.shadowMode === true && !contract.shadowSafe) {
          return { outcome: "blocked", output: { blockReason: "adapter_not_shadow_safe" }, failure: failure("unsafe_operation", `Adapter is not shadow safe: ${contract.adapterId}`) };
        }
        const result = await contract.execute(parsedInput.data, context);
        const parsedOutput = contract.outputSchema.safeParse(result.output);
        if (!parsedOutput.success) {
          return { outcome: "failed_terminal", output: {}, failure: failure("tool_contract_error", `Adapter output rejected: ${contract.adapterId}`, { issues: parsedOutput.error.issues.map((issue) => issue.message) }) };
        }
        return { ...result, output: parsedOutput.data };
      });
    }
  }

  validateNode(node: GraphNodeDefinition, definition: GraphDefinition): void {
    if (!node.handler.startsWith("production.")) return;
    const contract = this.resolve(node.handler);
    if (!node.requiredCapabilities.includes(contract.adapterId)) {
      throw new Error(`production_adapter_capability_not_declared:${node.id}:${contract.adapterId}`);
    }
    if (authorityRank(node.sideEffectClass) < authorityRank(contract.sideEffectClass)) {
      throw new Error(`production_adapter_side_effect_downgrade:${node.id}:${contract.adapterId}`);
    }
    if (authorityRank(node.authority) < authorityRank(contract.authority)) {
      throw new Error(`production_adapter_authority_downgrade:${node.id}:${contract.adapterId}`);
    }
    if (authorityRank(definition.authorityRequirements.maximum) < authorityRank(contract.authority)) {
      throw new Error(`production_adapter_exceeds_graph_authority:${node.id}:${contract.adapterId}`);
    }
    if (node.timeoutMs > contract.timeoutMs) {
      throw new Error(`production_adapter_timeout_exceeds_contract:${node.id}:${contract.adapterId}`);
    }
    if (node.idempotencyStrategy !== contract.idempotencyStrategy) {
      throw new Error(`production_adapter_idempotency_mismatch:${node.id}:${contract.adapterId}`);
    }
  }
}
