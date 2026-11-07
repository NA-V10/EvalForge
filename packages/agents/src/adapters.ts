import Anthropic from "@anthropic-ai/sdk";
import type { AgentAdapter, AgentRuntime, AgentTurnInput, AgentTurnOutput, AgentVersionSpec, ToolDefinition } from "@rel/core";
import { BehaviorProfile, DEMO_PROFILES } from "./profile";
import { createSupportAgent } from "./support-agent";

const MAX_TOOL_ITERATIONS = 10;

function toJsonSchema(t: ToolDefinition) {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [k, p] of Object.entries(t.inputSchema)) {
    properties[k] = { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}), ...(p.pattern ? { pattern: p.pattern } : {}) };
  }
  return { type: "object" as const, properties, required: Object.entries(t.inputSchema).filter(([, p]) => p.required).map(([k]) => k) };
}

/**
 * Generic HTTP agent protocol (also used for LangGraph / Python agents behind a thin server):
 *   POST {endpoint}  { conversation, message, tools, tool_results? }
 *   → { type: "tool_call", name, arguments }  |  { type: "message", content }
 * The platform executes tool calls (so traces stay platform-owned) and posts results back.
 */
export class HttpAgentAdapter implements AgentAdapter {
  constructor(
    readonly id: string,
    readonly kind: "http" | "langgraph" | "python",
    private endpoint: string,
    private headers: Record<string, string> = {},
  ) {}

  async respond(input: AgentTurnInput, runtime: AgentRuntime): Promise<AgentTurnOutput> {
    const toolResults: { name: string; ok: boolean; result?: unknown; error?: unknown }[] = [];
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const started = Date.now();
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers },
        body: JSON.stringify({ ...input, tools: runtime.tools.map((t) => ({ name: t.name, description: t.description, input_schema: toJsonSchema(t) })), tool_results: toolResults }),
      });
      if (!res.ok) throw new Error(`agent endpoint returned HTTP ${res.status}`);
      const body = (await res.json()) as { type: string; name?: string; arguments?: Record<string, unknown>; content?: string; usage?: { model: string; prompt_tokens: number; completion_tokens: number } };
      if (body.usage)
        runtime.recordModelUsage({ model: body.usage.model, promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens, latencyMs: Date.now() - started });
      if (body.type === "message") return { message: body.content ?? "" };
      const r = await runtime.callTool(body.name ?? "", body.arguments ?? {});
      toolResults.push({ name: body.name ?? "", ok: r.ok, result: r.result, error: r.error });
    }
    throw new Error("agent exceeded tool iteration limit");
  }
}

/** Claude as the agent under test, via the official SDK and a manual tool-use loop. */
export class AnthropicAgentAdapter implements AgentAdapter {
  readonly kind = "anthropic" as const;
  private client = new Anthropic();
  constructor(
    readonly id: string,
    private model: string,
    private system: string,
  ) {}

  async respond(input: AgentTurnInput, runtime: AgentRuntime): Promise<AgentTurnOutput> {
    const tools: Anthropic.Tool[] = runtime.tools.map((t) => ({ name: t.name, description: t.description, input_schema: toJsonSchema(t) }));
    const messages: Anthropic.MessageParam[] = input.conversation.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const started = Date.now();
      const response = await this.client.messages.create({ model: this.model, max_tokens: 16000, system: this.system, tools, messages });
      runtime.recordModelUsage({ model: response.model, promptTokens: response.usage.input_tokens, completionTokens: response.usage.output_tokens, latencyMs: Date.now() - started });
      if (response.stop_reason === "refusal") return { message: "I'm not able to help with that request." };
      messages.push({ role: "assistant", content: response.content });
      const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || uses.length === 0) {
        return { message: response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim() };
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        const r = await runtime.callTool(u.name, (u.input ?? {}) as Record<string, unknown>);
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r.ok ? r.result : r.error), is_error: !r.ok });
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error("agent exceeded tool iteration limit");
  }
}

/** Any OpenAI-compatible chat-completions model as the agent under test. */
export class OpenAIStyleAgentAdapter implements AgentAdapter {
  readonly kind = "openai" as const;
  constructor(
    readonly id: string,
    private model: string,
    private system: string,
    private baseUrl: string,
    private apiKey?: string,
  ) {}

  async respond(input: AgentTurnInput, runtime: AgentRuntime): Promise<AgentTurnOutput> {
    const messages: Record<string, unknown>[] = [
      { role: "system", content: this.system },
      ...input.conversation.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
    ];
    const tools = runtime.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: toJsonSchema(t) } }));
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const started = Date.now();
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.model, messages, tools }),
      });
      if (!res.ok) throw new Error(`model endpoint returned HTTP ${res.status}`);
      const data = (await res.json()) as {
        choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
        usage?: { prompt_tokens: number; completion_tokens: number };
      };
      runtime.recordModelUsage({ model: this.model, promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0, latencyMs: Date.now() - started });
      const msg = data.choices[0]!.message;
      messages.push(msg as unknown as Record<string, unknown>);
      if (!msg.tool_calls?.length) return { message: msg.content ?? "" };
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          /* malformed arguments are passed through as empty and will fail schema validation */
        }
        const r = await runtime.callTool(tc.function.name, args);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(r.ok ? r.result : r.error) });
      }
    }
    throw new Error("agent exceeded tool iteration limit");
  }
}

export interface AdapterFactory {
  /** Fresh adapter per scenario execution — no state leaks between scenarios. */
  create(): AgentAdapter;
  model: string;
  pricing: Record<string, { input: number; output: number }>;
}

/** Resolve an agent version spec to an adapter factory. */
export function adapterFactoryFor(slug: string, v: AgentVersionSpec): AdapterFactory {
  const id = `${slug}@${v.version}`;
  switch (v.adapter) {
    case "builtin": {
      const profile = BehaviorProfile.parse(v.config.profile ?? DEMO_PROFILES[v.version] ?? DEMO_PROFILES["v1.0.0"]);
      return { model: profile.model, pricing: {}, create: () => createSupportAgent(v.version, profile) };
    }
    case "http":
    case "langgraph":
    case "python": {
      const endpoint = String(v.config.endpoint ?? "");
      if (!endpoint) throw new Error(`${v.adapter} adapter requires config.endpoint`);
      return { model: v.model, pricing: {}, create: () => new HttpAgentAdapter(id, v.adapter as "http", endpoint) };
    }
    case "anthropic":
      return { model: v.model, pricing: {}, create: () => new AnthropicAgentAdapter(id, v.model || "claude-opus-5-5", v.systemPrompt) };
    case "openai":
      return {
        model: v.model,
        pricing: {},
        create: () => new OpenAIStyleAgentAdapter(id, v.model, v.systemPrompt, String(v.config.baseUrl ?? "https://api.openai.com/v1"), process.env[String(v.config.apiKeyEnv ?? "OPENAI_API_KEY")]),
      };
  }
}
