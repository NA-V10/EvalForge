import { useQuery } from "@tanstack/react-query";
import { api, type RunRow } from "../lib/api";
import { DIMENSION_LABEL, DIMENSION_ORDER, humanize, ms, pct, usd } from "../lib/format";
import { scoreTone } from "../components/charts";
import { Card, L, Loading, Mono, Page, Table, cx } from "../components/ui";

interface SystemMetrics {
  counters: Record<string, number>;
  queue_depth: number;
  avg_scenario_execution_ms: number;
  avg_evaluator_latency_ms: number;
  evaluator_cost_usd: number;
  judge: string;
  judgeOffline: boolean;
  database: string;
}

export function Metrics() {
  const sys = useQuery({ queryKey: ["system"], queryFn: () => api<SystemMetrics>("/system/metrics"), refetchInterval: 5000 });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<RunRow[]>("/evaluations/runs?limit=100") });
  if (sys.isLoading || runs.isLoading) return <Loading />;
  const s = sys.data!;
  const done = (runs.data ?? []).filter((r) => r.status === "completed" && r.metrics);
  const dimOf = (r: RunRow, d: string) => (r.metrics!.dimensions as Record<string, number | null | undefined>)[d] ?? null;
  const dims = DIMENSION_ORDER.filter((d) => done.some((r) => dimOf(r, d) !== null));
  return (
    <Page title="Metrics" subtitle="Behavioral metrics per run, plus telemetry of the evaluation platform itself (this process)">
      <Card title="Platform telemetry" className="mb-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
          {[
            ["Queue depth", s.queue_depth],
            ["Runs completed", s.counters.runs_completed],
            ["Runs failed", s.counters.runs_failed],
            ["Scenarios executed", s.counters.scenarios_executed],
            ["Execution failures", s.counters.scenario_execution_failures],
            ["Evaluator calls", s.counters.evaluator_executions],
            ["Evaluator failures", s.counters.evaluator_failures],
            ["Avg evaluator latency", ms(s.avg_evaluator_latency_ms)],
          ].map(([l, v]) => (
            <div key={l as string}>
              <div className="text-[12px] text-muted">{l}</div>
              <div className="tabular font-mono text-[16px]">{v ?? 0}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 font-mono text-[12px] text-muted">
          judge {s.judge}{s.judgeOffline && " (deterministic offline judge — set ANTHROPIC_API_KEY for an LLM judge)"} · evaluator cost {usd(s.evaluator_cost_usd)} · avg scenario execution {ms(s.avg_scenario_execution_ms)} · db {s.database}
        </div>
      </Card>
      <Card title="Dimensions by run" pad={false}>
        <Table head={["Run", "Version", "Mode", ...dims.map((d) => DIMENSION_LABEL[d] ?? d), "Latency", "Cost"]}>
          {done.map((r) => (
            <tr key={r.id}>
              <td><L to={`/runs/${r.id}`}><Mono>{r.id.slice(4, 12)}</Mono></L></td>
              <td><Mono>{r.agentVersion}</Mono></td>
              <td className="whitespace-nowrap text-muted">{humanize(r.mode)}</td>
              {dims.map((d) => {
                const v = dimOf(r, d);
                return <td key={d} className={cx("tabular font-mono", scoreTone(v))}>{pct(v)}</td>;
              })}
              <td className="tabular font-mono text-fg-2">{ms(r.metrics!.operational.avgLatencyMs)}</td>
              <td className="tabular font-mono text-fg-2">{usd(r.metrics!.operational.avgCostUsd)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
