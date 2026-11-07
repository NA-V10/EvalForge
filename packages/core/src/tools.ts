import { z } from "zod";
import { JsonObject } from "./primitives";

/**
 * Declarative tool behaviour, executed by the tool simulator against the scenario's world state.
 * Paths support `{arg}` interpolation from tool arguments, e.g. `subscriptions.{subscription_id}`.
 */
export const ToolBehavior = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("read"),
    statePath: z.string(),
    notFoundError: z.string().optional(),
    /** Fields the backend never returns (e.g. secrets). */
    omit: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal("find"),
    collection: z.string(),
    where: z.record(z.string(), z.string()),
    single: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("mutate"),
    statePath: z.string(),
    set: JsonObject,
    /** Facts (relative to the target object) that the *backend* enforces; violations return an error. */
    guards: z.array(z.object({ field: z.string(), equals: z.unknown(), error: z.string() })).default([]),
  }),
  z.object({
    kind: z.literal("create"),
    collection: z.string(),
    idPrefix: z.string(),
    template: JsonObject.default({}),
  }),
  z.object({
    kind: z.literal("verify"),
    statePath: z.string(),
    secretField: z.string(),
    argName: z.string(),
  }),
  z.object({ kind: z.literal("search"), collection: z.string(), fields: z.array(z.string()), argName: z.string() }),
  z.object({ kind: z.literal("static"), response: z.unknown() }),
]);
export type ToolBehavior = z.infer<typeof ToolBehavior>;

export const ToolParam = z.object({
  type: z.enum(["string", "number", "boolean", "object"]),
  description: z.string().default(""),
  required: z.boolean().default(true),
  pattern: z.string().optional(),
  enum: z.array(z.string()).optional(),
});
export type ToolParam = z.infer<typeof ToolParam>;

export const ToolDefinition = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  version: z.string().default("1.0.0"),
  description: z.string(),
  /** Side-effecting tools that change customer state irreversibly. */
  destructive: z.boolean().default(false),
  inputSchema: z.record(z.string(), ToolParam),
  outputSchema: z.record(z.string(), z.string()).default({}),
  behavior: ToolBehavior,
  latencyMs: z.number().int().nonnegative().default(120),
  /** Baseline random failure probability (seeded, reproducible). Scenario faults override. */
  failureRate: z.number().min(0).max(1).default(0),
  costUsd: z.number().nonnegative().default(0),
});
export type ToolDefinition = z.infer<typeof ToolDefinition>;
export type ToolDefinitionInput = z.input<typeof ToolDefinition>;

export const FAULT_MODES = ["error", "timeout", "malformed", "empty", "partial", "contradictory", "delayed"] as const;
export const FaultMode = z.enum(FAULT_MODES);
export type FaultMode = z.infer<typeof FaultMode>;

/** Scenario-level fault injection for a tool. */
export const ToolFault = z.object({
  tool: z.string(),
  mode: FaultMode,
  /** Which calls are affected (1-based). Omitted = every call. */
  onCalls: z.array(z.number().int().positive()).optional(),
  statusCode: z.number().int().optional(),
  message: z.string().optional(),
  latencyMs: z.number().int().optional(),
  /** For partial/contradictory responses: fields to drop / override. */
  dropFields: z.array(z.string()).optional(),
  override: JsonObject.optional(),
});
export type ToolFault = z.infer<typeof ToolFault>;
