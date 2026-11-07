import type { ReactNode, ButtonHTMLAttributes } from "react";
import { Link } from "react-router";
import type { Severity } from "../lib/api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Shared button looks, so links that act as buttons match <Button>. */
export const btn = {
  base: "inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50",
  primary: "border-transparent bg-fg text-bg hover:bg-white",
  default: "border-line-2 bg-panel-2 text-fg hover:bg-hover",
  ghost: "border-transparent text-fg-2 hover:bg-hover hover:text-fg",
  danger: "border-bad/40 bg-bad/10 text-bad hover:bg-bad/15",
};
export const primaryLink = cx(btn.base, btn.primary);
export const secondaryLink = cx(btn.base, btn.default);

export function Page({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1520px] px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-medium leading-[30px] tracking-[-0.01em]">{title}</h1>
          {subtitle && <div className="mt-1 text-[13px] text-fg-2">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-[13px] font-medium text-fg-2">{title}</h2>
          {actions}
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Button({ variant = "default", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "danger" }) {
  return <button {...props} className={cx(btn.base, btn[variant], className)} />;
}

/**
 * Severity is meaning, not decoration: only critical gets a tinted box,
 * high and medium get a dot, low is plain muted text.
 */
export function SeverityBadge({ s, label }: { s: Severity | null | undefined; label?: string }) {
  if (!s) return <span className="text-faint">—</span>;
  const text = label ?? s[0]!.toUpperCase() + s.slice(1);
  if (s === "critical")
    return <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md bg-crit/15 px-2 text-[12px] font-medium text-crit">{text}</span>;
  return (
    <span className={cx("inline-flex h-5 shrink-0 items-center gap-2 whitespace-nowrap text-[12px]", s === "high" ? "text-bad" : s === "medium" ? "text-warn" : "text-muted")}>
      {s !== "low" && <span className="size-1.5 rounded-full bg-current" />}
      {text}
    </span>
  );
}

/** A pass is the expected state and stays quiet; only failures and live runs draw the eye. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "none";
  const map: Record<string, [string, string, string]> = {
    passed: ["Pass", "text-fg-2", "bg-muted"],
    PASS: ["Approved", "text-ok", "bg-ok"],
    completed: ["Completed", "text-fg-2", "bg-muted"],
    failed: ["Fail", "text-bad", "bg-bad"],
    BLOCKED: ["Blocked", "text-crit", "bg-crit"],
    error: ["Error", "text-warn", "bg-warn"],
    running: ["Running", "text-accent", "bg-accent animate-pulse"],
    queued: ["Queued", "text-muted", "bg-faint"],
    none: ["Not run", "text-faint", "bg-faint"],
  };
  const [label, text, dot] = map[s] ?? map.none!;
  return (
    <span className={cx("inline-flex h-5 shrink-0 items-center gap-2 whitespace-nowrap text-[12px]", text)}>
      <span className={cx("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

export function Tag({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "accent" | "warn" | "bad" | "ok" }) {
  const t = {
    default: "border-line-2 text-fg-2",
    accent: "border-accent/30 text-accent",
    warn: "border-warn/30 text-warn",
    bad: "border-bad/30 text-bad",
    ok: "border-ok/30 text-ok",
  }[tone];
  return <span className={cx("inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md border px-2 text-[12px]", t)}>{children}</span>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[12px]", className)}>{children}</span>;
}

export function Code({ value, className }: { value: unknown; className?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className={cx("overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[12px] leading-5 text-fg-2", className)}>{text}</pre>;
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "ok" | "bad" | "warn" | "crit" }) {
  const color = tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "crit" ? "text-crit" : "text-fg";
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-fg-2">{label}</div>
      <div className={cx("tabular mt-2 text-[28px] font-medium leading-8 tracking-[-0.01em]", color)}>{value}</div>
      {sub && <div className="mt-1 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {head.map((h, i) => (
              <th key={i} className="h-10 whitespace-nowrap px-4 text-[12px] font-normal text-muted first:pl-5 last:pr-5">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:h-11 [&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&>tr:hover]:bg-hover/50 [&_td]:px-4 [&_td]:align-middle [&_td:first-child]:pl-5 [&_td:last-child]:pr-5">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="text-fg-2">{title}</div>
      {hint && <div className="max-w-md text-[13px] text-muted">{hint}</div>}
      {action}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="px-4 py-12 text-center text-[13px] text-muted">{label}…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const e = error as { message?: string; details?: string[] };
  return (
    <div className="rounded-xl border border-bad/30 bg-bad/5 p-4 text-bad">
      <div className="font-medium">{e?.message ?? "Request failed"}</div>
      {e?.details?.length ? <ul className="mt-2 list-disc pl-5 font-mono text-[12px]">{e.details.map((d) => <li key={d}>{d}</li>)}</ul> : null}
    </div>
  );
}

export function L({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cx("decoration-line-2 underline-offset-4 hover:text-fg hover:underline", className)}>
      {children}
    </Link>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-2 bg-panel-2 px-1 font-sans text-[11px] leading-none text-muted">{children}</kbd>;
}

export function Select({ value, onChange, options, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cx("h-8 rounded-lg border border-line-2 bg-panel-2 px-2 text-[13px] text-fg", className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Signature: the fork where expected and actual behaviour split.
 * Stem and expected branch in the text color, the actual branch in red.
 * Used only where a first divergence is shown.
 */
export function ForkMark({ className, size = 14 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={cx("shrink-0", className)}>
      <path d="M1.5 8h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 8l7.5 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1.5 2.5" opacity="0.6" />
      <path d="M7 8l6.5-5.5" stroke="var(--color-bad)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="8" r="1.75" fill="currentColor" />
    </svg>
  );
}
