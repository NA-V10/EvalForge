import { deepClone, resolvePath, setPath, stableStringify, type Condition, type Trace, type TraceStep } from "@rel/core";

/** Everything a condition can reference. `live` is the world state at the moment being checked. */
export interface FactContext {
  trace: Trace;
  live?: Record<string, unknown>;
  finalResponse: string;
}

export function finalResponseOf(trace: Trace): { text: string; step: number } {
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    const s = trace.steps[i]!;
    if (s.type === "final_response" || s.type === "agent_message") return { text: s.content ?? "", step: s.index };
  }
  return { text: "", step: trace.steps.at(-1)?.index ?? 1 };
}

/** All agent-authored text (every agent turn). */
export function allAgentText(trace: Trace): string {
  return trace.steps
    .filter((s) => s.type === "agent_message" || s.type === "final_response")
    .map((s) => s.content ?? "")
    .join("\n");
}

export function toolResults(trace: Trace): { call: TraceStep; result: TraceStep | undefined }[] {
  const calls = trace.steps.filter((s) => s.type === "tool_call");
  return calls.map((call) => ({
    call,
    result: trace.steps.find((s) => s.type === "tool_result" && s.callId === call.callId),
  }));
}

/** World state immediately before `stepIndex`, reconstructed by replaying recorded state diffs. */
export function stateBefore(trace: Trace, stepIndex: number): Record<string, unknown> {
  const state = deepClone(trace.initialState);
  for (const s of trace.steps) {
    if (s.index >= stepIndex) break;
    for (const d of s.stateDiff ?? []) setPath(state, d.path, deepClone(d.after));
  }
  return state;
}

function unrecoveredFailure(trace: Trace): boolean {
  const pairs = toolResults(trace);
  return pairs.some(({ call, result }, i) => {
    if (result?.status !== "error") return false;
    // recovered if the same tool later succeeded
    return !pairs.slice(i + 1).some((p) => p.call.tool === call.tool && p.result?.status === "ok");
  });
}

export function getFact(path: string, ctx: FactContext): unknown {
  const [head, ...rest] = path.split(".");
  const tail = rest.join(".");
  const pairs = () => toolResults(ctx.trace);
  switch (head) {
    case "state":
      return resolvePath(ctx.trace.initialState, tail);
    case "final":
      return resolvePath(ctx.trace.finalState, tail);
    case "live":
      return resolvePath(ctx.live ?? ctx.trace.finalState, tail);
    case "called":
      return pairs().some((p) => p.call.tool === tail);
    case "succeeded":
      return pairs().some((p) => p.call.tool === tail && p.result?.status === "ok");
    case "failed":
      return pairs().some((p) => p.call.tool === tail && p.result?.status === "error");
    case "count":
      return pairs().filter((p) => p.call.tool === tail).length;
    case "any_failed":
      return pairs().some((p) => p.result?.status === "error");
    case "unrecovered_failure":
      return unrecoveredFailure(ctx.trace);
    case "response":
      return ctx.finalResponse;
    default:
      throw new Error(`Unknown fact namespace in "${path}"`);
  }
}

function eq(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function includes(a: unknown, v: unknown): boolean {
  if (Array.isArray(a)) return a.some((x) => eq(x, v));
  if (typeof a === "string" && typeof v === "string") return a.includes(v);
  return eq(a, v);
}

export function evaluateCondition(cond: Condition, ctx: FactContext): boolean {
  if ("all" in cond) return cond.all.every((c) => evaluateCondition(c, ctx));
  if ("any" in cond) return cond.any.some((c) => evaluateCondition(c, ctx));
  if ("not" in cond) return !evaluateCondition(cond.not, ctx);
  const a = getFact(cond.fact, ctx);
  const v = cond.value;
  switch (cond.op) {
    case "eq":
      return eq(a, v);
    case "neq":
      return !eq(a, v);
    case "in":
      return Array.isArray(v) && v.some((x) => eq(x, a));
    case "nin":
      return !(Array.isArray(v) && v.some((x) => eq(x, a)));
    case "exists":
      return a !== undefined && a !== null && !(Array.isArray(a) && a.length === 0);
    case "missing":
      return a === undefined || a === null || (Array.isArray(a) && a.length === 0);
    case "gt":
      return Number(a) > Number(v);
    case "gte":
      return Number(a) >= Number(v);
    case "lt":
      return Number(a) < Number(v);
    case "lte":
      return Number(a) <= Number(v);
    case "matches":
      return new RegExp(String(v), "i").test(String(a ?? ""));
    case "includes":
      return includes(a, v);
    case "excludes":
      return !includes(a, v);
  }
}

/** Describe the concrete fact values behind a condition — used as failure evidence. */
export function explainFacts(cond: Condition, ctx: FactContext, out: { path: string; value: unknown }[] = []) {
  if ("all" in cond) cond.all.forEach((c) => explainFacts(c, ctx, out));
  else if ("any" in cond) cond.any.forEach((c) => explainFacts(c, ctx, out));
  else if ("not" in cond) explainFacts(cond.not, ctx, out);
  else out.push({ path: cond.fact, value: getFact(cond.fact, ctx) });
  return out;
}
