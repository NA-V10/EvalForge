import { JUDGE_JSON_SCHEMA, JUDGE_SYSTEM, buildJudgePrompt, parseVerdict } from "./judge-prompt";
import type { GenerateRequest, GenerateResponse, JudgeRequest, JudgeResponse, LLMProvider } from "./types";

/** Any OpenAI-compatible chat-completions endpoint (vLLM, Ollama, LiteLLM, hosted gateways…). */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = "openai-compatible";
  readonly offline = false;

  constructor(
    readonly model: string,
    private opts: { baseUrl: string; apiKey?: string; embeddingModel?: string; pricing?: { input: number; output: number } },
  ) {}

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const started = Date.now();
    const data = await this.post("/chat/completions", {
      model: this.model,
      max_tokens: req.maxTokens ?? 4000,
      messages: [...(req.system ? [{ role: "system", content: req.system }] : []), { role: "user", content: req.prompt }],
      ...(req.jsonSchema
        ? { response_format: { type: "json_schema", json_schema: { name: "output", schema: req.jsonSchema, strict: true } } }
        : {}),
    });
    const choice = (data.choices as { message: { content: string } }[])[0];
    const usage = (data.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
    const p = this.opts.pricing ?? { input: 0, output: 0 };
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    return {
      text: choice?.message.content ?? "",
      model: this.model,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - started,
      costUsd: (promptTokens * p.input + completionTokens * p.output) / 1_000_000,
    };
  }

  async evaluate(req: JudgeRequest): Promise<JudgeResponse> {
    const res = await this.generate({ system: JUDGE_SYSTEM, prompt: buildJudgePrompt(req), jsonSchema: JUDGE_JSON_SCHEMA });
    return { ...parseVerdict(res.text), judge: `openai-compatible:${this.model}`, latencyMs: res.latencyMs, costUsd: res.costUsd };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const data = await this.post("/embeddings", { model: this.opts.embeddingModel ?? "text-embedding-3-small", input: texts });
    return (data.data as { embedding: number[] }[]).map((d) => d.embedding);
  }
}
