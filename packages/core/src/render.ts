import type { Condition, Invariant, RuleAssertion } from "./rules";

const OP_TEXT: Record<string, string> = {
  eq: "==",
  neq: "!=",
  in: "IN",
  nin: "NOT IN",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  matches: "~",
  includes: "INCLUDES",
  excludes: "EXCLUDES",
};

export function renderCondition(c: Condition): string {
  if ("all" in c) return c.all.map(renderCondition).join(" AND ");
  if ("any" in c) return `(${c.any.map(renderCondition).join(" OR ")})`;
  if ("not" in c) return `NOT (${renderCondition(c.not)})`;
  if (c.op === "exists") return `${c.fact} EXISTS`;
  if (c.op === "missing") return `${c.fact} IS MISSING`;
  return `${c.fact} ${OP_TEXT[c.op] ?? c.op} ${JSON.stringify(c.value)}`;
}

export function renderAssertion(a: RuleAssertion): string {
  switch (a.type) {
    case "never_call":
      return `${a.tools.join(", ")} MUST NOT occur`;
    case "no_destructive_action":
      return "destructive_action MUST NOT occur";
    case "must_call":
      return `${a.tool} MUST occur`;
    case "call_before":
      return `${a.first} MUST succeed BEFORE ${a.then}`;
    case "call_only_when":
      return `${a.tool} MAY occur ONLY WHEN ${renderCondition(a.requires)}`;
    case "destructive_only_when":
      return `destructive_action MAY occur ONLY WHEN ${renderCondition(a.requires)}`;
    case "acts_exclude":
      return `response MUST NOT ${a.acts.join(" / ")}`;
    case "acts_include":
      return `response MUST ${a.acts.join(" + ")}`;
    case "response_matches":
      return `response MUST match /${a.pattern}/`;
    case "response_not_matches":
      return `response MUST NOT match /${a.pattern}/`;
    case "no_leak":
      return `response MUST NOT reveal ${a.statePaths.join(", ")}`;
    case "max_calls":
      return `${a.tool ?? "tool calls"} <= ${a.max}`;
    case "args_match":
      return `${a.tool} arguments MUST match ${Object.keys(a.args).join(", ")}`;
    case "state":
      return `STATE ${renderCondition(a.check)}`;
  }
}

/** Human-readable executable rule, e.g. `IF state.customer.verified == false THEN destructive_action MUST NOT occur`. */
export function renderInvariant(inv: Pick<Invariant, "condition" | "assertion">): string {
  const body = renderAssertion(inv.assertion);
  return inv.condition ? `IF ${renderCondition(inv.condition)}\nTHEN ${body}` : body;
}
