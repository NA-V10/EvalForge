import { z } from "zod";
import { JsonObject } from "./primitives";

export const TRACE_STEP_TYPES = [
  "user_message",
  "agent_message",
  "tool_call",
  "tool_result",
  "state_change",
  "error",
  "final_response",
] as const;
export const TraceStepType = z.enum(TRACE_STEP_TYPES);
export type TraceStepType = z.infer<typeof TraceStepType>;

export const StateDiff = z.object({ path: z.string(), before: z.unknown(), after: z.unknown() });
export type StateDiff = z.infer<typeof StateDiff>;

export const TraceStep = z.object({
  index: z.number().int().positive(),
  type: TraceStepType,
  timestamp: z.string(),
  /** Offset from run start, ms (simulated clock — reproducible). */
  offsetMs: z.number().nonnegative(),
  durationMs: z.number().nonnegative().default(0),
  content: z.string().optional(),
  tool: z.string().optional(),
  callId: z.string().optional(),
  arguments: JsonObject.optional(),
  result: z.unknown().optional(),
  status: z.enum(["ok", "error"]).optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  retry: z.number().int().nonnegative().optional(),
  model: z.string().optional(),
  tokens: z.object({ prompt: z.number().int(), completion: z.number().int() }).optional(),
  costUsd: z.number().nonnegative().optional(),
  stateDiff: z.array(StateDiff).optional(),
  /** Response acts classified by the platform (agent/final messages only). */
  acts: z.array(z.string()).optional(),
});
export type TraceStep = z.infer<typeof TraceStep>;

export const TraceTotals = z.object({
  latencyMs: z.number(),
  timeToFirstResponseMs: z.number(),
  toolLatencyMs: z.number(),
  modelLatencyMs: z.number(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  inputCostUsd: z.number(),
  outputCostUsd: z.number(),
  toolCostUsd: z.number(),
  costUsd: z.number(),
  toolCalls: z.number().int(),
  toolErrors: z.number().int(),
  retries: z.number().int(),
  steps: z.number().int(),
});
export type TraceTotals = z.infer<typeof TraceTotals>;

export const Trace = z.object({
  id: z.string(),
  runId: z.string(),
  scenarioId: z.string(),
  agentVersion: z.string(),
  model: z.string(),
  seed: z.number().int(),
  startedAt: z.string(),
  steps: z.array(TraceStep),
  totals: TraceTotals,
  initialState: JsonObject,
  finalState: JsonObject,
  /** Agent crashed / adapter failure. */
  infrastructureError: z.string().optional(),
});
export type Trace = z.infer<typeof Trace>;
