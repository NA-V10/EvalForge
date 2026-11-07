import Anthropic from "@anthropic-ai/sdk";
import { JUDGE_JSON_SCHEMA, JUDGE_SYSTEM, buildJudgePrompt, parseVerdict } from "./judge-prompt";
import { hashEmbed } from "./heuristic";
import type { GenerateRequest, GenerateResponse, JudgeRequest, JudgeResponse, LLMProvider } from "./types";

/** $ per 1M tokens — used only for cost attribution in telemetry. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50 },
};

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly offline = false;
  private client: Anthropic;

  constructor(
    readonly model: string = "claude-opus-5-5",
    opts: { apiKey?: string; effort?: "low" | "medium" | "high" } = {},
  ) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.effort = opts.effort ?? "medium";
  }
  private effort: "low" | "medium" | "high";

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const started = Date.now();
    // Server-side refusal fallback is enabled by default (routes declined requests to a fallback model).
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...(req.system ? { system: req.system } : {}),
      output_config: {
        effort: this.effort,
        ...(req.jsonSchema ? { format: { type: "json_schema" as const, schema: req.jsonSchema } } : {}),
      },
      messages: [{ role: "user", content: req.prompt }],
    });
    if (response.stop_reason === "refusal") throw new Error("model declined the evaluation request");
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    const price = PRICING[response.model] ?? PRICING[this.model] ?? { input: 0, output: 0 };
    const promptTokens = response.usage.input_tokens;
    const completionTokens = response.usage.output_tokens;
    return {
      text,
      model: response.model,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - started,
      costUsd: (promptTokens * price.input + completionTokens * price.output) / 1_000_000,
    };
  }

  async evaluate(req: JudgeRequest): Promise<JudgeResponse> {
    const res = await this.generate({
      system: JUDGE_SYSTEM,
      prompt: buildJudgePrompt(req),
      jsonSchema: JUDGE_JSON_SCHEMA,
      maxTokens: 4000,
    });
    return { ...parseVerdict(res.text), judge: `anthropic:${res.model}`, latencyMs: res.latencyMs, costUsd: res.costUsd };
  }

  /** Anthropic has no embeddings endpoint; fall back to the local hashed embedding. */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => hashEmbed(t));
  }
}
