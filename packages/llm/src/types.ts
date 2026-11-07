import type { JudgeVerdict } from "@rel/core";

export interface GenerateRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** JSON schema the output must conform to (structured outputs). */
  jsonSchema?: Record<string, unknown>;
}

export interface GenerateResponse {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  costUsd: number;
}

/** Compact, redacted view of a trace that judges reason over. */
export interface JudgeTraceStep {
  index: number;
  type: string;
  tool?: string;
  content?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  status?: string;
}

export interface JudgeRequest {
  criterion: { id: string; name: string; dimension: string; rubric: string };
  scenario: {
    id: string;
    name: string;
    description: string;
    userGoal: string;
    expectedOutcome: string;
    mustMention: string[];
    context: Record<string, unknown>;
  };
  steps: JudgeTraceStep[];
  finalResponse: string;
  finalResponseStep: number;
}

export interface JudgeResponse extends JudgeVerdict {
  judge: string;
  latencyMs: number;
  costUsd: number;
}

/**
 * Provider abstraction. The evaluation framework never depends on the agent's model provider —
 * judges and the scenario compiler use whichever provider is configured here.
 */
export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  /** True when the provider is a deterministic offline fallback (no network model). */
  readonly offline: boolean;
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  evaluate(req: JudgeRequest): Promise<JudgeResponse>;
  embed(texts: string[]): Promise<number[][]>;
}
