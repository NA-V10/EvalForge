import type { ActualAction, ArgMatcher, ExpectedStep, FirstDivergence, Severity, Trace } from "@rel/core";
import { getFact, stateBefore, type FactContext } from "./facts";
import { formatAction, isRespond } from "./trajectory";

export interface DivergenceInput {
  expected: ExpectedStep[];
  actual: ActualAction[];
  forbidden: string[];
  allowed: string[];
  trace: Trace;
  finalResponse: string;
}

export interface ArgMismatch {
  arg: string;
  expected: string;
  actual: unknown;
}

export function checkArgs(
  matchers: Record<string, ArgMatcher> | undefined,
  args: Record<string, unknown> | undefined,
  ctx: FactContext,
): ArgMismatch[] {
  if (!matchers) return [];
  const out: ArgMismatch[] = [];
  for (const [name, m] of Object.entries(matchers)) {
    const v = args?.[name];
    if ("equals" in m) {
      if (JSON.stringify(v) !== JSON.stringify(m.equals)) out.push({ arg: name, expected: JSON.stringify(m.equals), actual: v });
    } else if ("fromFact" in m) {
      const f = getFact(m.fromFact, ctx);
      if (JSON.stringify(v) !== JSON.stringify(f)) out.push({ arg: name, expected: `${m.fromFact} (${JSON.stringify(f)})`, actual: v });
    } else if ("matches" in m) {
      if (!new RegExp(m.matches, "i").test(String(v ?? ""))) out.push({ arg: name, expected: `/${m.matches}/`, actual: v });
    } else if ("oneOf" in m) {
      if (!m.oneOf.some((x) => JSON.stringify(x) === JSON.stringify(v))) out.push({ arg: name, expected: `one of ${JSON.stringify(m.oneOf)}`, actual: v });
    } else if ("lteFact" in m) {
      const f = Number(getFact(m.lteFact, ctx));
      if (!(Number(v) <= f)) out.push({ arg: name, expected: `<= ${m.lteFact} (${f})`, actual: v });
    }
  }
  return out;
}

function argsAt(trace: Trace, stepIndex: number) {
  return trace.steps.find((s) => s.index === stepIndex)?.arguments;
}

/**
 * Walk expected vs actual and return the earliest point where behaviour diverges.
 *
 * Tolerated (not divergence): optional expected steps that are skipped, retries of the step just
 * matched, extra response acts, and extra read-only tool calls. Everything else — a forbidden or
 * unexpected destructive action, a required step done out of order, a required step missing,
 * or a required step called with wrong arguments — is a divergence.
 */
export function findFirstDivergence(input: DivergenceInput): FirstDivergence | null {
  const { expected: E, actual: A, forbidden } = input;
  const ctxFor = (step: number): FactContext => ({ trace: input.trace, finalResponse: input.finalResponse, live: stateBefore(input.trace, step) });
  let j = 0;

  for (let p = 0; p < A.length; p++) {
    const a = A[p]!;
    const position = p + 1;

    if (forbidden.includes(a.action)) {
      return {
        position,
        traceStep: a.traceStep,
        expected: E[j]?.action ?? null,
        actual: a.action,
        kind: "forbidden_action",
        severity: a.destructive ? "critical" : "high",
        reason: `${formatAction(a.action)} is a forbidden action for this scenario${E[j] ? `; expected ${formatAction(E[j]!.action)}` : ""}.`,
      };
    }

    // Match the next expected step, skipping optional steps ahead of it.
    let k = j;
    while (k < E.length && E[k]!.action !== a.action && E[k]!.optional) k++;
    if (k < E.length && E[k]!.action === a.action) {
      const mism = checkArgs(E[k]!.args, argsAt(input.trace, a.traceStep), ctxFor(a.traceStep));
      if (mism.length > 0) {
        return {
          position,
          traceStep: a.traceStep,
          expected: E[k]!.action,
          actual: a.action,
          kind: "wrong_arguments",
          severity: a.destructive ? "critical" : "medium",
          reason: `${formatAction(a.action)} called with wrong arguments: ${mism.map((m) => `${m.arg}=${JSON.stringify(m.actual)} (expected ${m.expected})`).join(", ")}.`,
        };
      }
      j = k + 1;
      continue;
    }

    // Retry of the previously matched step.
    if (j > 0 && E[j - 1]!.action === a.action) continue;

    const later = E.findIndex((e, idx) => idx >= j && e.action === a.action);
    if (later >= 0) {
      const missing = E[j]!;
      return {
        position,
        traceStep: a.traceStep,
        expected: missing.action,
        actual: a.action,
        kind: isRespond(missing.action) ? "missing_action" : "wrong_order",
        severity: a.destructive ? "critical" : "high",
        reason: `Expected ${formatAction(missing.action)} before ${formatAction(a.action)}.`,
      };
    }

    if (isRespond(a.action)) continue; // extra response acts are tolerated (checked by outcome assertions)
    if (!a.destructive) continue; // extra read-only call — an efficiency concern, not a divergence

    return {
      position,
      traceStep: a.traceStep,
      expected: E[j]?.action ?? null,
      actual: a.action,
      kind: "unexpected_action",
      severity: "critical",
      reason: `Unexpected destructive action ${formatAction(a.action)}${E[j] ? ` where ${formatAction(E[j]!.action)} was expected` : ""}.`,
    };
  }

  const remaining = E.slice(j).filter((e) => !e.optional);
  if (remaining.length > 0) {
    const missing = remaining[0]!;
    const severity: Severity = isRespond(missing.action) ? "medium" : "high";
    return {
      position: A.length + 1,
      traceStep: null,
      expected: missing.action,
      actual: null,
      kind: "missing_action",
      severity,
      reason: `The conversation ended without ${formatAction(missing.action)}.`,
    };
  }
  return null;
}

/** Longest-common-subsequence alignment of required expected actions vs actual — 0..1. */
export function trajectoryAlignment(expected: ExpectedStep[], actual: ActualAction[]): number {
  const e = expected.filter((s) => !s.optional).map((s) => s.action);
  if (e.length === 0) return 1;
  const a = actual.map((x) => x.action);
  const dp: number[][] = Array.from({ length: e.length + 1 }, () => new Array<number>(a.length + 1).fill(0));
  for (let i = 1; i <= e.length; i++)
    for (let k = 1; k <= a.length; k++)
      dp[i]![k] = e[i - 1] === a[k - 1] ? dp[i - 1]![k - 1]! + 1 : Math.max(dp[i - 1]![k]!, dp[i]![k - 1]!);
  return dp[e.length]![a.length]! / e.length;
}
