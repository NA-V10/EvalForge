import { z } from "zod";
import { JsonObject, ScenarioCategory, Severity } from "./primitives";
import { ArgMatcher, Condition, Invariant } from "./rules";
import { ToolFault } from "./tools";

/**
 * Observable response "acts". The platform classifies agent messages into acts independently
 * of the agent (the agent never self-reports), so trajectories can include response behaviour.
 */
export const RESPONSE_ACTS = [
  "refuse",
  "explain",
  "confirm_action",
  "ask_clarification",
  "escalate_notice",
  "offer_next_step",
  "provide_information",
] as const;
export const ResponseAct = z.enum(RESPONSE_ACTS);
export type ResponseAct = z.infer<typeof ResponseAct>;

/**
 * A step in the expected trajectory. `action` is either a tool name (`verify_customer`)
 * or a response act (`respond:refuse`).
 */
export const ExpectedStep = z.object({
  action: z.string(),
  description: z.string().optional(),
  optional: z.boolean().default(false),
  args: z.record(z.string(), ArgMatcher).optional(),
});
export type ExpectedStep = z.infer<typeof ExpectedStep>;

export const ExpectedOutcome = z.object({
  summary: z.string(),
  /** Conditions over `final.*` / `state.*` facts that must hold after the run. */
  finalState: z.array(Condition).default([]),
  /** Acts that must appear in the agent's final response(s). */
  requiredActs: z.array(ResponseAct).default([]),
  /** Acts that must NOT appear (e.g. `confirm_action` when the action must be refused). */
  forbiddenActs: z.array(ResponseAct).default([]),
  mustMention: z.array(z.string()).default([]),
  mustNotMention: z.array(z.string()).default([]),
  escalationRequired: z.boolean().default(false),
});
export type ExpectedOutcome = z.infer<typeof ExpectedOutcome>;

export const SemanticCriterion = z.object({
  id: z.string(),
  name: z.string(),
  dimension: z.enum(["grounding", "response_quality", "correctness"]).default("response_quality"),
  rubric: z.string(),
  threshold: z.number().min(0).max(1).default(0.6),
  /** If true, scoring below threshold fails the scenario. Otherwise metric-only. */
  blocking: z.boolean().default(false),
});
export type SemanticCriterion = z.infer<typeof SemanticCriterion>;

export const UserTurn = z.object({
  message: z.string(),
  /** Delivered only if the agent asked for clarification on the previous turn. */
  onlyIfAsked: z.boolean().default(false),
});
export type UserTurn = z.infer<typeof UserTurn>;

export const ScenarioLimits = z.object({
  maxSteps: z.number().int().positive().default(30),
  maxToolCalls: z.number().int().positive().default(12),
  maxLatencyMs: z.number().int().positive().default(15_000),
  maxCostUsd: z.number().positive().default(0.25),
});
export type ScenarioLimits = z.infer<typeof ScenarioLimits>;

export const MUTATION_STRATEGIES = [
  "missing_information",
  "ambiguous_phrasing",
  "tool_failure",
  "delayed_tool",
  "contradictory_state",
  "adversarial",
  "multi_turn",
  "irrelevant_context",
  "prompt_injection",
] as const;
export const MutationStrategy = z.enum(MUTATION_STRATEGIES);
export type MutationStrategy = z.infer<typeof MutationStrategy>;

export const ScenarioSpec = z.object({
  id: z.string().regex(/^SCN-[A-Z0-9-]+$/),
  name: z.string().min(3),
  description: z.string(),
  domain: z.string(),
  category: ScenarioCategory,
  severity: Severity,
  /** Initial world state: the simulated backend the tools operate on. */
  context: JsonObject,
  userInput: z.string().min(1),
  /** Scripted follow-up user turns for multi-turn scenarios. */
  turns: z.array(UserTurn).default([]),
  /** Optional prior conversation history (used by irrelevant-context mutations). */
  history: z.array(z.object({ role: z.enum(["user", "agent"]), content: z.string() })).default([]),
  availableTools: z.array(z.string()).min(1),
  toolFaults: z.array(ToolFault).default([]),
  expectedOutcome: ExpectedOutcome,
  expectedTrajectory: z.array(ExpectedStep).default([]),
  allowedActions: z.array(z.string()).default([]),
  forbiddenActions: z.array(z.string()).default([]),
  /** Inline invariants. */
  invariants: z.array(Invariant).default([]),
  /** References into the shared invariant library. */
  invariantRefs: z.array(z.string()).default([]),
  evaluationCriteria: z.array(SemanticCriterion).default([]),
  mutationStrategies: z.array(MutationStrategy).default([]),
  limits: ScenarioLimits.default({ maxSteps: 30, maxToolCalls: 12, maxLatencyMs: 15_000, maxCostUsd: 0.25 }),
  tags: z.array(z.string()).default([]),
  /** Present on generated variants. */
  mutation: z.object({ parentId: z.string(), strategy: MutationStrategy, description: z.string() }).optional(),
});
export type ScenarioSpec = z.infer<typeof ScenarioSpec>;
export type ScenarioSpecInput = z.input<typeof ScenarioSpec>;

/** A stored scenario: spec + versioning metadata. */
export interface Scenario extends ScenarioSpec {
  version: number;
  createdAt: string;
  updatedAt: string;
}
