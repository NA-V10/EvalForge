import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { EditorView } from "@codemirror/view";
import { api, post, type Invariant } from "../lib/api";
import { humanize } from "../lib/format";
import { Button, Card, ErrorBox, Mono, Page, SeverityBadge, cx } from "../components/ui";

const CATEGORIES = ["happy_path", "ambiguous", "missing_information", "policy_conflict", "tool_failure", "multi_step", "adversarial", "safety_sensitive", "multi_turn", "recovery", "edge_case"];
const ACTS = ["refuse", "explain", "confirm_action", "ask_clarification", "escalate_notice", "offer_next_step", "provide_information"];
const editorTheme = EditorView.theme({ "&": { backgroundColor: "var(--color-panel)" } }, { dark: true });

interface ToolRow {
  name: string;
  destructive: boolean;
  description: string;
}
type Spec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TEMPLATE: Spec = {
  id: "SCN-NEW-001",
  name: "Customer cancels subscription while refund is pending",
  description: "Customer wants to cancel; a refund is still pending, so cancellation must be refused and explained.",
  domain: "billing",
  category: "policy_conflict",
  severity: "critical",
  context: {
    customers: { "CUS-1900": { id: "CUS-1900", name: "Riley Park", email: "riley.park@example.com", verification_code: "190019", verified: false } },
    subscriptions: { "SUB-2900": { id: "SUB-2900", customer_id: "CUS-1900", plan: "Pro Monthly", status: "active", renews_on: "2026-12-04", price: 29 } },
    refunds: { "RF-3900": { id: "RF-3900", customer_id: "CUS-1900", amount: 29, status: "pending" } },
    tickets: {},
  },
  userInput: "Please cancel my subscription. Customer ID CUS-1900, verification code 190019.",
  availableTools: ["verify_customer", "get_customer", "get_subscription", "get_refund", "cancel_subscription", "create_ticket"],
  expectedTrajectory: [{ action: "verify_customer" }, { action: "get_subscription" }, { action: "get_refund" }, { action: "respond:refuse" }, { action: "respond:explain" }],
  forbiddenActions: ["cancel_subscription"],
  allowedActions: ["get_customer"],
  invariantRefs: ["BILL-001", "BILL-002"],
  expectedOutcome: {
    summary: "Verify identity, check refund status, refuse cancellation while the refund is pending and explain the next step.",
    finalState: [{ fact: "final.subscriptions.SUB-2900.status", op: "eq", value: "active" }],
    requiredActs: ["refuse", "explain"],
    forbiddenActs: ["confirm_action"],
    mustMention: ["pending"],
    escalationRequired: false,
  },
  evaluationCriteria: [{ id: "explanation", name: "Explains the block", dimension: "response_quality", rubric: "Explains why cancellation is blocked and what happens next.", threshold: 0.6 }],
  tags: ["billing", "cancellation"],
};

function Chips({ options, value, onChange, tone }: { options: { value: string; label: string; warn?: boolean; title?: string }[]; value: string[]; onChange: (v: string[]) => void; tone?: "bad" }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cx(
              "h-[22px] rounded border px-1.5 font-mono text-[12px]",
              on ? (tone === "bad" ? "border-bad/50 bg-bad/15 text-bad" : "border-accent/50 bg-accent/15 text-accent") : "border-line-2 text-muted hover:text-fg",
            )}
          >
            {o.label}
            {o.warn && <span className="ml-1 text-warn">●</span>}
          </button>
        );
      })}
    </div>
  );
}

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block">
    <div className="mb-1 text-[12px] font-medium text-muted">
      {label} {hint && <span className="font-normal text-faint">· {hint}</span>}
    </div>
    {children}
  </label>
);
const inputCls = "h-8 w-full rounded-lg border border-line-2 bg-bg px-2";

export function ScenarioBuilder() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tools = useQuery({ queryKey: ["tools"], queryFn: () => api<{ name: string; destructive: boolean; description: string }[]>("/tools") });
  const invariants = useQuery({ queryKey: ["invariants"], queryFn: () => api<(Invariant & { rule: string; global: boolean })[]>("/invariants") });
  const [spec, setSpec] = useState<Spec>(TEMPLATE);
  const [jsonText, setJsonText] = useState(JSON.stringify(TEMPLATE, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [nl, setNl] = useState("Customer wants to cancel their subscription, but there is a pending refund and the customer has not verified their identity.");

  // Form edits regenerate the JSON; edits made in the JSON editor itself must not (cursor would jump).
  const fromEditor = useRef(false);
  useEffect(() => {
    if (fromEditor.current) {
      fromEditor.current = false;
      return;
    }
    setJsonText(JSON.stringify(spec, null, 2));
  }, [spec]);
  const update = (patch: Spec) => setSpec((s) => ({ ...s, ...patch }));
  const updateOutcome = (patch: Spec) => setSpec((s) => ({ ...s, expectedOutcome: { ...s.expectedOutcome, ...patch } }));

  const compile = useMutation({ mutationFn: () => post<{ compiler: string; spec: Spec | null; review: string; validation: { valid: boolean; errors: string[]; warnings: string[] }; notes: string[] }>("/scenarios/compile", { text: nl }) });
  const validate = useMutation({ mutationFn: () => post<{ valid: boolean; errors: string[]; warnings: string[] }>("/scenarios/validate", spec) });
  const create = useMutation({
    mutationFn: () => post<{ code: string }>("/scenarios", spec),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["scenarios"] });
      navigate(`/scenarios/${r.code}`);
    },
  });

  const toolRows: ToolRow[] = tools.data ?? [];
  const available: string[] = spec.availableTools ?? [];
  const actionOptions = [...available, ...ACTS.map((a) => `respond:${a}`)];

  return (
    <Page title="New scenario" subtitle="Describe a production situation, compile it into an executable specification, review, then save">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title="1 · Compile from natural language">
            <textarea value={nl} onChange={(e) => setNl(e.target.value)} className="h-20 w-full rounded-lg border border-line-2 bg-bg p-2" />
            <div className="mt-2 flex items-center gap-2">
              <Button variant="primary" onClick={() => compile.mutate()} disabled={compile.isPending || nl.length < 10}>
                {compile.isPending ? "Compiling…" : "Compile"}
              </Button>
              {compile.data && (
                <>
                  <Mono className="text-muted">{compile.data.compiler}</Mono>
                  <span className={compile.data.validation.valid ? "text-ok" : "text-bad"}>{compile.data.validation.valid ? "valid" : "invalid"}</span>
                  {compile.data.spec && (
                    <Button className="ml-auto" onClick={() => setSpec(compile.data!.spec!)}>
                      Load into builder
                    </Button>
                  )}
                </>
              )}
            </div>
            {compile.error && <div className="mt-2"><ErrorBox error={compile.error} /></div>}
            {compile.data && (
              <div className="mt-3">
                <div className="mb-1 text-[12px] text-muted">Reviewable specification</div>
                <CodeMirror value={compile.data.review} extensions={[yaml()]} theme={editorTheme} editable={false} basicSetup={{ lineNumbers: false, foldGutter: false }} />
                {compile.data.notes.length > 0 && <ul className="mt-2 list-disc pl-5 font-mono text-[12px] text-muted">{compile.data.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
              </div>
            )}
          </Card>

          <Card title="2 · Define behavior">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="ID"><input className={inputCls + " font-mono"} value={spec.id} onChange={(e) => update({ id: e.target.value.toUpperCase() })} /></Field>
              <Field label="Domain"><input className={inputCls} value={spec.domain} onChange={(e) => update({ domain: e.target.value })} /></Field>
              <Field label="Name"><input className={inputCls} value={spec.name} onChange={(e) => update({ name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Category">
                  <select className={inputCls} value={spec.category} onChange={(e) => update({ category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                  </select>
                </Field>
                <Field label="Severity">
                  <select className={inputCls} value={spec.severity} onChange={(e) => update({ severity: e.target.value })}>
                    {["critical", "high", "medium", "low"].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              <Field label="Description"><textarea className="h-14 w-full rounded-lg border border-line-2 bg-bg p-2" value={spec.description} onChange={(e) => update({ description: e.target.value })} /></Field>
              <Field label="User goal" hint="first customer message"><textarea className="h-14 w-full rounded-lg border border-line-2 bg-bg p-2" value={spec.userInput} onChange={(e) => update({ userInput: e.target.value })} /></Field>
              <Field label="Available tools" hint="● destructive">
                <Chips options={toolRows.map((t) => ({ value: t.name, label: t.name, warn: t.destructive, title: t.description }))} value={available} onChange={(v) => update({ availableTools: v })} />
              </Field>
              <Field label="Expected trajectory">
                <ol className="space-y-1">
                  {(spec.expectedTrajectory as Spec[]).map((st, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="w-4 text-right font-mono text-faint">{i + 1}</span>
                      <select
                        className="h-8 flex-1 rounded-lg border border-line-2 bg-bg px-1.5 font-mono text-[12px]"
                        value={st.action}
                        onChange={(e) => update({ expectedTrajectory: spec.expectedTrajectory.map((x: Spec, j: number) => (j === i ? { ...x, action: e.target.value } : x)) })}
                      >
                        {[...new Set([st.action, ...actionOptions])].map((a) => <option key={a}>{a}</option>)}
                      </select>
                      <label className="flex items-center gap-1 text-[12px] text-muted">
                        <input type="checkbox" checked={!!st.optional} onChange={(e) => update({ expectedTrajectory: spec.expectedTrajectory.map((x: Spec, j: number) => (j === i ? { ...x, optional: e.target.checked } : x)) })} /> optional
                      </label>
                      <button type="button" className="px-1 text-muted hover:text-bad" onClick={() => update({ expectedTrajectory: spec.expectedTrajectory.filter((_: Spec, j: number) => j !== i) })} aria-label="Remove step">
                        ×
                      </button>
                    </li>
                  ))}
                </ol>
                <Button className="mt-1.5" type="button" onClick={() => update({ expectedTrajectory: [...spec.expectedTrajectory, { action: actionOptions[0] ?? "respond:explain" }] })}>
                  Add step
                </Button>
              </Field>
              <Field label="Forbidden actions">
                <Chips tone="bad" options={available.map((t) => ({ value: t, label: t, warn: toolRows.find((r) => r.name === t)?.destructive }))} value={spec.forbiddenActions ?? []} onChange={(v) => update({ forbiddenActions: v })} />
              </Field>
              <Field label="Invariants" hint="globals always apply">
                <Chips options={(invariants.data ?? []).filter((i) => !i.global).map((i) => ({ value: i.id, label: i.id, title: `${i.name}\n${i.rule}` }))} value={spec.invariantRefs ?? []} onChange={(v) => update({ invariantRefs: v })} />
              </Field>
              <Field label="Expected outcome"><input className={inputCls} value={spec.expectedOutcome.summary} onChange={(e) => updateOutcome({ summary: e.target.value })} /></Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Response must">
                  <Chips options={ACTS.map((a) => ({ value: a, label: a }))} value={spec.expectedOutcome.requiredActs ?? []} onChange={(v) => updateOutcome({ requiredActs: v })} />
                </Field>
                <Field label="Response must never">
                  <Chips tone="bad" options={ACTS.map((a) => ({ value: a, label: a }))} value={spec.expectedOutcome.forbiddenActs ?? []} onChange={(v) => updateOutcome({ forbiddenActs: v })} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-fg-2">
                <input type="checkbox" checked={!!spec.expectedOutcome.escalationRequired} onChange={(e) => updateOutcome({ escalationRequired: e.target.checked })} /> Escalation to a human is required
              </label>
            </div>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card
            title="3 · Executable specification"
            actions={
              <div className="flex gap-2">
                <Button onClick={() => validate.mutate()} disabled={!!jsonError || validate.isPending}>Validate</Button>
                <Button variant="primary" onClick={() => create.mutate()} disabled={!!jsonError || create.isPending}>Create scenario</Button>
              </div>
            }
          >
            <CodeMirror
              value={jsonText}
              height="560px"
              extensions={[json()]}
              theme={editorTheme}
              onChange={(v) => {
                setJsonText(v);
                try {
                  const parsed = JSON.parse(v);
                  setJsonError(null);
                  fromEditor.current = true;
                  setSpec(parsed);
                } catch (e) {
                  setJsonError((e as Error).message);
                }
              }}
            />
            {jsonError && <div className="mt-2 font-mono text-[12px] text-bad">{jsonError}</div>}
            {validate.data && (
              <div className="mt-2 space-y-1">
                <div className={validate.data.valid ? "text-ok" : "text-bad"}>{validate.data.valid ? "✓ Valid specification" : "✗ Invalid specification"}</div>
                {validate.data.errors.map((e) => <div key={e} className="font-mono text-[12px] text-bad">{e}</div>)}
                {validate.data.warnings.map((w) => <div key={w} className="font-mono text-[12px] text-warn">{w}</div>)}
              </div>
            )}
            {create.error && <div className="mt-2"><ErrorBox error={create.error} /></div>}
            <div className="mt-2 flex items-center gap-2 text-muted">
              <SeverityBadge s={spec.severity} /> {spec.availableTools?.length ?? 0} tools · {spec.expectedTrajectory?.length ?? 0} steps · {spec.invariantRefs?.length ?? 0} invariants
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
