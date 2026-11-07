import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import { api, post, type GateResult, type GateRow, type RunRow } from "../lib/api";
import { ago } from "../lib/format";
import { Button, Card, ErrorBox, L, Loading, Mono, Page, Select, StatusBadge, Table, cx } from "../components/ui";

const theme = EditorView.theme({ "&": { backgroundColor: "var(--color-panel)" } }, { dark: true });

export function ReleaseGates() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const gates = useQuery({ queryKey: ["gates"], queryFn: () => api<GateRow[]>("/release-gates") });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api<RunRow[]>("/evaluations/runs?limit=100") });
  const done = (runs.data ?? []).filter((r) => r.status === "completed");
  const [runId, setRunId] = useState(params.get("run") ?? "");
  const [gateId, setGateId] = useState("");
  const [policyText, setPolicyText] = useState("");
  const gate = gates.data?.find((g) => g.id === gateId) ?? gates.data?.[0];
  useEffect(() => {
    if (gate && !policyText) setPolicyText(JSON.stringify({ release_policy: gate.policy }, null, 2));
  }, [gate, policyText]);
  useEffect(() => {
    if (!runId && done[0]) setRunId(done[0].id);
  }, [done, runId]);

  const evaluate = useMutation({
    mutationFn: () => post<GateResult>("/release-gates/evaluate", { gateId: gate?.id, runId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gates"] }),
  });
  const save = useMutation({
    mutationFn: () => post<GateRow>("/release-gates", { id: gate?.id, name: gate?.name ?? "Production release policy", policy: JSON.parse(policyText) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gates"] }),
  });

  if (gates.isLoading || runs.isLoading) return <Loading />;
  const res = evaluate.data;
  return (
    <Page
      title="Release gates"
      subtitle="Hard, explicit deployment policy. A composite score never overrides a failed check."
      actions={
        <>
          <Select value={gate?.id ?? ""} onChange={(v) => (setGateId(v), setPolicyText(""))} options={(gates.data ?? []).map((g) => ({ value: g.id, label: g.name }))} />
          <Select value={runId} onChange={setRunId} options={done.map((r) => ({ value: r.id, label: `${r.agentVersion} · ${r.mode} · ${r.id.slice(4, 12)}` }))} className="max-w-[280px]" />
          <Button variant="primary" onClick={() => evaluate.mutate()} disabled={!runId || evaluate.isPending}>
            {evaluate.isPending ? "Evaluating…" : "Run release gate"}
          </Button>
        </>
      }
    >
      {evaluate.error && <div className="mb-3"><ErrorBox error={evaluate.error} /></div>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          {res ? (
            <>
              <div className={cx("rounded-xl border px-5 py-4", res.decision === "PASS" ? "border-ok/30" : "border-crit/30")}>
                <div className="flex items-center gap-3">
                  <span className={cx("flex items-center gap-2 text-[24px] font-medium", res.decision === "PASS" ? "text-ok" : "text-crit")}>{res.decision === "PASS" ? "Release approved" : "Release blocked"}</span>
                  <span className="text-muted">
                    run <L to={`/runs/${res.runId}`}><Mono>{res.runId}</Mono></L>
                    {res.baselineRunId && <> vs baseline <L to={`/runs/${res.baselineRunId}`}><Mono>{res.baselineRunId}</Mono></L></>}
                  </span>
                </div>
                {res.reasons.length > 0 && <div className="mt-2 text-[13px] text-fg-2">{res.checks.filter((c) => !c.passed).length} of {res.checks.length} checks failed · see below</div>}
              </div>
              <Card title="Checks" pad={false}>
                <Table head={["Check", "Required", "Actual", "Result"]}>
                  {res.checks.map((c) => (
                    <tr key={c.id}>
                      <td className="text-fg-2">{c.label}{c.detail && <div className="font-mono text-[12px] text-muted">{c.detail}</div>}</td>
                      <td className="font-mono text-muted">{c.threshold}</td>
                      <td className="font-mono">{c.actual}</td>
                      <td className={c.passed ? "text-muted" : "text-crit"}>{c.passed ? "Pass" : "Fail"}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
              <Card title="Release report">
                <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-fg">{res.report}</pre>
              </Card>
            </>
          ) : (
            <Card><div className="py-8 text-center text-muted">Choose a completed run and run the gate.</div></Card>
          )}
        </div>
        <div className="space-y-4 xl:col-span-2">
          <Card title="Policy" actions={<Button onClick={() => save.mutate()} disabled={save.isPending}>Save policy</Button>}>
            <CodeMirror value={policyText} onChange={setPolicyText} extensions={[json()]} theme={theme} height="320px" />
            {save.error && <div className="mt-2"><ErrorBox error={save.error} /></div>}
            {save.isSuccess && <div className="mt-2 text-ok">Saved.</div>}
          </Card>
          <Card title="Recent decisions" pad={false}>
            <Table head={["Run", "Decision", "When"]}>
              {(gate?.latestResults ?? []).map((x) => (
                <tr key={x.id}>
                  <td><L to={`/runs/${x.runId}`}><Mono>{x.runId.slice(4, 12)}</Mono></L></td>
                  <td><StatusBadge status={x.decision} /></td>
                  <td className="text-muted">{ago(x.createdAt)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </Page>
  );
}
