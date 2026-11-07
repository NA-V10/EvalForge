import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api, post, type AgentRow } from "../lib/api";
import { humanize } from "../lib/format";
import { useScenarioIndex } from "./Scenarios";
import { Button, Card, Empty, ErrorBox, L, Loading, Mono, Page, Select, SeverityBadge, StatusBadge, Table, Tag } from "../components/ui";

const STRATEGIES = ["missing_information", "ambiguous_phrasing", "tool_failure", "delayed_tool", "contradictory_state", "adversarial", "multi_turn", "irrelevant_context", "prompt_injection"];

export function Mutations() {
  const index = useScenarioIndex(true);
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<AgentRow[]>("/agents") });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [parent, setParent] = useState("");
  const [strategy, setStrategy] = useState("");
  const base = (index.data?.scenarios ?? []).filter((s) => !s.parentCode);
  const muts = useMemo(() => (index.data?.scenarios ?? []).filter((s) => s.parentCode && (!strategy || s.mutationStrategy === strategy)), [index.data, strategy]);
  const gen = useMutation({
    mutationFn: () => post<{ mutations: unknown[] }>("/mutations/generate", { scenario: parent || base[0]?.code, persist: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenarios"] }),
  });
  const run = useMutation({
    mutationFn: () => {
      const a = agents.data![0]!;
      return post<{ id: string }>("/evaluations/run", { agent: a.slug, version: a.versions.at(-1)!.version, mode: "mutations" });
    },
    onSuccess: (r) => navigate(`/runs/${r.id}`),
  });

  // Robustness matrix: pass rate per strategy.
  const byStrategy = STRATEGIES.map((s) => {
    const rows = (index.data?.scenarios ?? []).filter((x) => x.mutationStrategy === s);
    return { s, total: rows.length, evaluated: rows.filter((r) => r.latest).length, passed: rows.filter((r) => r.latest?.status === "passed").length };
  });

  if (index.isLoading) return <Loading />;
  return (
    <Page
      title="Mutations"
      subtitle="Variants generated from base scenarios to measure robustness: same goal, perturbed conditions, adjusted expectations"
      actions={
        <>
          <Select value={parent} onChange={setParent} options={[{ value: "", label: "Choose base scenario…" }, ...base.map((b) => ({ value: b.code, label: `${b.code} ${b.name.slice(0, 40)}` }))]} className="max-w-[300px]" />
          <Button onClick={() => gen.mutate()} disabled={gen.isPending || !base.length}>Generate</Button>
          <Button variant="primary" onClick={() => run.mutate()} disabled={run.isPending || !muts.length || !agents.data?.length}>Run all mutations</Button>
        </>
      }
    >
      {(gen.error || run.error) && <div className="mb-3"><ErrorBox error={gen.error ?? run.error} /></div>}
      <Card title="Robustness by strategy (latest mutation run)" className="mb-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {byStrategy.map((b) => (
            <button key={b.s} onClick={() => setStrategy(strategy === b.s ? "" : b.s)} className={`rounded border px-2.5 py-2 text-left ${strategy === b.s ? "border-accent/60 bg-accent/5" : "border-line hover:border-line-2"}`}>
              <div className="text-fg-2">{humanize(b.s)}</div>
              <div className="mt-0.5 font-mono text-[12px] text-muted">
                {b.total} variants · {b.evaluated ? <span className={b.passed === b.evaluated ? "text-ok" : "text-warn"}>{b.passed}/{b.evaluated} pass</span> : "not run"}
              </div>
            </button>
          ))}
        </div>
      </Card>
      <Card pad={false} title={`Variants${strategy ? ` · ${humanize(strategy)}` : ""}`}>
        {muts.length === 0 ? (
          <Empty title="No mutations yet" hint="Generate variants from a base scenario." />
        ) : (
          <Table head={["Variant", "Strategy", "Base", "Severity", "Latest"]}>
            {muts.map((m) => (
              <tr key={m.code}>
                <td className="max-w-[420px]"><L to={`/scenarios/${m.code}`}><Mono>{m.code}</Mono></L> <span className="text-muted">{m.description.slice(0, 80)}</span></td>
                <td><Tag tone="accent">{humanize(m.mutationStrategy ?? "")}</Tag></td>
                <td><L to={`/scenarios/${m.parentCode}`}><Mono className="text-muted">{m.parentCode}</Mono></L></td>
                <td><SeverityBadge s={m.severity} /></td>
                <td>{m.latest ? <L to={`/traces/${m.latest.traceId}`}><StatusBadge status={m.latest.status} /></L> : <StatusBadge status={null} />}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </Page>
  );
}
