import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { api, type AgentRow, type CompareResponse, type RegressionReport } from "../lib/api";
import { DIMENSION_LABEL, ms, pct, relPct, usd } from "../lib/format";
import { Card, Empty, ErrorBox, L, Loading, Mono, Page, Select, SeverityBadge, StatusBadge, Table, Tag, cx } from "../components/ui";

const ROW_ORDER = ["reliability", "pass_rate", "correctness", "safety", "policy", "trajectory", "tool_correctness", "tool_arguments", "grounding", "state_consistency", "recovery", "robustness", "handoff", "tool_efficiency", "latency", "cost", "tool_calls"];
const fmt = (key: string, v: number | null) =>
  v === null ? "—" : key === "latency" ? ms(v) : key === "cost" ? usd(v) : key === "tool_calls" ? v.toFixed(2) : `${pct(v)}%`;

export function MetricComparison({ report }: { report: RegressionReport }) {
  const rows = ROW_ORDER.map((k) => report.metrics.find((m) => m.key === k)).filter((m) => m && (m.baseline !== null || m.candidate !== null));
  return (
    <Table head={["Metric", report.baselineVersion, report.candidateVersion, "Δ", ""]}>
      {rows.map((m) => (
        <tr key={m!.key}>
          <td className="text-fg-2">{DIMENSION_LABEL[m!.key] ?? m!.key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</td>
          <td className="tabular font-mono text-fg-2">{fmt(m!.key, m!.baseline)}</td>
          <td className="tabular font-mono text-fg">{fmt(m!.key, m!.candidate)}</td>
          <td className="tabular font-mono text-muted">{["latency", "cost", "tool_calls"].includes(m!.key) ? relPct(m!.relative) : m!.delta === null ? "—" : `${m!.delta > 0 ? "+" : ""}${(m!.delta * 100).toFixed(1)}`}</td>
          <td className={cx("font-mono", m!.direction === "improved" ? "text-ok" : m!.direction === "regressed" ? "text-bad" : "text-faint")}>
            {m!.direction === "improved" ? "Improved" : m!.direction === "regressed" ? "Regressed" : "·"}
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function ScenarioChanges({ report, filter }: { report: RegressionReport; filter?: string[] }) {
  const order: Record<string, number> = { new_failure: 0, severity_change: 1, fixed: 2, unchanged_failure: 3, new_scenario: 4, unchanged_pass: 5 };
  const rows = report.scenarios.filter((s) => !filter || filter.includes(s.change)).sort((a, b) => order[a.change]! - order[b.change]! || a.scenarioId.localeCompare(b.scenarioId));
  const label: Record<string, [string, "bad" | "ok" | "warn" | "default"]> = {
    new_failure: ["New failure", "bad"],
    fixed: ["Fixed", "ok"],
    severity_change: ["Severity change", "warn"],
    unchanged_failure: ["Still failing", "default"],
    unchanged_pass: ["Unchanged", "default"],
    new_scenario: ["New scenario", "default"],
  };
  if (rows.length === 0) return <Empty title="No scenarios in this view" />;
  return (
    <Table head={["Scenario", "Change", report.baselineVersion, report.candidateVersion, "Severity", "New failure modes", "Tool calls Δ"]}>
      {rows.map((s) => (
        <tr key={s.scenarioId}>
          <td className="max-w-[360px]">
            <L to={`/scenarios/${s.scenarioId}`}><Mono className="text-muted">{s.scenarioId}</Mono></L> <span className="text-fg">{s.scenarioName}</span>
          </td>
          <td><Tag tone={label[s.change]![1]}>{label[s.change]![0]}</Tag></td>
          <td><StatusBadge status={s.baselineStatus === "absent" ? null : s.baselineStatus} /></td>
          <td><StatusBadge status={s.candidateStatus} /></td>
          <td className="whitespace-nowrap">
            <SeverityBadge s={s.baselineSeverity} /> <span className="text-faint">→</span> <SeverityBadge s={s.candidateSeverity} />
          </td>
          <td className="min-w-[180px] text-[12px] text-bad">{s.newFailureCategories.join(", ").replace(/_/g, " ") || <span className="text-faint">—</span>}</td>
          <td className={cx("tabular font-mono", s.toolCallDelta > 0 ? "text-warn" : s.toolCallDelta < 0 ? "text-ok" : "text-faint")}>{s.toolCallDelta > 0 ? `+${s.toolCallDelta}` : s.toolCallDelta || "·"}</td>
        </tr>
      ))}
    </Table>
  );
}

export function Compare() {
  const [params, setParams] = useSearchParams();
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<AgentRow[]>("/agents") });
  const agent = agents.data?.find((a) => a.slug === params.get("agent")) ?? agents.data?.[0];
  const versions = agent?.versions ?? [];
  const a = params.get("a") ?? versions.at(-2)?.version ?? "";
  const b = params.get("b") ?? versions.at(-1)?.version ?? "";
  const [view, setView] = useState("changes");
  useEffect(() => setView("changes"), [a, b]);
  const cmp = useQuery({
    queryKey: ["compare", agent?.slug, a, b],
    queryFn: () => api<CompareResponse>(`/agents/${agent!.slug}/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
    enabled: !!agent && !!a && !!b && a !== b,
  });

  if (agents.isLoading) return <Loading />;
  const set = (k: string, v: string) => setParams((p) => (p.set(k, v), p));
  const opts = versions.map((v) => ({ value: v.version, label: v.version }));
  const r = cmp.data?.report;

  return (
    <Page
      title="Agent comparison"
      subtitle="Latest full evaluation of each version, scenario by scenario"
      actions={
        <>
          <Select value={agent?.slug ?? ""} onChange={(v) => set("agent", v)} options={(agents.data ?? []).map((x) => ({ value: x.slug, label: x.name }))} />
          <Select value={a} onChange={(v) => set("a", v)} options={opts} />
          <span className="text-muted">vs</span>
          <Select value={b} onChange={(v) => set("b", v)} options={opts} />
        </>
      }
    >
      {versions.length < 2 ? (
        <Card><Empty title="Need at least two versions" hint="Create a new agent version and evaluate it." /></Card>
      ) : cmp.isLoading ? (
        <Loading />
      ) : cmp.error ? (
        <ErrorBox error={cmp.error} />
      ) : r ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-5">
            {[
              ["New failures", r.summary.newFailures, r.summary.newFailures ? "text-bad" : "text-fg"],
              ["Fixed", r.summary.fixed, r.summary.fixed ? "text-ok" : "text-fg"],
              ["Severity changes", r.summary.severityChanges, "text-fg"],
              ["Still failing", r.summary.unchangedFailures, "text-fg"],
              ["Metric regressions", r.summary.metricRegressions, r.summary.metricRegressions ? "text-warn" : "text-fg"],
            ].map(([l, v, c]) => (
              <div key={l as string} className="bg-panel p-3">
                <div className="text-[12px] text-muted">{l}</div>
                <div className={cx("tabular mt-2 text-[28px] font-medium", c as string)}>{v}</div>
              </div>
            ))}
          </div>
          {r.summary.behavioralChanges.length > 0 && (
            <Card title="Behavioral changes">
              <ul className="list-disc space-y-0.5 pl-5 text-fg-2">{r.summary.behavioralChanges.map((x) => <li key={x}>{x}</li>)}</ul>
            </Card>
          )}
          <div className="grid grid-cols-1 gap-6">
            <Card title="Metrics" pad={false}>
              <MetricComparison report={r} />
            </Card>
            <Card
              title="Scenarios"
              pad={false}
              actions={<Select value={view} onChange={setView} options={[{ value: "changes", label: "Changed only" }, { value: "failing", label: "Failing" }, { value: "all", label: "All" }]} />}
            >
              <ScenarioChanges
                report={r}
                filter={view === "changes" ? ["new_failure", "fixed", "severity_change"] : view === "failing" ? ["new_failure", "severity_change", "unchanged_failure"] : undefined}
              />
            </Card>
          </div>
          <div className="text-muted">
            Runs: <L to={`/runs/${cmp.data!.baselineRun.id}`}><Mono>{cmp.data!.baselineRun.id}</Mono></L> → <L to={`/runs/${cmp.data!.candidateRun.id}`}><Mono>{cmp.data!.candidateRun.id}</Mono></L>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
