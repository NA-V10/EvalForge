import type {
  ActualAction,
  AssertionResult,
  Evidence,
  FirstDivergence,
  Invariant,
  MetricDimension,
  ScenarioSpec,
  Severity,
  ToolDefinition,
  Trace,
  TraceStep,
} from "@rel/core";
import type { FactContext } from "@rel/trajectory-engine";

/** Everything assertion modules need, computed once per scenario result. */
export interface EvalContext {
  spec: ScenarioSpec;
  trace: Trace;
  tools: Map<string, ToolDefinition>;
  invariants: Invariant[];
  actual: ActualAction[];
  final: { text: string; step: number; acts: string[] };
  agentText: string;
  facts: FactContext;
  toolCalls: { call: TraceStep; result: TraceStep | undefined }[];
  divergence: FirstDivergence | null;
  alignment: number;
}

export function assertion(
  a: Pick<AssertionResult, "kind" | "name" | "layer" | "dimension" | "passed" | "severity" | "message"> & {
    key?: string;
    score?: number;
    expected?: string;
    actual?: string;
    evidence?: Evidence[];
    invariantId?: string;
    hardGate?: boolean;
  },
): AssertionResult {
  return {
    id: `${a.kind}${a.key ? `:${a.key}` : ""}`,
    layer: a.layer,
    kind: a.kind,
    name: a.name,
    dimension: a.dimension,
    passed: a.passed,
    score: a.score ?? (a.passed ? 1 : 0),
    severity: a.severity,
    message: a.message,
    expected: a.expected,
    actual: a.actual,
    evidence: a.evidence ?? [],
    invariantId: a.invariantId,
    hardGate: a.hardGate ?? false,
  };
}

export type Dim = MetricDimension;
export type Sev = Severity;
