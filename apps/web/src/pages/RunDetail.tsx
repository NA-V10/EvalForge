import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, storedKey, type RunDetail } from "../lib/api";
import { formatAction, humanize, ms, pct, usd } from "../lib/format";
import { DimensionGrid, scoreTone } from "../components/charts";
import { Card, Code, ErrorBox, L, Loading, Mono, Page, Select, SeverityBadge, Stat, StatusBadge, Table, Tag, cx, primaryLink, secondaryLink, ForkMark } from "../components/ui";

/** Live progress: SSE stream from the API; each event triggers a refetch of persisted results. */
function useRunEvents(id: string, active: boolean) {
  const qc = useQueryClient();
  const [last, setLast] = useState<{ completed: number; total: number; scenarioId?: string; status?: string } | null>(null);
  useEffect(() => {
    if (!active) return;
    const key = storedKey();
    const es = new EventSource(`/api/evaluations/runs/${id}/events${key ? `?api_key=${encodeURIComponent(key)}` : ""}`);
    const refresh = (e: MessageEvent) => {
      setLast(JSON.parse(e.data));
      qc.invalidateQueries({ queryKey: ["run", id] });
    };
    es.addEventListener("progress", refresh);
    es.addEventListener("completed", (e) => (refresh(e as MessageEvent), es.close(), qc.invalidateQueries({ queryKey: ["runs"] })));
    es.addEventListener("failed", (e) => (refresh(e as MessageEvent), es.close()));
    return () => es.close();
  }, [id, active, qc]);
  return last;
}

export function RunDetailPage() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["run", id], queryFn: () => api<RunDetail>(`/evaluations/runs/${id}`) });
  const active = q.data?.status === "running" || q.data?.status === "queued";
  const live = useRunEvents(id, !!active);
  const baseline = useQuery({ queryKey: ["run", q.data?.baselineRunId], queryFn: () => api<RunDetail>(`/evaluations/runs/${q.data!.baselineRunId}`), enabled: !!q.data?.baselineRunId && q.data.status === "completed" });
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    const r = q.data?.results ?? [];
    if (filter === "failed") return r.filter((x) => x.status !== "passed");
    if (filter === "critical") return r.filter((x) => x.worstSeverity === "critical");
    if (filter === "regressions") return r.filter((x) => x.regression);
    return r;
  }, [q.data, filter]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <Page title="Run"><ErrorBox error={q.error} /></Page>;
  const r = q.data!;
  const m = r.metrics;
  const completed = live?.completed ?? r.progress.completed;
  const total = r.progress.total;

  return (
    <Page
      title={<>Run <Mono className="text-[15px]">{r.id}</Mono></>}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Mono>{r.agentVersion}</Mono> · {humanize(r.mode)} <StatusBadge status={r.status} />
          {r.label && <span className="text-muted">{r.label}</span>}
        </span>
      }
      actions={
        r.status === "completed" && (
          <>
            {r.baselineRunId && <Link to={`/regression?baseline=${r.baselineRunId}&candidate=${r.id}`} className={secondaryLink}>Compare to baseline</Link>}
            <Link to={`/release-gates?run=${r.id}`} className={primaryLink}>Release gate</Link>
          </>
        )
      }
    >
      {active && (
        <Card className="mb-4">
          <div className="flex items-center justify-between font-mono text-[12px]">
            <span className="text-info">Executing scenarios… {live?.scenarioId && <span className="text-muted">last: {live.scenarioId} → {live.status}</span>}</span>
            <span className="tabular">{completed}/{total}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full w-full origin-left bg-info transition-transform duration-300 ease-out" style={{ transform: `scaleX(${total ? completed / total : 0})` }} />
          </div>
        </Card>
      )}
      {r.status === "failed" && <div className="mb-4"><ErrorBox error={{ message: `Run failed: ${r.error}` }} /></div>}

      {m && (
        <div className="mb-6 space-y-6">
          <Card>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Passed" value={`${r.passed}/${r.totalScenarios}`} sub={`${r.failed} failed · ${r.errored} errors`} />
              <Stat label="Composite" value={<span className={scoreTone(m.reliability)}>{pct(m.reliability)}</span>} sub="composite (display only)" />
              <Stat label="Critical / major / minor" value={<span><span className={r.criticalFailures ? "text-crit" : ""}>{r.criticalFailures}</span> / {r.majorFailures} / {r.minorFailures}</span>} />
              <Stat label="Regressions" value={r.regression?.newFailures ?? "—"} tone={r.regression?.newFailures ? "bad" : undefined} sub={r.regression ? `${r.regression.fixed} fixed` : "no baseline"} />
              <Stat label="Avg latency" value={ms(m.operational.avgLatencyMs)} sub={`p95 ${ms(m.operational.p95LatencyMs)}`} />
              <Stat label="Total cost" value={usd(m.operational.totalCostUsd, 3)} sub={`${m.operational.totalTokens.toLocaleString()} tokens`} />
            </div>
          </Card>
          <Card title={`Dimensions${baseline.data ? ` · vs ${baseline.data.agentVersion}` : ""}`} >
            <DimensionGrid dims={m.dimensions} baseline={baseline.data?.metrics?.dimensions} />
          </Card>
        </div>
      )}

      <Card
        pad={false}
        title={`Scenario results (${rows.length})`}
        actions={<Select value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "failed", label: "Failed" }, { value: "critical", label: "Critical" }, { value: "regressions", label: "Regressions" }]} />}
      >
        <Table head={["Scenario", "Category", "Status", "Outcome", "Trajectory", "Worst failure", "First divergence", "Tools", "Latency", "Cost"]}>
          {rows.map((x) => (
            <tr key={x.id}>
              <td className="max-w-[340px]">
                <L to={`/traces/${x.traceId}`}><Mono className="text-muted">{x.scenarioId}</Mono></L> <span className="text-fg">{x.scenarioName}</span>
                {x.regression && <Tag tone="bad">Regression</Tag>}
              </td>
              <td className="whitespace-nowrap text-muted">{humanize(x.category)}</td>
              <td><StatusBadge status={x.status} /></td>
              <td className={x.outcomePassed ? "text-muted" : "text-bad"}>{x.outcomePassed ? "pass" : "fail"}</td>
              <td className={x.trajectoryPassed ? "text-muted" : "text-bad"}>{x.trajectoryPassed ? "pass" : "fail"}</td>
              <td>{x.worstSeverity ? <SeverityBadge s={x.worstSeverity} /> : <span className="text-faint">—</span>}</td>
              <td className="max-w-[240px] truncate font-mono text-[12px]">
                {x.firstDivergence ? <span className="flex items-center gap-2"><ForkMark size={12} className="text-muted" /><span className="text-muted">{x.firstDivergence.position}</span><span className="truncate text-bad">{formatAction(x.firstDivergence.actual)}</span></span> : <span className="text-faint">—</span>}
              </td>
              <td className="tabular font-mono text-muted">{x.toolCalls}</td>
              <td className="tabular font-mono text-muted">{ms(x.latencyMs)}</td>
              <td className="tabular font-mono text-muted">{usd(x.costUsd)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      {r.config && (
        <details className="mt-4">
          <summary className="cursor-pointer text-muted">Reproducibility record (agent, model, prompt, tool, scenario and evaluator versions; seed; environment)</summary>
          <Code value={r.config} className={cx("mt-2 max-h-96")} />
        </details>
      )}
    </Page>
  );
}
