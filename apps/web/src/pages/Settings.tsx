import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, put, storedKey } from "../lib/api";
import { ago } from "../lib/format";
import { Button, Card, ErrorBox, Mono, Page, Table, Tag } from "../components/ui";

interface Rule {
  name: string;
  pattern: string;
  replacement: string;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const [key, setKey] = useState(storedKey() ?? "");
  const rules = useQuery({ queryKey: ["redaction"], queryFn: () => api<{ rules: Rule[] }>("/settings/redaction") });
  const secrets = useQuery({ queryKey: ["secrets"], queryFn: () => api<{ name: string; createdAt: string }[]>("/secrets"), retry: false });
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api<{ id: string; name: string; prefix: string; role: string; createdAt: string; lastUsedAt: string | null }[]>("/api-keys"), retry: false });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api<{ id: string; actor: string; action: string; targetType: string; targetId: string | null; createdAt: string }[]>("/audit-logs"), retry: false });
  const [ruleText, setRuleText] = useState("");
  useEffect(() => {
    if (rules.data && !ruleText) setRuleText(JSON.stringify(rules.data.rules, null, 2));
  }, [rules.data, ruleText]);
  const saveRules = useMutation({ mutationFn: () => put("/settings/redaction", { rules: JSON.parse(ruleText) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["redaction"] }) });
  const [secretName, setSecretName] = useState("ANTHROPIC_API_KEY");
  const [secretValue, setSecretValue] = useState("");
  const saveSecret = useMutation({ mutationFn: () => put(`/secrets/${secretName}`, { value: secretValue }), onSuccess: () => (setSecretValue(""), qc.invalidateQueries({ queryKey: ["secrets"] })) });
  const [newKeyName, setNewKeyName] = useState("ci");
  const createKey = useMutation({ mutationFn: () => post<{ key: string }>("/api-keys", { name: newKeyName, role: "engineer" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }) });

  return (
    <Page title="Settings" subtitle="Access, secrets and privacy. Secrets are encrypted at rest (AES-256-GCM) and never returned by the API.">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Browser API key">
          <p className="mb-2 text-muted">In local development the dev server injects a generated key. For a deployed instance, paste a key here (stored in this browser only).</p>
          <div className="flex gap-2">
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="rel_…" className="h-8 flex-1 rounded-lg border border-line-2 bg-bg px-2 font-mono" type="password" />
            <Button onClick={() => { try { key ? localStorage.setItem("rel.apiKey", key) : localStorage.removeItem("rel.apiKey"); } catch { /* storage unavailable */ } qc.invalidateQueries(); }}>Save</Button>
          </div>
        </Card>
        <Card title="Provider secrets">
          <div className="mb-2 flex flex-wrap gap-1">{(secrets.data ?? []).map((s) => <Tag key={s.name}>{s.name}</Tag>)}{secrets.data?.length === 0 && <span className="text-muted">None stored.</span>}</div>
          {secrets.error && <div className="mb-2"><ErrorBox error={secrets.error} /></div>}
          <div className="flex flex-wrap gap-2">
            <input value={secretName} onChange={(e) => setSecretName(e.target.value)} className="h-8 w-52 rounded-lg border border-line-2 bg-bg px-2 font-mono" />
            <input value={secretValue} onChange={(e) => setSecretValue(e.target.value)} type="password" placeholder="value (write-only)" className="h-8 flex-1 rounded-lg border border-line-2 bg-bg px-2 font-mono" />
            <Button onClick={() => saveSecret.mutate()} disabled={!secretValue}>Store</Button>
          </div>
        </Card>
        <Card title="Redaction rules (applied to traces before storage and before any external judge call)">
          <p className="mb-2 text-muted">Built-in rules always mask API keys, bearer tokens, private keys, card numbers, SSNs, emails, phone numbers and fields like <Mono>verification_code</Mono>. Add custom rules:</p>
          <textarea value={ruleText} onChange={(e) => setRuleText(e.target.value)} className="h-40 w-full rounded border border-line bg-bg p-2 font-mono text-[12px]" placeholder='[{"name":"account","pattern":"ACCT#\\d+","replacement":"ACCT#***"}]' />
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={() => saveRules.mutate()}>Save rules</Button>
            {saveRules.isSuccess && <span className="text-ok">Saved — applies to new runs.</span>}
          </div>
          {saveRules.error && <div className="mt-2"><ErrorBox error={saveRules.error} /></div>}
        </Card>
        <Card title="API keys" pad={false}>
          <Table head={["Name", "Prefix", "Role", "Last used"]}>
            {(keys.data ?? []).map((k) => (
              <tr key={k.id}><td>{k.name}</td><td><Mono>{k.prefix}…</Mono></td><td>{k.role}</td><td className="text-muted">{ago(k.lastUsedAt)}</td></tr>
            ))}
          </Table>
          <div className="flex gap-2 border-t border-line p-3">
            <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} className="h-8 w-40 rounded-lg border border-line-2 bg-bg px-2" />
            <Button onClick={() => createKey.mutate()}>Create engineer key</Button>
          </div>
          {createKey.data && <div className="mx-3 mb-3 rounded border border-warn/40 bg-warn/5 p-2 font-mono text-[12px] text-warn">{createKey.data.key}<div className="mt-1 font-sans text-muted">Copy it now — it is not stored and cannot be shown again.</div></div>}
        </Card>
        <Card title="Audit log" pad={false} className="xl:col-span-2">
          <Table head={["When", "Actor", "Action", "Target"]}>
            {(audit.data ?? []).slice(0, 50).map((a) => (
              <tr key={a.id}><td className="text-muted">{ago(a.createdAt)}</td><td><Mono>{a.actor}</Mono></td><td>{a.action}</td><td><Mono className="text-muted">{a.targetType}{a.targetId ? `:${a.targetId}` : ""}</Mono></td></tr>
            ))}
          </Table>
        </Card>
      </div>
    </Page>
  );
}
