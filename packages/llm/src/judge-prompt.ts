import { JudgeVerdict } from "@rel/core";
import type { JudgeRequest } from "./types";

export const JUDGE_SYSTEM = `You are an evaluator inside an agent reliability platform. You grade ONE criterion of an AI agent's behaviour using its execution trace.
Rules:
- Ground every judgement in specific trace steps; cite them by step number in "evidence".
- Do not reward plausible-sounding text that is not supported by tool results or the scenario context.
- "score" is between 0 and 1. "confidence" reflects how certain you are given the evidence (0-1).
- Return only the JSON object described by the schema.`;

export const JUDGE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["score", "reason", "evidence", "confidence"],
  properties: {
    score: { type: "number" },
    reason: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["trace_step", "explanation"],
        properties: { trace_step: { type: "integer" }, explanation: { type: "string" } },
      },
    },
    confidence: { type: "number" },
  },
};

export function buildJudgePrompt(req: JudgeRequest): string {
  const steps = req.steps
    .map((s) => {
      const parts = [`#${s.index} ${s.type}`];
      if (s.tool) parts.push(`tool=${s.tool}`);
      if (s.status) parts.push(`status=${s.status}`);
      if (s.arguments) parts.push(`args=${JSON.stringify(s.arguments)}`);
      if (s.result !== undefined) parts.push(`result=${JSON.stringify(s.result).slice(0, 800)}`);
      if (s.content) parts.push(`content=${JSON.stringify(s.content.slice(0, 1200))}`);
      return parts.join(" ");
    })
    .join("\n");
  return `CRITERION: ${req.criterion.name} (${req.criterion.dimension})
RUBRIC: ${req.criterion.rubric}

SCENARIO ${req.scenario.id}: ${req.scenario.name}
${req.scenario.description}
User goal: ${req.scenario.userGoal}
Expected outcome: ${req.scenario.expectedOutcome}

TRACE:
${steps}

FINAL RESPONSE (step ${req.finalResponseStep}):
${req.finalResponse}`;
}

/** Strictly parse a judge's output. A bare PASS/FAIL or malformed object is rejected. */
export function parseVerdict(text: string): JudgeVerdict {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("judge returned no JSON object");
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const clamp = (n: unknown) => Math.min(1, Math.max(0, Number(n)));
  return JudgeVerdict.parse({ ...raw, score: clamp(raw.score), confidence: clamp(raw.confidence) });
}
