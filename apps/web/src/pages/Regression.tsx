import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { api, post, type RegressionReport, type RunRow } from "../lib/api";
import { Card, Empty, ErrorBox, Loading, Mono, Page, Select } from "../components/ui";
import { MetricComparison, ScenarioChanges } from "./Compare";

export function Regression() {
  const [params, setParams] = useSearchParams();
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<RunRow[]>("/evaluations/runs?limit=100") });
  const done = (runs.data ?? []).filter((r) => r.status === "completed");
  const latestWithBaseline = done.find((r) => r.baselineRunId);
  const baseline = params.get("baseline") ?? latestWithBaseline?.baselineRunId ?? "";
  const candidate = params.get("candidate") ?? latestWithBaseline?.id ?? "";
  const cmp = useMutation({ mutationFn: () => post<{ report: RegressionReport }>("/regression/run", { baselineRunId: baseline, candidateRunId: candidate }) });
  useEffect(() => {
    if (baseline && candidate && baseline !== candidate) cmp.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, candidate]);

  if (runs.isLoading) return <Loading />;
  const opts = done.map((r) => ({ value: r.id, label: `${r.agentVersion} · ${r.mode} · ${r.id.slice(4, 12)}` }));
  const r = cmp.data?.report;
  return (
    <Page
      title="Regression"
      subtitle="PASS → FAIL is a regression. Every run is automatically compared to the previous version's run in the same mode."
      actions={
        <>
          <Select value={baseline} onChange={(v) => setParams({ baseline: v, candidate })} options={[{ value: "", label: "Baseline run…" }, ...opts]} className="max-w-[260px]" />
          <span className="text-muted">→</span>
          <Select value={candidate} onChange={(v) => setParams({ baseline, candidate: v })} options={[{ value: "", label: "Candidate run…" }, ...opts]} className="max-w-[260px]" />
        </>
      }
    >
      {cmp.error && <ErrorBox error={cmp.error} />}
      {!baseline || !candidate ? (
        <Card><Empty title="Pick two completed runs" /></Card>
      ) : cmp.isPending ? (
        <Loading />
      ) : r ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-panel px-3 py-2">
            <Mono>{r.baselineVersion}</Mono> <span className="text-muted">→</span> <Mono>{r.candidateVersion}</Mono>
            <span className="ml-3 text-bad">{r.summary.newFailures} new failures</span>
            <span className="ml-3 text-ok">{r.summary.fixed} fixed</span>
            <span className="ml-3 text-warn">{r.summary.severityChanges} severity changes</span>
            <span className="ml-3 text-muted">{r.summary.unchangedFailures} unchanged failures</span>
          </div>
          <Card title="New failures, passed before and fail now" pad={false}>
            <ScenarioChanges report={r} filter={["new_failure"]} />
          </Card>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Card title="Fixed & severity changes" pad={false} className="xl:col-span-3">
              <ScenarioChanges report={r} filter={["fixed", "severity_change"]} />
            </Card>
            <Card title="Metric degradation" pad={false} className="xl:col-span-2">
              <MetricComparison report={r} />
            </Card>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
