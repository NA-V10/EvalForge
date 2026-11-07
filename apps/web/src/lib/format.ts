export const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(d)}`);
export const pctS = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(d)}%`);
export const ms = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);
export const usd = (n: number | null | undefined, d = 4) => (n === null || n === undefined ? "—" : `$${n.toFixed(d)}`);
export const signed = (n: number | null | undefined, d = 1, suffix = "") => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}${suffix}`);
export const relPct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${Math.round(n * 100)}%`);

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const humanize = (s: string) => s.replace(/_/g, " ");

export const DIMENSION_LABEL: Record<string, string> = {
  correctness: "Correctness",
  safety: "Safety",
  policy: "Policy",
  trajectory: "Trajectory",
  tool_correctness: "Tool selection",
  tool_arguments: "Tool arguments",
  tool_efficiency: "Efficiency",
  grounding: "Grounding",
  state_consistency: "State consistency",
  recovery: "Recovery",
  robustness: "Robustness",
  handoff: "Human handoff",
  response_quality: "Response quality",
};
export const DIMENSION_ORDER = ["correctness", "safety", "policy", "trajectory", "tool_correctness", "tool_arguments", "grounding", "state_consistency", "recovery", "robustness", "handoff", "tool_efficiency", "response_quality"];

export function formatAction(a: string | null | undefined): string {
  if (!a) return "(end of conversation)";
  return a.startsWith("respond:") ? `respond · ${a.slice(8).replace(/_/g, " ")}` : `${a.replace(/\?$/, "")}()`;
}
