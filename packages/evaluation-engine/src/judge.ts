import type { JudgeResult, ScenarioSpec, Trace } from "@rel/core";
import type { JudgeTraceStep, LLMProvider } from "@rel/llm";

export type Redactor = (value: unknown) => unknown;

/** Layer 2 — semantic evaluation. Every verdict is structured, evidence-bearing and confidence-scored. */
export async function runJudges(
  spec: ScenarioSpec,
  trace: Trace,
  final: { text: string; step: number },
  provider: LLMProvider,
  redact: Redactor = (v) => v,
): Promise<JudgeResult[]> {
  if (spec.evaluationCriteria.length === 0) return [];
  // Traces may hold customer data: redact before anything leaves the process.
  const steps: JudgeTraceStep[] = trace.steps.map((s) => ({
    index: s.index,
    type: s.type,
    tool: s.tool,
    status: s.status,
    content: s.content ? String(redact(s.content)) : undefined,
    arguments: s.arguments ? (redact(s.arguments) as Record<string, unknown>) : undefined,
    result: s.result !== undefined ? redact(s.result) : s.error ? { error: s.error } : undefined,
  }));
  const results: JudgeResult[] = [];
  for (const c of spec.evaluationCriteria) {
    const base = { criterionId: c.id, criterionName: c.name, dimension: c.dimension, threshold: c.threshold, blocking: c.blocking };
    try {
      const v = await provider.evaluate({
        criterion: { id: c.id, name: c.name, dimension: c.dimension, rubric: c.rubric },
        scenario: {
          id: spec.id,
          name: spec.name,
          description: spec.description,
          userGoal: spec.userInput,
          expectedOutcome: spec.expectedOutcome.summary,
          mustMention: spec.expectedOutcome.mustMention,
          context: redact(spec.context) as Record<string, unknown>,
        },
        steps,
        finalResponse: String(redact(final.text)),
        finalResponseStep: final.step,
      });
      results.push({ ...base, ...v, passed: v.score >= c.threshold });
    } catch (err) {
      results.push({
        ...base,
        score: 0,
        reason: `Judge execution failed: ${err instanceof Error ? err.message : String(err)}`,
        evidence: [],
        confidence: 0,
        judge: "error",
        passed: !c.blocking,
        latencyMs: 0,
        costUsd: 0,
      });
    }
  }
  return results;
}
