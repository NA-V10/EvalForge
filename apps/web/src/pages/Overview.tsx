import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api, type Overview as OverviewData, type RunDetail } from "../lib/api";
import { ago, formatAction, ms, pct, usd } from "../lib/format";
import { DimensionComparison, PassBar, scoreTone } from "../components/charts";
import { Card, Empty, ErrorBox, ForkMark, L, Loading, Mono, Page, SeverityBadge, Stat, StatusBadge, Table, Tag, cx, primaryLink, secondaryLink } from "../components/ui";

const relDelta = (a: number | undefined, b: number | undefined) => (a !== undefined && b ? Math.round(((a - b) / b) * 100) : null);
const fewer = (n: number, word: string) => (n === 0 ? `same as ${word}` : n < 0 ? `${-n} fewer than ${word}` : `${n} more than ${word}`);

export function Overview() {
  const q = useQuery({ queryKey: ["overview"], queryFn: () => api<OverviewData>("/overview"), refetchInterval: 10_000 });
  const latest = q.data?.latestRun;
  const baseline = useQuery({
    queryKey: ["run", latest?.baselineRunId],
    queryFn: () => api<RunDetail>(`/evaluations/runs/${latest!.baselineRunId}`),
    enabled: !!latest?.baselineRunId,
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <Page title="Overview"><ErrorBox error={q.error} /></Page>;
  const d = q.data!;
  const m = latest?.metrics;
  const b = baseline.data;
  const bm = b?.metrics;
  const agent = d.agents.find((a) => a.versions.some((v) => v.version === latest?.agentVersion)) ?? d.agents[0];
  const costDelta = relDelta(m?.operational.avgCostUsd, bm?.operational.avgCostUsd);

  return (
    <Page
      title={latest ? `${agent?.name ?? "Agent"} ${latest.agentVersion}` : "Overview"}
      subtitle={latest ? `Latest full evaluation · ${latest.totalScenarios} scenarios · ${ago(latest.completedAt)}` : "No completed evaluations yet"}
      actions={
        <>
          {latest && (
            <Link to={`/release-gates?run=${latest.id}`} className={secondaryLink}>
              Check release gate
            </Link>
          )}
          <Link to="/runs?new=1" className={primaryLink}>
            Run evaluation
          </Link>
        </>
      }
    >
      {!latest || !m ? (
        <Card>
          <Empty title="No evaluation results yet" hint="Run the seed (pnpm seed) or start an evaluation to see behaviour, failures and regressions here" />
        </Card>
      ) : (
        <div className="space-y-6">
          {latest.criticalFailures > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-bad/30 px-5 py-3">
              <span className="flex items-center gap-2 text-[14px] font-medium text-fg">
                <span className="size-2 rounded-full bg-crit" />
                Hard gate failed in {latest.criticalFailures} scenario{latest.criticalFailures > 1 ? "s" : ""}
              </span>
              <span className="text-[13px] text-fg-2">Critical behavioral violations block a release whatever the composite score says</span>
              <L to={`/failures?runId=${latest.id}&severity=critical`} className="ml-auto text-[13px] text-fg">
                Review failures
              </L>
            </div>
          )}

          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-panel lg:grid-cols-4">
            {[
              <Stat key="p" label="Scenarios passed" value={`${latest.passed}/${latest.totalScenarios}`} sub={b ? `${latest.passed - b.passed >= 0 ? "+" : ""}${latest.passed - b.passed} vs ${b.agentVersion}` : `${pct(m.passRate)}% pass rate`} />,
              <Stat key="c" label="Critical violations" value={latest.criticalFailures} tone={latest.criticalFailures ? "crit" : undefined} sub={b ? fewer(latest.criticalFailures - b.criticalFailures, b.agentVersion) : `${latest.majorFailures} major`} />,
              <Stat key="g" label="Regressions" value={d.regressions} tone={d.regressions ? "bad" : undefined} sub={d.regression ? `${d.regression.fixed} fixed vs ${b?.agentVersion ?? "baseline"}` : "No baseline"} />,
              <Stat key="$" label="Cost per scenario" value={usd(m.operational.avgCostUsd)} sub={`${costDelta !== null ? `${costDelta > 0 ? "+" : ""}${costDelta}% vs ${b?.agentVersion} · ` : ""}${ms(m.operational.avgLatencyMs)} avg latency`} />,
            ].map((s, i) => (
              <div key={i} className={cx("p-5", i > 0 && "border-l border-line", i === 2 && "max-lg:border-l-0 max-lg:border-t", i === 3 && "max-lg:border-t")}>
                {s}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card
              title={b ? `Behavioral dimensions, ${b.agentVersion} to ${latest.agentVersion}` : "Behavioral dimensions"}
              actions={
                <span className="text-[13px] text-muted">
                  Composite <span className={cx("font-mono text-[13px]", scoreTone(m.reliability))}>{pct(m.reliability)}</span>
                  {bm && <span className="font-mono"> · was {pct(bm.reliability)}</span>}
                </span>
              }
            >
              <DimensionComparison dims={m.dimensions} baseline={bm?.dimensions} baselineLabel={b?.agentVersion} candidateLabel={latest.agentVersion} />
            </Card>

            <Card title="Top failures" pad={false} actions={<L to={`/failures?runId=${latest.id}`} className="text-[13px] text-muted">All failures</L>}>
              {d.topFailures.length === 0 ? (
                <Empty title="No failures" />
              ) : (
                <ul className="divide-y divide-line">
                  {d.topFailures.map((f) => (
                    <li key={f.id}>
                      <Link to={`/failures/${f.id}`} className="block px-5 py-4 hover:bg-hover/50">
                        <div className="flex items-center gap-3">
                          <SeverityBadge s={f.severity} />
                          <Mono className="text-muted">{f.scenarioCode}</Mono>
                          {f.regression && <Tag tone="bad">Regression</Tag>}
                        </div>
                        <div className="mt-2 text-[14px] text-fg">{f.title}</div>
                        {f.firstDivergence && (
                          <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                            <ForkMark size={12} className="text-muted" />
                            <span className="truncate">
                              expected <span className="font-mono text-fg-2">{formatAction(f.firstDivergence.expected)}</span>, got{" "}
                              <span className="font-mono text-bad">{formatAction(f.firstDivergence.actual)}</span>
                            </span>
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <Card title="Coverage by category">
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                {Object.entries(m.byCategory)
                  .sort((a, b2) => a[1].passed / a[1].total - b2[1].passed / b2[1].total)
                  .map(([cat, v]) => (
                    <div key={cat} className="flex h-6 items-center justify-between gap-3">
                      <span className="text-[13px] text-fg-2">{cat.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</span>
                      <PassBar passed={v.passed} total={v.total} />
                    </div>
                  ))}
              </div>
            </Card>
            <Card title="Versions" pad={false}>
              <Table head={["Version", "Composite", "Safety", "Passed"]}>
                {[...d.trend].reverse().map((t) => (
                  <tr key={t.runId}>
                    <td><L to={`/runs/${t.runId}`}><Mono>{t.version}</Mono></L></td>
                    <td className={cx("font-mono text-[12px]", scoreTone(t.reliability))}>{pct(t.reliability)}</td>
                    <td className={cx("font-mono text-[12px]", scoreTone(t.safety))}>{pct(t.safety)}</td>
                    <td className="font-mono text-[12px] text-fg-2">{pct(t.passRate)}%</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>

          <Card title="Recent runs" pad={false} actions={<L to="/runs" className="text-[13px] text-muted">All runs</L>}>
            <Table head={["Run", "Version", "Mode", "Status", "Passed", "Critical", "Composite", "Started"]}>
              {d.recentRuns.map((r) => (
                <tr key={r.id}>
                  <td><L to={`/runs/${r.id}`}><Mono>{r.id.slice(4, 12)}</Mono></L></td>
                  <td><Mono>{r.agentVersion}</Mono></td>
                  <td className="text-fg-2">{r.mode.replace(/_/g, " ")}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.status === "completed" ? <PassBar passed={r.passed} total={r.totalScenarios} /> : <Mono className="text-muted">{r.progress.completed}/{r.progress.total}</Mono>}</td>
                  <td className={cx("font-mono text-[12px]", r.criticalFailures ? "text-crit" : "text-muted")}>{r.status === "completed" ? r.criticalFailures : "—"}</td>
                  <td className={cx("font-mono text-[12px]", scoreTone(r.metrics?.reliability))}>{pct(r.metrics?.reliability)}</td>
                  <td className="text-muted">{ago(r.createdAt)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </Page>
  );
}
