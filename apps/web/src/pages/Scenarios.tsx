import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { api, type ScenarioIndexRow } from "../lib/api";
import { formatAction, humanize } from "../lib/format";
import { Card, Empty, ErrorBox, L, Loading, Mono, Page, Select, SeverityBadge, StatusBadge, Table, Tag, primaryLink, secondaryLink, ForkMark } from "../components/ui";

export function useScenarioIndex(mutations = false) {
  return useQuery({ queryKey: ["scenarios", mutations], queryFn: () => api<{ runId: string | null; agentVersion: string | null; scenarios: ScenarioIndexRow[] }>(`/scenarios${mutations ? "?mutations=true" : ""}`) });
}

export function Scenarios() {
  const [params, setParams] = useSearchParams();
  const showMut = params.get("mutations") === "true";
  const q = useScenarioIndex(showMut);
  const filter = { cat: params.get("category") ?? "", sev: params.get("severity") ?? "", status: params.get("status") ?? "", text: params.get("q") ?? "", domain: params.get("domain") ?? "" };
  const set = (k: string, v: string) => setParams((p) => (v ? p.set(k, v) : p.delete(k), p), { replace: true });

  const rows = useMemo(
    () =>
      (q.data?.scenarios ?? []).filter(
        (s) =>
          (!filter.cat || s.category === filter.cat) &&
          (!filter.sev || s.severity === filter.sev) &&
          (!filter.domain || s.domain === filter.domain) &&
          (!filter.status || (s.latest?.status ?? "none") === filter.status) &&
          (!filter.text || `${s.code} ${s.name} ${s.description} ${s.tags.join(" ")}`.toLowerCase().includes(filter.text.toLowerCase())),
      ),
    [q.data, filter.cat, filter.sev, filter.status, filter.text, filter.domain],
  );
  const cats = [...new Set((q.data?.scenarios ?? []).map((s) => s.category))].sort();
  const domains = [...new Set((q.data?.scenarios ?? []).map((s) => s.domain))].sort();

  return (
    <Page
      title="Scenarios"
      subtitle={q.data ? <>{rows.length} of {q.data.scenarios.length} scenarios{q.data.agentVersion && <> · status from latest full run of <Mono>{q.data.agentVersion}</Mono></>}</> : null}
      actions={
        <Link to="/scenarios/new" className={primaryLink}>
          New scenario
        </Link>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={filter.text} onChange={(e) => set("q", e.target.value)} placeholder="Filter by id, name, tag…" className="h-8 w-64 rounded-lg border border-line-2 bg-panel-2 px-2" />
        <Select value={filter.cat} onChange={(v) => set("category", v)} options={[{ value: "", label: "All categories" }, ...cats.map((c) => ({ value: c, label: humanize(c) }))]} />
        <Select value={filter.domain} onChange={(v) => set("domain", v)} options={[{ value: "", label: "All domains" }, ...domains.map((c) => ({ value: c, label: humanize(c) }))]} />
        <Select value={filter.sev} onChange={(v) => set("severity", v)} options={[{ value: "", label: "All severities" }, ...["critical", "high", "medium", "low"].map((c) => ({ value: c, label: c }))]} />
        <Select value={filter.status} onChange={(v) => set("status", v)} options={[{ value: "", label: "Any status" }, { value: "passed", label: "Passing" }, { value: "failed", label: "Failing" }, { value: "none", label: "Not run" }]} />
        <label className="ml-1 flex items-center gap-1.5 text-fg-2">
          <input type="checkbox" checked={showMut} onChange={(e) => set("mutations", e.target.checked ? "true" : "")} /> include mutations
        </label>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <Card pad={false}>
          {rows.length === 0 ? (
            <Empty title="No scenarios match" />
          ) : (
            <Table head={["ID", "Scenario", "Category", "Severity", "Tools · inv.", "Latest", "First divergence"]}>
              {rows.map((s) => (
                <tr key={s.code}>
                  <td className="whitespace-nowrap"><L to={`/scenarios/${s.code}`}><Mono>{s.code}</Mono></L></td>
                  <td className="max-w-[380px]">
                    <div className="truncate text-fg">{s.name}</div>
                    {s.mutationStrategy && <Tag tone="accent">{humanize(s.mutationStrategy)}</Tag>}
                  </td>
                  <td className="whitespace-nowrap"><div className="text-fg-2">{humanize(s.category)}</div><div className="text-[12px] text-muted">{humanize(s.domain)}</div></td>
                  <td><SeverityBadge s={s.severity} /></td>
                  <td className="tabular whitespace-nowrap font-mono text-[12px] text-muted">{s.tools} · {s.invariants}</td>
                  <td>{s.latest ? <L to={`/traces/${s.latest.traceId}`}><StatusBadge status={s.latest.status} /></L> : <StatusBadge status={null} />}</td>
                  <td className="max-w-[260px] truncate font-mono text-[12px] text-muted">
                    {s.latest?.firstDivergence ? (
                      <span className="flex items-center gap-2"><ForkMark size={12} className="text-muted" /><span className="text-muted">{s.latest.firstDivergence.position}</span><span className="truncate text-bad">{formatAction(s.latest.firstDivergence.actual)}</span></span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </Page>
  );
}
