import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { api, post, type AgentRow, type RunRow } from "../lib/api";
import { ago, humanize, ms, pct, usd } from "../lib/format";
import { PassBar, scoreTone } from "../components/charts";
import { Button, Card, Empty, ErrorBox, L, Loading, Mono, Page, Select, StatusBadge, Table, cx } from "../components/ui";

const MODES = [
  { value: "all", label: "All scenarios" },
  { value: "regression_suite", label: "Regression suite" },
  { value: "failed", label: "Previously failed" },
  { value: "mutations", label: "Mutated scenarios" },
  { value: "selected", label: "Selected scenarios" },
];

function NewRun({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<AgentRow[]>("/agents") });
  const sets = useQuery({ queryKey: ["sets"], queryFn: () => api<{ slug: string; name: string }[]>("/scenario-sets") });
  const [agent, setAgent] = useState("");
  const [version, setVersion] = useState("");
  const [mode, setMode] = useState("all");
  const [set, setSet] = useState("");
  const [scenarios, setScenarios] = useState("");
  const a = agents.data?.find((x) => x.slug === agent) ?? agents.data?.[0];
  const v = version || a?.versions.at(-1)?.version || "";
  const start = useMutation({
    mutationFn: () =>
      post<{ id: string }>("/evaluations/run", {
        agent: a!.slug,
        version: v,
        mode,
        ...(set ? { scenarioSet: set } : {}),
        ...(mode === "selected" ? { scenarios: scenarios.split(/[\s,]+/).filter(Boolean) } : {}),
      }),
    onSuccess: (r) => navigate(`/runs/${r.id}`),
  });
  return (
    <Card title="Run evaluation" className="mb-4" actions={<button className="text-muted hover:text-fg" onClick={onClose}>close</button>}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12px] text-muted">Agent<br /><Select value={a?.slug ?? ""} onChange={(x) => (setAgent(x), setVersion(""))} options={(agents.data ?? []).map((x) => ({ value: x.slug, label: x.name }))} /></label>
        <label className="text-[12px] text-muted">Version<br /><Select value={v} onChange={setVersion} options={[...(a?.versions ?? [])].reverse().map((x) => ({ value: x.version, label: `${x.version} · ${x.model}` }))} /></label>
        <label className="text-[12px] text-muted">Mode<br /><Select value={mode} onChange={setMode} options={MODES} /></label>
        <label className="text-[12px] text-muted">Scenario set<br /><Select value={set} onChange={setSet} options={[{ value: "", label: "—" }, ...(sets.data ?? []).map((s) => ({ value: s.slug, label: s.name }))]} /></label>
        {mode === "selected" && (
          <label className="text-[12px] text-muted">Scenario ids<br /><input value={scenarios} onChange={(e) => setScenarios(e.target.value)} placeholder="SCN-017, SCN-018" className="h-8 w-60 rounded-lg border border-line-2 bg-panel-2 px-2 font-mono text-[12px] text-fg" /></label>
        )}
        <Button variant="primary" onClick={() => start.mutate()} disabled={!a || !v || start.isPending}>{start.isPending ? "Starting…" : "Start run"}</Button>
      </div>
      {start.error && <div className="mt-2"><ErrorBox error={start.error} /></div>}
    </Card>
  );
}

export function Runs() {
  const [params, setParams] = useSearchParams();
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<RunRow[]>("/evaluations/runs?limit=100"), refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running" || r.status === "queued") ? 2000 : false) });
  const showNew = params.get("new") === "1";
  return (
    <Page title="Evaluation runs" subtitle="Every run records agent, model, prompt, tool, scenario and evaluator versions plus the seed" actions={!showNew && <Button variant="primary" onClick={() => setParams({ new: "1" })}>Run evaluation</Button>}>
      {showNew && <NewRun onClose={() => setParams({})} />}
      {runs.isLoading ? (
        <Loading />
      ) : runs.error ? (
        <ErrorBox error={runs.error} />
      ) : (
        <Card pad={false}>
          {runs.data!.length === 0 ? (
            <Empty title="No runs yet" />
          ) : (
            <Table head={["Run", "Agent version", "Mode", "Status", "Result", "Critical", "Major", "Reliability", "Safety", "Avg latency", "Avg cost", "Created"]}>
              {runs.data!.map((r) => (
                <tr key={r.id}>
                  <td><L to={`/runs/${r.id}`}><Mono>{r.id.slice(4, 12)}</Mono></L>{r.label && <div className="max-w-[160px] truncate text-[12px] text-muted">{r.label}</div>}</td>
                  <td><Mono>{r.agentVersion}</Mono></td>
                  <td className="whitespace-nowrap text-fg-2">{humanize(r.mode)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.status === "completed" ? <PassBar passed={r.passed} total={r.totalScenarios} /> : <Mono className="text-muted">{r.progress.completed}/{r.progress.total}</Mono>}</td>
                  <td className={cx("tabular font-mono", r.criticalFailures ? "text-crit" : "text-faint")}>{r.status === "completed" ? r.criticalFailures : "—"}</td>
                  <td className={cx("tabular font-mono", r.majorFailures ? "text-bad" : "text-faint")}>{r.status === "completed" ? r.majorFailures : "—"}</td>
                  <td className={cx("tabular font-mono", scoreTone(r.metrics?.reliability))}>{pct(r.metrics?.reliability)}</td>
                  <td className={cx("tabular font-mono", scoreTone(r.metrics?.dimensions.safety))}>{pct(r.metrics?.dimensions.safety)}</td>
                  <td className="tabular font-mono text-fg-2">{ms(r.metrics?.operational.avgLatencyMs)}</td>
                  <td className="tabular font-mono text-fg-2">{usd(r.metrics?.operational.avgCostUsd)}</td>
                  <td className="whitespace-nowrap text-muted">{ago(r.createdAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </Page>
  );
}
