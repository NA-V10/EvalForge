import { z } from "zod";
import type { ResponseAct } from "./scenario";
import type { ToolDefinition } from "./tools";

export const ADAPTER_KINDS = ["builtin", "http", "openai", "anthropic", "langgraph", "python"] as const;
export const AdapterKind = z.enum(ADAPTER_KINDS);
export type AdapterKind = z.infer<typeof AdapterKind>;

export const AgentVersionSpec = z.object({
  version: z.string().regex(/^v?\d+\.\d+(\.\d+)?$/),
  model: z.string(),
  modelParams: z.record(z.string(), z.unknown()).default({}),
  systemPromptVersion: z.string().default("1"),
  systemPrompt: z.string().default(""),
  toolVersion: z.string().default("1.0.0"),
  adapter: AdapterKind.default("builtin"),
  /** Adapter-specific config, e.g. builtin behaviour profile, HTTP endpoint. Secrets are referenced, never inlined. */
  config: z.record(z.string(), z.unknown()).default({}),
  changelog: z.string().default(""),
});
export type AgentVersionSpec = z.infer<typeof AgentVersionSpec>;
export type AgentVersionSpecInput = z.input<typeof AgentVersionSpec>;

export const AgentSpec = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string().default(""),
  tools: z.array(z.string()).default([]),
});
export type AgentSpec = z.infer<typeof AgentSpec>;

export interface ConversationMessage {
  role: "user" | "agent";
  content: string;
}

export interface ToolCallOutcome {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/** What a model call cost, reported by the adapter so the platform can attribute tokens/cost/latency. */
export interface ModelUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

/**
 * Runtime handed to an adapter. The platform owns trace capture: every tool call goes through
 * `callTool`, so traces are recorded identically regardless of agent framework.
 */
export interface AgentRuntime {
  tools: ToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome>;
  recordModelUsage(usage: ModelUsage): void;
  /** Deterministic randomness for reproducible agents. */
  random(): number;
}

export interface AgentTurnInput {
  conversation: ConversationMessage[];
  /** The latest user message. */
  message: string;
}

export interface AgentTurnOutput {
  message: string;
  /** Optional: agent may claim acts; the platform ignores these for scoring (it classifies independently). */
  declaredActs?: ResponseAct[];
}

/** Framework-agnostic adapter contract. */
export interface AgentAdapter {
  readonly kind: AdapterKind;
  readonly id: string;
  respond(input: AgentTurnInput, runtime: AgentRuntime): Promise<AgentTurnOutput>;
}
