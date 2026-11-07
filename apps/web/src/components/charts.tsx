import { DIMENSION_LABEL, DIMENSION_ORDER, pct } from "../lib/format";
import { cx } from "./ui";

/** Scores only draw attention when they are a problem. */
export const scoreTone = (v: number | null | undefined) =>
  v === null || v === undefined ? "text-faint" : v >= 0.85 ? "text-fg" : v >= 0.7 ? "text-warn" : "text-bad";

/**
 * Main chart: each behavioral dimension as a line from the baseline score to the
 * candidate score. Baseline is a hollow neutral dot, candidate a solid teal dot; the
 * connecting segment is green when the version improved and red when it regressed.
 */
export function DimensionComparison({
  dims,
  baseline,
  baselineLabel,
  candidateLabel,
}: {
  dims: Record<string, number | null | undefined>;
  baseline?: Record<string, number | null | undefined>;
  baselineLabel?: string;
  candidateLabel?: string;
}) {
  const keys = DIMENSION_ORDER.filter((k) => dims[k] !== undefined && dims[k] !== null);
  const min = 0.3;
  const x = (v: number) => `${((Math.max(min, v) - min) / (1 - min)) * 100}%`;
  return (
    <div>
      <div className="mb-4 flex items-center gap-5 text-[12px] text-muted">
        {baseline && (
          <span className="flex items-center gap-2">
            <span className="size-2.5 rounded-full border-[1.5px] border-muted" /> {baselineLabel}
          </span>
        )}
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-accent" /> {candidateLabel}
        </span>
      </div>
      <div className="grid grid-cols-[136px_1fr_88px] items-center gap-x-4">
        <div />
        <div className="relative mb-2 h-4 font-mono text-[11px] text-faint">
          {[0.4, 0.6, 0.8, 1].map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: x(t) }}>
              {t * 100}
            </span>
          ))}
        </div>
        <div />
        {keys.map((k) => {
          const v = dims[k] as number;
          const b = baseline?.[k] ?? null;
          const lo = b === null ? v : Math.min(b, v);
          const hi = b === null ? v : Math.max(b, v);
          const d = b === null ? 0 : v - b;
          const tone = Math.abs(d) < 0.005 ? "bg-line-2" : d > 0 ? "bg-ok/60" : "bg-bad/70";
          return (
            <div key={k} className="contents">
              <div className="truncate py-2 text-[13px] text-fg-2">{DIMENSION_LABEL[k] ?? k}</div>
              <div className="relative h-8">
                {[0.4, 0.6, 0.8, 1].map((t) => (
                  <span key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: x(t) }} />
                ))}
                <span className={cx("absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full", tone)} style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
                {b !== null && <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-muted bg-panel" style={{ left: x(b) }} title={`${baselineLabel}: ${pct(b)}`} />}
                <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: x(v) }} title={`${candidateLabel}: ${pct(v)}`} />
              </div>
              <div className="flex items-baseline justify-end gap-2 font-mono text-[12px]">
                {b !== null && Math.abs(d) >= 0.005 && <span className={d > 0 ? "text-ok" : "text-bad"}>{d > 0 ? "+" : "−"}{Math.abs(d * 100).toFixed(1)}</span>}
                <span className={scoreTone(v)}>{pct(v)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Kept for compact contexts: same comparison, no axis. */
export function DimensionGrid({ dims, baseline }: { dims: Record<string, number | null | undefined>; baseline?: Record<string, number | null | undefined> }) {
  return <DimensionComparison dims={dims} baseline={baseline} candidateLabel="this run" baselineLabel="baseline" />;
}

export function Meter({ value, className }: { value: number | null | undefined; className?: string }) {
  return (
    <div className={cx("h-1 w-full overflow-hidden rounded-full bg-line", className)}>
      {value !== null && value !== undefined && <div className="h-full rounded-full bg-fg-2" style={{ width: `${Math.max(2, value * 100)}%` }} />}
    </div>
  );
}

/** Pass share as a thin neutral bar; only the failing share is colored. */
export function PassBar({ passed, total }: { passed: number; total: number }) {
  const r = total ? passed / total : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-1 w-20 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-fg-2" style={{ width: `${r * 100}%` }} />
        <div className="h-full bg-bad/80" style={{ width: `${(1 - r) * 100}%` }} />
      </div>
      <span className="tabular font-mono text-[12px] text-fg-2">
        {passed}/{total}
      </span>
    </div>
  );
}

/** Retained for API compatibility; the Overview now shows versions as a table. */
export function TrendChart({ points }: { points: { label: string; value: number | null }[] }) {
  return (
    <ul className="divide-y divide-line">
      {points.map((p) => (
        <li key={p.label} className="flex h-10 items-center justify-between">
          <span className="font-mono text-[12px] text-fg-2">{p.label}</span>
          <span className={cx("font-mono text-[12px]", scoreTone(p.value))}>{pct(p.value)}</span>
        </li>
      ))}
    </ul>
  );
}
