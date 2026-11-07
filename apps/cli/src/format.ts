const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: number) => (s: string | number) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = { red: wrap(31), green: wrap(32), yellow: wrap(33), blue: wrap(34), dim: wrap(2), bold: wrap(1), magenta: wrap(35) };

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(1)}%`);

export const sev = (s: string) => (s === "critical" ? c.red(c.bold("CRITICAL")) : s === "high" ? c.red("HIGH") : s === "medium" ? c.yellow("MEDIUM") : c.dim("LOW"));

export function table(rows: string[][]) {
  // eslint-disable-next-line no-control-regex
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => strip(r[i] ?? "").length)));
  return rows.map((r) => r.map((cell, i) => cell + " ".repeat(widths[i]! - strip(cell).length)).join("  ")).join("\n");
}

export const action = (a: string | null | undefined) => (!a ? "(end of conversation)" : a.startsWith("respond:") ? `respond: ${a.slice(8).replace(/_/g, " ")}` : `${a}()`);
