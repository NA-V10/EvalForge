import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { api, type FailureRow, type Overview, type RunRow } from "../lib/api";
import { formatAction, humanize } from "../lib/format";
import { Card, Empty, ErrorBox, L, Loading, Mono, Page, Select, SeverityBadge, Table, Tag, ForkMark } from "../components/ui";

const CATS = ["outcome_failure", "tool_selection_failure", "tool_argument_failure", "tool_ordering_failure", "policy_violation", "safety_violation", "grounding_failure", "hallucination", "state_inconsistency", "recovery_failure", "escalation_failure", "efficiency_failure", "timeout", "infrastructure_failure"];

export function Failures() {
  const [params, setParams] = useSearchParams();
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/overview") });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<RunRow[]>("/evaluations/runs?limit=100") });
  const runId = params.get("runId") ?? overview.data?.latestRun?.id ?? "";
  const severity = params.get("severity") ?? "";
  const regression = params.get("regression") ?? "";
  const category = params.get("category") ?? "";
  const qs = new URLSearchParams({ ...(runId ? { runId } : {}), ...(severity ? { severity } : {}), ...(regression ? { regression } : {}), ...(category ? { category } : {}) });
  const q = useQuery({ queryKey: ["failures", qs.toString()], queryFn: () => api<FailureRow[]>(`/failures?${qs}`), enabled: !overview.isLoading });
  const set = (k: string, v: string) => setParams((p) => (v ? p.set(k, v) : p.delete(k), p), { replace: true });
  const title = regression === "true" ? "Regressions" : severity === "critical" ? "Critical failures" : "Failures";
  const done = (runs.data ?? []).filter((r) => r.status === "completed");

  return (
    <Page title={title} subtitle="Each failure comes with its first divergence, evidence, likely cause and a recommended fix">
      <div className="mb-3 flex flex-wrap gap-2">
        <Select value={runId} onChange={(v) => set("runId", v)} options={done.map((r) => ({ value: r.id, label: `${r.agentVersion} · ${humanize(r.mode)} · ${r.id.slice(4, 12)}` }))} className="max-w-[300px]" />
        <Select value={severity} onChange={(v) => set("severity", v)} options={[{ value: "", label: "All severities" }, ...["critical", "high", "medium", "low"].map((s) => ({ value: s, label: s }))]} />
        <Select value={category} onChange={(v) => set("category", v)} options={[{ value: "", label: "All categories" }, ...CATS.map((c) => ({ value: c, label: humanize(c) }))]} />
        <Select value={regression} onChange={(v) => set("regression", v)} options={[{ value: "", label: "Regressions + existing" }, { value: "true", label: "Regressions only" }, { value: "false", label: "Pre-existing only" }]} />
      </div>
      {q.isLoading || overview.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <Card pad={false}>
          {q.data!.length === 0 ? (
            <Empty title="No failures match" />
          ) : (
            <Table head={["Severity", "Failure", "Scenario", "Category", "First divergence", "Invariant", "Version"]}>
              {q.data!.map((f) => (
                <tr key={f.id}>
                  <td><SeverityBadge s={f.severity} /></td>
                  <td className="max-w-[380px]">
                    <L to={`/failures/${f.id}`} className="text-fg">{f.title}</L>
                    {f.regression && <span className="ml-1.5"><Tag tone="bad">Regression, passed in {f.previousPassingVersion}</Tag></span>}
                  </td>
                  <td><L to={`/scenarios/${f.scenarioCode}`}><Mono className="text-muted">{f.scenarioCode}</Mono></L></td>
                  <td className="whitespace-nowrap text-fg-2">{humanize(f.category)}</td>
                  <td className="max-w-[240px] truncate font-mono text-[12px]">{f.firstDivergence ? <span className="flex items-center gap-2"><ForkMark size={12} className="text-muted" /><span className="text-muted">{f.firstDivergence.position}</span><span className="truncate text-bad">{formatAction(f.firstDivergence.actual)}</span></span> : <span className="text-faint">—</span>}</td>
                  <td>{f.violatedInvariant ? <Mono className="text-fg">{f.violatedInvariant.id}</Mono> : <span className="text-faint">—</span>}</td>
                  <td><Mono className="text-muted">{f.agentVersion}</Mono></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </Page>
  );
}
