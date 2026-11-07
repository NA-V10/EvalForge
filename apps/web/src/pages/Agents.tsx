import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, type AgentRow, type RunRow } from "../lib/api";
import { ago, pct } from "../lib/format";
import { scoreTone } from "../components/charts";
import { Button, Card, Code, Empty, ErrorBox, L, Loading, Mono, Page, StatusBadge, Table, Tag, cx } from "../components/ui";

function useAgents() {
  return useQuery({ queryKey: ["agents"], queryFn: () => api<AgentRow[]>("/agents") });
}
function useRuns() {
  return useQuery({ queryKey: ["runs"], queryFn: () => api<RunRow[]>("/evaluations/runs") });
}

export function Agents() {
  const agents = useAgents();
  const runs = useRuns();
  if (agents.isLoading) return <Loading />;
  if (agents.error) return <Page title="Agents"><ErrorBox error={agents.error} /></Page>;
  return (
    <Page title="Agents" subtitle="Agents under evaluation. Every run pins agent version, model, prompt version, tools and evaluator version.">
      <div className="space-y-4">
        {agents.data!.map((a) => {
          const latestByVersion = (v: string) => runs.data?.find((r) => r.agentId === a.id && r.agentVersion === v && r.status === "completed" && r.mode === "all");
          return (
            <Card key={a.id} title={<span className="normal-case tracking-normal text-fg">{a.name} <Mono className="text-muted">· {a.slug}</Mono></span>} pad={false}>
              <div className="border-b border-line px-3 py-2 text-fg-2">
                {a.description || "—"}
                <div className="mt-1.5 flex flex-wrap gap-1">{a.tools.map((t) => <Tag key={t}>{t}</Tag>)}</div>
              </div>
              <Table head={["Version", "Model", "Adapter", "Prompt", "Tools", "Latest full run", "Reliability", "Safety", "Created"]}>
                {[...a.versions].reverse().map((v) => {
                  const r = latestByVersion(v.version);
                  return (
                    <tr key={v.id}>
                      <td><Mono>{v.version}</Mono></td>
                      <td><Mono className="text-fg-2">{v.model}</Mono></td>
                      <td className="text-fg-2">{v.adapter}</td>
                      <td><Mono className="text-muted">v{v.systemPromptVersion}</Mono></td>
                      <td><Mono className="text-muted">{v.toolVersion}</Mono></td>
                      <td>{r ? <L to={`/runs/${r.id}`}><StatusBadge status={r.criticalFailures ? "failed" : "passed"} /> <Mono className="ml-1 text-muted">{r.passed}/{r.totalScenarios}</Mono></L> : <span className="text-faint">not evaluated</span>}</td>
                      <td className={cx("font-mono", scoreTone(r?.metrics?.reliability))}>{pct(r?.metrics?.reliability)}</td>
                      <td className={cx("font-mono", scoreTone(r?.metrics?.dimensions.safety))}>{pct(r?.metrics?.dimensions.safety)}</td>
                      <td className="text-muted">{ago(v.createdAt)}</td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          );
        })}
        {agents.data!.length === 0 && <Card><Empty title="No agents yet" hint="Create one via POST /api/agents or run the seed." /></Card>}
      </div>
    </Page>
  );
}

export function AgentVersions() {
  const agents = useAgents();
  const qc = useQueryClient();
  const [agent, setAgent] = useState<string>("");
  const [draft, setDraft] = useState("");
  const create = useMutation({
    mutationFn: (v: { agent: string; body: unknown }) => post(`/agents/${v.agent}/versions`, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
  if (agents.isLoading) return <Loading />;
  const list = agents.data ?? [];
  const current = list.find((a) => a.slug === (agent || list[0]?.slug));
  const last = current?.versions.at(-1);
  const initial = JSON.stringify(
    { version: bump(last?.version), model: last?.model ?? "", adapter: last?.adapter ?? "builtin", systemPromptVersion: last?.systemPromptVersion ?? "1", toolVersion: last?.toolVersion ?? "1.0.0", config: last?.config ?? {}, changelog: "" },
    null,
    2,
  );
  const value = draft || initial;

  return (
    <Page title="Agent versions" subtitle="Each version is an immutable, reproducible configuration. Create a new version to re-run and compare.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Versions" pad={false}>
          <div className="border-b border-line px-3 py-2">
            <select value={current?.slug} onChange={(e) => setAgent(e.target.value)} className="h-8 rounded-lg border border-line-2 bg-panel-2 px-2">
              {list.map((a) => <option key={a.id} value={a.slug}>{a.name}</option>)}
            </select>
          </div>
          <ul className="divide-y divide-line/70">
            {[...(current?.versions ?? [])].reverse().map((v) => (
              <li key={v.id} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <Mono className="text-fg">{v.version}</Mono>
                  <Mono className="text-muted">{v.model}</Mono>
                  <span className="ml-auto text-muted">{ago(v.createdAt)}</span>
                </div>
                {v.changelog && <div className="mt-1 text-fg-2">{v.changelog}</div>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Create version">
          <p className="mb-2 text-muted">
            JSON body for <Mono>POST /api/agents/{current?.slug}/versions</Mono>. Pre-filled from {last?.version ?? "scratch"}.
          </p>
          <textarea className="h-72 w-full rounded border border-line bg-bg p-2 font-mono text-[12px]" value={value} onChange={(e) => setDraft(e.target.value)} />
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="primary"
              disabled={!current || create.isPending}
              onClick={() => {
                try {
                  create.mutate({ agent: current!.slug, body: JSON.parse(value) });
                } catch {
                  alert("Invalid JSON");
                }
              }}
            >
              Create version
            </Button>
            {create.isSuccess && <span className="text-ok">Created.</span>}
          </div>
          {create.error && <div className="mt-2"><ErrorBox error={create.error} /></div>}
          {last && <details className="mt-3"><summary className="cursor-pointer text-muted">Current config ({last.version})</summary><Code value={last.config} className="mt-2 max-h-64" /></details>}
        </Card>
      </div>
    </Page>
  );
}

function bump(v?: string) {
  if (!v) return "v1.0.0";
  const m = v.match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/);
  return m ? `v${m[1]}.${Number(m[2]) + 1}.0` : v;
}
