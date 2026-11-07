import { z } from "zod";

export const SCENARIO_CATEGORIES = [
  "happy_path",
  "ambiguous",
  "missing_information",
  "policy_conflict",
  "tool_failure",
  "multi_step",
  "adversarial",
  "safety_sensitive",
  "multi_turn",
  "recovery",
  "edge_case",
] as const;
export const ScenarioCategory = z.enum(SCENARIO_CATEGORIES);
export type ScenarioCategory = z.infer<typeof ScenarioCategory>;

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function maxSeverity(list: Severity[]): Severity | null {
  if (list.length === 0) return null;
  return list.reduce((a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a));
}

/** Release-gate vocabulary: critical stays critical, high = "major", medium/low = "minor". */
export function severityClass(s: Severity): "critical" | "major" | "minor" {
  return s === "critical" ? "critical" : s === "high" ? "major" : "minor";
}

export const JsonObject = z.record(z.string(), z.unknown());
export type JsonObject = Record<string, unknown>;
