import { newId, seedFrom, type AgentAdapter, type ScenarioResult, type ScenarioSpec, type ToolDefinition, type Trace } from "@rel/core";
import { evaluateTrace, type EvaluatorConfig } from "./evaluate";
import { executeScenario, type ModelPricing } from "./harness";
import { aggregateRun } from "./metrics";

export interface SuiteOptions {
  runId: string;
  agentVersion: string;
  specs: { spec: ScenarioSpec; version: number }[];
  tools: Map<string, ToolDefinition>;
  adapter: { create(): AgentAdapter; model: string; pricing: Record<string, ModelPricing> };
  evaluator: EvaluatorConfig;
  seed: number;
  concurrency?: number;
  onResult?(result: ScenarioResult, trace: Trace, progress: { completed: number; total: number }): Promise<void> | void;
  signal?: AbortSignal;
}

/** Execute and evaluate a set of scenarios with bounded concurrency. */
export async function runSuite(opts: SuiteOptions) {
  const results: ScenarioResult[] = [];
  const traces: Trace[] = [];
  let next = 0;
  let completed = 0;
  const total = opts.specs.length;

  const worker = async () => {
    while (next < total) {
      if (opts.signal?.aborted) return;
      const { spec, version } = opts.specs[next++]!;
      const trace = await executeScenario(spec, opts.tools, opts.adapter.create(), {
        runId: opts.runId,
        seed: seedFrom(opts.seed, spec.id),
        agentVersion: opts.agentVersion,
        model: opts.adapter.model,
        pricing: opts.adapter.pricing,
      });
      const result = await evaluateTrace(spec, trace, opts.tools, opts.evaluator, {
        runId: opts.runId,
        resultId: newId("res"),
        agentVersion: opts.agentVersion,
        scenarioVersion: version,
      });
      results.push(result);
      traces.push(trace);
      completed++;
      await opts.onResult?.(result, trace, { completed, total });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, total)) }, worker));
  const order = new Map(opts.specs.map((s, i) => [s.spec.id, i]));
  results.sort((a, b) => order.get(a.scenarioId)! - order.get(b.scenarioId)!);
  return { results, traces, metrics: aggregateRun(results) };
}
