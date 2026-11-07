import { z } from "zod";
import { Severity } from "./primitives";

/**
 * Fact references used by conditions:
 *  - `state.<path>`      initial world state (scenario context)
 *  - `final.<path>`      world state after execution
 *  - `live.<path>`       world state at the moment of the step being checked (temporal rules)
 *  - `called.<tool>`     tool was called (boolean)
 *  - `succeeded.<tool>`  tool was called and returned success
 *  - `failed.<tool>`     tool was called and returned an error
 *  - `count.<tool>`      number of calls to tool
 *  - `response`          final agent response text
 *  - `any_failed`        at least one tool call returned an error
 * Paths may use `*` wildcards (`live.refunds.*.status`), which resolve to an array of values;
 * use `includes` / `excludes` against those.
 */
export const ConditionOp = z.enum(["eq", "neq", "in", "nin", "exists", "missing", "gt", "gte", "lt", "lte", "matches", "includes", "excludes"]);
export type ConditionOp = z.infer<typeof ConditionOp>;

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: string; op: ConditionOp; value?: unknown };

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(Condition) }),
    z.object({ any: z.array(Condition) }),
    z.object({ not: Condition }),
    z.object({ fact: z.string(), op: ConditionOp, value: z.unknown().optional() }),
  ]),
) as z.ZodType<Condition>;

export const ArgMatcher = z.union([
  z.object({ equals: z.unknown() }),
  z.object({ fromFact: z.string() }),
  z.object({ matches: z.string() }),
  z.object({ oneOf: z.array(z.unknown()) }),
  /** Numeric argument must be <= the value of a fact (e.g. refund amount <= order total). */
  z.object({ lteFact: z.string() }),
]);
export type ArgMatcher = z.infer<typeof ArgMatcher>;

/** Executable rule body. Evaluated against the trace + world state. */
export const RuleAssertion = z.discriminatedUnion("type", [
  /** Tool(s) must never be called. */
  z.object({ type: z.literal("never_call"), tools: z.array(z.string()) }),
  /** No tool flagged `destructive` may be called. */
  z.object({ type: z.literal("no_destructive_action") }),
  z.object({ type: z.literal("must_call"), tool: z.string() }),
  /** If `then` is called, `first` must have *succeeded* earlier in the trace. */
  z.object({ type: z.literal("call_before"), first: z.string(), then: z.string() }),
  /** Temporal: at the moment `tool` is called, `requires` must hold (evaluated on `live.*` state). */
  z.object({ type: z.literal("call_only_when"), tool: z.string(), requires: Condition }),
  /** Temporal: every destructive tool call requires `requires` to hold at the moment of the call. */
  z.object({ type: z.literal("destructive_only_when"), requires: Condition }),
  /** Platform-classified response acts must (not) appear in the final response. */
  z.object({ type: z.literal("acts_exclude"), acts: z.array(z.string()) }),
  z.object({ type: z.literal("acts_include"), acts: z.array(z.string()) }),
  z.object({ type: z.literal("response_matches"), pattern: z.string(), flags: z.string().default("i") }),
  z.object({ type: z.literal("response_not_matches"), pattern: z.string(), flags: z.string().default("i") }),
  /** Response must not contain any value found at these state paths (data-leak guard). */
  z.object({ type: z.literal("no_leak"), statePaths: z.array(z.string()) }),
  z.object({ type: z.literal("max_calls"), tool: z.string().optional(), max: z.number().int().nonnegative() }),
  z.object({ type: z.literal("args_match"), tool: z.string(), args: z.record(z.string(), ArgMatcher) }),
  z.object({ type: z.literal("state"), check: Condition }),
]);
export type RuleAssertion = z.infer<typeof RuleAssertion>;

export const INVARIANT_KINDS = ["precondition", "postcondition", "forbidden_action", "ordering", "state", "temporal"] as const;
export const InvariantKind = z.enum(INVARIANT_KINDS);
export type InvariantKind = z.infer<typeof InvariantKind>;

export const Invariant = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9]*-\d{3}$/, "Invariant ids look like BILL-001"),
  name: z.string(),
  description: z.string(),
  severity: Severity,
  kind: InvariantKind,
  /** When the invariant applies. Omitted = always. */
  condition: Condition.optional(),
  assertion: RuleAssertion,
});
export type Invariant = z.infer<typeof Invariant>;
export type InvariantInput = z.input<typeof Invariant>;
