export interface GateResult {
  decision: "PASS" | "BLOCKED";
  checks: { id: string; label: string; threshold: string; actual: string; passed: boolean; detail?: string }[];
  reasons: string[];
  report: string;
  runId: string;
  baselineRunId: string | null;
}
