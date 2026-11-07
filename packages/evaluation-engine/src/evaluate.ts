import {
  EVALUATOR_VERSION,
  type Invariant,
  type ScenarioResult,
  type ScenarioSpec,
  type ToolDefinition,
  type Trace,
} from "@rel/core";
import type { LLMProvider } from "@rel/llm";
import { extractTrajectory, finalResponseOf, allAgentText, findFirstDivergence, toolResults, trajectoryAlignment } from "@rel/trajectory-engine";
import { behavioralAssertions } from "./assertions/behavioral";
import { deterministicAssertions } from "./assertions/deterministic";
import { invariantAssertions } from "./assertions/invariants";
import type { EvalContext } from "./context";
import { diagnose } from "./diagnosis";
import { runJudges, type Redactor } from "./judge";
import { ROBUSTNESS_CATEGORIES, scenarioScores } from "./metrics";

export interface EvaluatorConfig {
  provider: LLMProvider;
  invariantLibrary: Map<string, Invariant>;
  /** Library invariants applied to every scenario (e.g. AUTH-001, PRIV-001, REL-001). */
  globalInvariants: string[];
  redact?: Redactor;
  evaluatorVersion?: string;
}

export function resolveInvariants(spec: ScenarioSpec, config: Pick<EvaluatorConfig, "invariantLibrary" | "globalInvariants">): Invariant[] {
  const out = new Map<string, Invariant>();
  for (const id of [...config.globalInvariants, ...spec.invariantRefs]) {
    const inv = config.invariantLibrary.get(id);
    if (inv) out.set(id, inv);
  }
  for (const inv of spec.invariants) out.set(inv.id, inv);
  return [...out.values()];
}

export function buildContext(spec: ScenarioSpec, trace: Trace, tools: Map<string, ToolDefinition>, invariants: Invariant[]): EvalContext {
  const final = finalResponseOf(trace);
  const acts = trace.steps.find((s) => s.index === final.step)?.acts ?? [];
  const actual = extractTrajectory(trace, tools);
  const facts = { trace, finalResponse: final.text };
  return {
    spec,
    trace,
    tools,
    invariants,
    actual,
    final: { ...final, acts },
    agentText: allAgentText(trace),
    facts,
    toolCalls: toolResults(trace),
    divergence: findFirstDivergence({
      expected: spec.expectedTrajectory,
      actual,
      forbidden: spec.forbiddenActions,
      allowed: spec.allowedActions,
      trace,
      finalResponse: final.text,
    }),
    alignment: trajectoryAlignment(spec.expectedTrajectory, actual),
  };
}

/** Evaluate a captured trace with all three layers, score it, and diagnose failures. */
export async function evaluateTrace(
  spec: ScenarioSpec,
  trace: Trace,
  tools: Map<string, ToolDefinition>,
  config: EvaluatorConfig,
  meta: { runId: string; resultId: string; agentVersion: string; scenarioVersion: number },
): Promise<ScenarioResult> {
  const ctx = buildContext(spec, trace, tools, resolveInvariants(spec, config));
  const assertions = [...deterministicAssertions(ctx), ...behavioralAssertions(ctx), ...invariantAssertions(ctx)];
  const judgments = await runJudges(spec, trace, ctx.final, config.provider, config.redact);

  const blocking = assertions.filter((a) => !a.passed && (a.hardGate || a.severity !== "low"));
  const hardGateFailed = assertions.some((a) => !a.passed && a.hardGate);
  const judgeBlocked = judgments.some((j) => j.blocking && !j.passed);
  const status = trace.infrastructureError ? "error" : blocking.length > 0 || judgeBlocked ? "failed" : "passed";

  const scores = scenarioScores(assertions, judgments);
  if (spec.mutation || ROBUSTNESS_CATEGORIES.has(spec.category)) scores.robustness = status === "passed" ? 1 : 0;

  const failures = diagnose(ctx, assertions, judgments, meta);
  const t = trace.totals;
  return {
    id: meta.resultId,
    runId: meta.runId,
    scenarioId: spec.id,
    scenarioVersion: meta.scenarioVersion,
    scenarioName: spec.name,
    category: spec.category,
    severity: spec.severity,
    parentScenarioId: spec.mutation?.parentId ?? null,
    mutationStrategy: spec.mutation?.strategy ?? null,
    status,
    outcomePassed: assertions.filter((a) => a.dimension === "correctness").every((a) => a.passed),
    trajectoryPassed: assertions
      .filter((a) => a.kind === "trajectory" || a.kind === "required_tool" || a.kind === "forbidden_action")
      .every((a) => a.passed),
    hardGateFailed,
    scores,
    operational: {
      latencyMs: t.latencyMs,
      timeToFirstResponseMs: t.timeToFirstResponseMs,
      toolLatencyMs: t.toolLatencyMs,
      costUsd: t.costUsd,
      inputCostUsd: t.inputCostUsd,
      outputCostUsd: t.outputCostUsd,
      toolCostUsd: t.toolCostUsd,
      promptTokens: t.promptTokens,
      completionTokens: t.completionTokens,
      toolCalls: t.toolCalls,
      steps: t.steps,
    },
    assertions,
    judgments,
    firstDivergence: ctx.divergence,
    expectedTrajectory: spec.expectedTrajectory.map((s) => (s.optional ? `${s.action}?` : s.action)),
    actualTrajectory: ctx.actual,
    failures,
    traceId: trace.id,
    evaluatorVersion: config.evaluatorVersion ?? EVALUATOR_VERSION,
  };
}
