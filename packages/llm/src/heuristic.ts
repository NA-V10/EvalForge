import { createHash } from "node:crypto";
import { leafValues } from "@rel/core";
import type { GenerateRequest, GenerateResponse, JudgeRequest, JudgeResponse, LLMProvider } from "./types";

const STATUS_WORDS = [
  "pending",
  "approved",
  "processed",
  "completed",
  "cancelled",
  "canceled",
  "refunded",
  "active",
  "suspended",
  "shipped",
  "delivered",
  "failed",
  "paid",
  "overdue",
  "locked",
  "expired",
  "confirmed",
];

/** Extract checkable factual claims (amounts, ids, dates, statuses, counts) from a response. */
export function extractClaims(text: string): string[] {
  const claims = new Set<string>();
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)) claims.add(m[1]!.replace(/,/g, ""));
  for (const m of text.matchAll(/\b[A-Z]{2,5}-\d{2,6}\b/g)) claims.add(m[0]);
  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) claims.add(m[0]);
  for (const m of text.matchAll(/\b\d{2}:\d{2}\b/g)) claims.add(m[0]);
  const lower = text.toLowerCase().replace(/[’]/g, "'");
  for (const w of STATUS_WORDS) {
    // Only affirmative status claims count: "has not been cancelled" / "can't be refunded" are not claims.
    const affirmative = [...lower.matchAll(new RegExp(`\\b${w}\\b`, "g"))].some((m) => {
      const before = lower.slice(Math.max(0, m.index! - 24), m.index!);
      return !/\b(not|n't|never|no longer|cannot|unable to)\b[^.]*$/.test(before);
    });
    if (affirmative) claims.add(w);
  }
  return [...claims];
}

function normalize(v: unknown): string {
  return String(v).toLowerCase().replace(/,/g, "");
}

function supported(claim: string, corpus: string[]): boolean {
  const c = claim.toLowerCase();
  if (/^\d+(\.\d+)?$/.test(c)) {
    const n = Number(c);
    return corpus.some((v) => {
      const num = Number(v);
      return (!Number.isNaN(num) && Math.abs(num - n) < 0.005) || v.includes(c);
    });
  }
  // cancelled/canceled are the same claim
  const variants = c === "canceled" ? ["canceled", "cancelled"] : c === "cancelled" ? ["cancelled", "canceled"] : [c];
  return corpus.some((v) => variants.some((x) => v.includes(x)));
}

const STOP = new Set("i my me the a an to and or of for is it in on be can you please want would like this that with have has".split(" "));
const words = (s: string) => s.toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];

/**
 * Deterministic offline judge. Used when no LLM provider is configured, and as a cross-check.
 * Its scores are reproducible and evidence-backed but lower-confidence than a model judge.
 */
export class HeuristicProvider implements LLMProvider {
  readonly id = "heuristic";
  readonly model = "heuristic-judge-v1";
  readonly offline = true;

  async generate(_req: GenerateRequest): Promise<GenerateResponse> {
    throw new Error("The offline heuristic provider cannot generate free text. Configure ANTHROPIC_API_KEY or an OpenAI-compatible endpoint.");
  }

  async evaluate(req: JudgeRequest): Promise<JudgeResponse> {
    const base = { judge: "heuristic-judge-v1", latencyMs: 0, costUsd: 0 };
    switch (req.criterion.dimension) {
      case "grounding":
        return { ...this.grounding(req), ...base };
      case "correctness":
        return { ...this.correctness(req), ...base };
      default:
        return { ...this.quality(req), ...base };
    }
  }

  private grounding(req: JudgeRequest) {
    const corpus: string[] = [];
    for (const s of req.steps) {
      if (s.type === "tool_result" && s.status === "ok") leafValues(s.result).forEach((v) => corpus.push(normalize(v)));
      if (s.type === "user_message" && s.content) corpus.push(normalize(s.content));
    }
    const claims = extractClaims(req.finalResponse);
    if (claims.length === 0) {
      return { score: 1, reason: "The response makes no checkable factual claims.", evidence: [], confidence: 0.55 };
    }
    const unsupported = claims.filter((c) => !supported(c, corpus));
    const score = (claims.length - unsupported.length) / claims.length;
    return {
      score,
      reason:
        unsupported.length === 0
          ? `All ${claims.length} factual claims are supported by tool results or user input.`
          : `${unsupported.length}/${claims.length} claims are not supported by any successful tool result: ${unsupported.join(", ")}.`,
      evidence: unsupported.map((c) => ({
        trace_step: req.finalResponseStep,
        explanation: `Claim "${c}" does not appear in any successful tool result or user message.`,
      })),
      confidence: 0.8,
    };
  }

  private correctness(req: JudgeRequest) {
    const patterns = req.scenario.mustMention;
    if (patterns.length === 0) return { score: 1, reason: "No required content specified.", evidence: [], confidence: 0.5 };
    const missing = patterns.filter((p) => !new RegExp(p, "i").test(req.finalResponse));
    return {
      score: (patterns.length - missing.length) / patterns.length,
      reason: missing.length ? `Response omits required content: ${missing.join("; ")}` : "Response covers all required content.",
      evidence: missing.map((p) => ({ trace_step: req.finalResponseStep, explanation: `Missing /${p}/` })),
      confidence: 0.75,
    };
  }

  private quality(req: JudgeRequest) {
    const r = req.finalResponse;
    const lower = r.toLowerCase();
    const checks: { ok: boolean; weight: number; note: string }[] = [];
    checks.push({ ok: r.trim().length > 0, weight: 0.2, note: "non-empty response" });
    const goal = new Set(words(req.scenario.userGoal));
    const overlap = words(r).filter((w) => goal.has(w)).length;
    checks.push({ ok: goal.size === 0 || overlap > 0, weight: 0.2, note: "addresses the user's request" });
    const declines = /\b(can't|cannot|unable|not able|won't be able)\b/.test(lower);
    const explains = /\b(because|since|while|until|policy|requires?|need to|must)\b/.test(lower);
    checks.push({ ok: !declines || explains, weight: 0.25, note: "explains any refusal" });
    checks.push({
      ok: /\b(you can|i can|would you like|next step|once|ticket|reply|let me know|follow up|team will)\b/.test(lower),
      weight: 0.2,
      note: "offers a next step",
    });
    checks.push({ ok: !/\b(stupid|your fault|obviously|calm down)\b/.test(lower), weight: 0.1, note: "professional tone" });
    checks.push({ ok: r.length <= 1400, weight: 0.05, note: "concise" });
    const score = checks.reduce((a, c) => a + (c.ok ? c.weight : 0), 0);
    const failed = checks.filter((c) => !c.ok);
    return {
      score: Math.round(score * 1000) / 1000,
      reason: failed.length ? `Response quality issues: ${failed.map((c) => c.note).join(", ")} not met.` : "Response is relevant, explained, actionable and professional.",
      evidence: failed.map((c) => ({ trace_step: req.finalResponseStep, explanation: `Check failed: ${c.note}` })),
      confidence: 0.6,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => hashEmbed(t));
  }
}

/** 64-dim hashed bag-of-words embedding (offline, deterministic). */
export function hashEmbed(text: string, dims = 64): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const w of words(text)) {
    const h = createHash("md5").update(w).digest();
    v[h[0]! % dims]! += h[1]! % 2 === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i]! * b[i]!;
  return s;
}
