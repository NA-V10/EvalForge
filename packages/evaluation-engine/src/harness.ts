import {
  deepClone,
  newId,
  seededRandom,
  type AgentAdapter,
  type AgentRuntime,
  type ConversationMessage,
  type ModelUsage,
  type ScenarioSpec,
  type ToolCallOutcome,
  type ToolDefinition,
  type Trace,
  type TraceStep,
} from "@rel/core";
import { classifyActs } from "@rel/trajectory-engine";
import { ToolSimulator } from "./simulator";

export interface ModelPricing {
  /** $ per 1M tokens */
  input: number;
  output: number;
}

export interface ExecuteOptions {
  runId: string;
  seed: number;
  agentVersion: string;
  model: string;
  pricing: Record<string, ModelPricing>;
  /** Wall-clock anchor; step timestamps = startedAt + simulated offset (reproducible). */
  startedAt?: Date;
}

/**
 * Runs one scenario against one agent. The platform owns the tool runtime, so every tool call,
 * result, state change, model call and message is captured identically for any adapter.
 */
export async function executeScenario(
  spec: ScenarioSpec,
  toolLibrary: Map<string, ToolDefinition>,
  adapter: AgentAdapter,
  opts: ExecuteOptions,
): Promise<Trace> {
  const tools = new Map(spec.availableTools.filter((t) => toolLibrary.has(t)).map((t) => [t, toolLibrary.get(t)!]));
  const initialState = deepClone(spec.context);
  const world = deepClone(spec.context);
  const random = seededRandom(opts.seed);
  const sim = new ToolSimulator(tools, world, spec.toolFaults, seededRandom(opts.seed ^ 0x9e3779b9));
  const start = opts.startedAt ?? new Date("2026-01-01T00:00:00Z");

  const steps: TraceStep[] = [];
  let clock = 0;
  let toolCalls = 0;
  let pending: { tokens: { prompt: number; completion: number }; costUsd: number; durationMs: number; model: string } | null = null;
  const totals = { model: 0, tool: 0, prompt: 0, completion: 0, inCost: 0, outCost: 0, toolCost: 0, toolErrors: 0, retries: 0 };
  let firstResponseAt: number | null = null;
  const callSignatures = new Map<string, number>();

  const push = (s: Omit<TraceStep, "index" | "timestamp" | "offsetMs" | "durationMs"> & { durationMs?: number }): TraceStep => {
    const step: TraceStep = {
      ...s,
      durationMs: s.durationMs ?? 0,
      index: steps.length + 1,
      offsetMs: clock,
      timestamp: new Date(start.getTime() + clock).toISOString(),
    };
    steps.push(step);
    return step;
  };
  const takePending = () => {
    const p = pending;
    pending = null;
    return p ? { tokens: p.tokens, costUsd: p.costUsd, model: p.model, durationMs: p.durationMs } : {};
  };

  const runtime: AgentRuntime = {
    tools: [...tools.values()],
    random,
    recordModelUsage(u: ModelUsage) {
      const price = opts.pricing[u.model] ?? { input: 0, output: 0 };
      const inCost = (u.promptTokens * price.input) / 1_000_000;
      const outCost = (u.completionTokens * price.output) / 1_000_000;
      totals.prompt += u.promptTokens;
      totals.completion += u.completionTokens;
      totals.inCost += inCost;
      totals.outCost += outCost;
      totals.model += u.latencyMs;
      clock += u.latencyMs;
      pending = {
        model: u.model,
        tokens: { prompt: (pending?.tokens.prompt ?? 0) + u.promptTokens, completion: (pending?.tokens.completion ?? 0) + u.completionTokens },
        costUsd: (pending?.costUsd ?? 0) + inCost + outCost,
        durationMs: (pending?.durationMs ?? 0) + u.latencyMs,
      };
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
      const callId = newId("call");
      const sig = `${name}:${JSON.stringify(args)}`;
      const retry = callSignatures.get(sig) ?? 0;
      callSignatures.set(sig, retry + 1);
      if (retry > 0) totals.retries++;
      push({ type: "tool_call", tool: name, callId, arguments: deepClone(args), retry, ...takePending() });

      if (toolCalls >= spec.limits.maxToolCalls) {
        const error = { code: "BUDGET_EXCEEDED", message: `tool-call budget of ${spec.limits.maxToolCalls} exhausted` };
        push({ type: "tool_result", tool: name, callId, status: "error", error, durationMs: 0 });
        totals.toolErrors++;
        return { ok: false, error };
      }
      toolCalls++;
      const r = sim.call(name, args);
      clock += r.latencyMs;
      totals.tool += r.latencyMs;
      totals.toolCost += r.costUsd;
      if (!r.ok) totals.toolErrors++;
      push({
        type: "tool_result",
        tool: name,
        callId,
        status: r.ok ? "ok" : "error",
        result: r.ok ? deepClone(r.result) : undefined,
        error: r.error,
        durationMs: r.latencyMs,
        costUsd: r.costUsd || undefined,
      });
      if (r.stateDiff.length) push({ type: "state_change", tool: name, callId, stateDiff: r.stateDiff });
      return r.ok ? { ok: true, result: deepClone(r.result) } : { ok: false, error: r.error };
    },
  };

  const conversation: ConversationMessage[] = spec.history.map((h) => ({ ...h }));
  const userTurns = [{ message: spec.userInput, onlyIfAsked: false }, ...spec.turns];
  let infrastructureError: string | undefined;

  for (let t = 0; t < userTurns.length; t++) {
    const turn = userTurns[t]!;
    if (t > 0 && turn.onlyIfAsked) {
      const last = [...steps].reverse().find((s) => s.type === "agent_message");
      if (!last?.acts?.includes("ask_clarification")) break;
    }
    if (steps.length >= spec.limits.maxSteps) {
      push({ type: "error", error: { code: "MAX_STEPS", message: `step limit ${spec.limits.maxSteps} reached` } });
      break;
    }
    push({ type: "user_message", content: turn.message });
    conversation.push({ role: "user", content: turn.message });
    try {
      const out = await adapter.respond({ conversation: [...conversation], message: turn.message }, runtime);
      const acts = classifyActs(out.message);
      firstResponseAt ??= clock;
      push({ type: "agent_message", content: out.message, acts, ...takePending() });
      conversation.push({ role: "agent", content: out.message });
    } catch (err) {
      infrastructureError = err instanceof Error ? err.message : String(err);
      push({ type: "error", error: { code: "AGENT_ERROR", message: infrastructureError } });
      break;
    }
  }

  // The last agent message is the final response.
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i]!.type === "agent_message") {
      steps[i] = { ...steps[i]!, type: "final_response" };
      break;
    }
  }

  return {
    id: newId("trc"),
    runId: opts.runId,
    scenarioId: spec.id,
    agentVersion: opts.agentVersion,
    model: opts.model,
    seed: opts.seed,
    startedAt: start.toISOString(),
    steps,
    totals: {
      latencyMs: clock,
      timeToFirstResponseMs: firstResponseAt ?? clock,
      toolLatencyMs: totals.tool,
      modelLatencyMs: totals.model,
      promptTokens: totals.prompt,
      completionTokens: totals.completion,
      inputCostUsd: totals.inCost,
      outputCostUsd: totals.outCost,
      toolCostUsd: totals.toolCost,
      costUsd: totals.inCost + totals.outCost + totals.toolCost,
      toolCalls,
      toolErrors: totals.toolErrors,
      retries: totals.retries,
      steps: steps.length,
    },
    initialState,
    finalState: world,
    infrastructureError,
  };
}
