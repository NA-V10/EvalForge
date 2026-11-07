/**
 * Configurable redaction pipeline. Applied to traces before storage/display and before any
 * data is sent to an external judge model. Secrets are always masked; PII masking is on by default.
 */
export interface RedactionRule {
  name: string;
  pattern: string;
  replacement: string;
  flags?: string;
}

export const SECRET_RULES: RedactionRule[] = [
  { name: "anthropic_key", pattern: "sk-ant-[A-Za-z0-9_-]{10,}", replacement: "[REDACTED:api_key]" },
  { name: "openai_key", pattern: "\\bsk-[A-Za-z0-9]{20,}\\b", replacement: "[REDACTED:api_key]" },
  { name: "platform_key", pattern: "\\brel_[A-Za-z0-9]{24,}\\b", replacement: "[REDACTED:api_key]" },
  { name: "bearer", pattern: "\\bBearer\\s+[A-Za-z0-9._-]{16,}", replacement: "Bearer [REDACTED]" },
  { name: "aws_key", pattern: "\\bAKIA[0-9A-Z]{16}\\b", replacement: "[REDACTED:aws_key]" },
  { name: "private_key", pattern: "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----", replacement: "[REDACTED:private_key]" },
];

export const PII_RULES: RedactionRule[] = [
  { name: "card_number", pattern: "\\b(?:\\d[ -]?){13,16}\\b", replacement: "[REDACTED:card]" },
  { name: "ssn", pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b", replacement: "[REDACTED:ssn]" },
];

/** Contact-detail masking keeps the shape readable for debugging (j***@example.com). */
export const CONTACT_RULES: RedactionRule[] = [
  { name: "email", pattern: "\\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\\.[A-Za-z]{2,})\\b", replacement: "$1***@$2" },
  { name: "phone", pattern: "\\+?\\d{1,2}[-. ]\\d{3}[-. ]\\d{4}\\b", replacement: "[REDACTED:phone]" },
];

/** Field names whose values are always masked regardless of content. */
export const SENSITIVE_KEYS = /^(verification_code|password|secret|api_key|apikey|token|access_token|ssn|card_number|cvv)$/i;

export interface RedactorOptions {
  maskContacts?: boolean;
  custom?: RedactionRule[];
}

export interface RedactionStats {
  [rule: string]: number;
}

export function createRedactor(opts: RedactorOptions = {}) {
  const rules = [...SECRET_RULES, ...PII_RULES, ...(opts.maskContacts === false ? [] : CONTACT_RULES), ...(opts.custom ?? [])].map((r) => ({
    ...r,
    re: new RegExp(r.pattern, r.flags ?? "g"),
  }));
  const stats: RedactionStats = {};

  const redactString = (s: string): string => {
    let out = s;
    for (const r of rules) {
      out = out.replace(r.re, (...m) => {
        stats[r.name] = (stats[r.name] ?? 0) + 1;
        return r.replacement.replace(/\$(\d)/g, (_, i: string) => String(m[Number(i)] ?? ""));
      });
    }
    return out;
  };

  const redact = (value: unknown, key?: string): unknown => {
    if (key && SENSITIVE_KEYS.test(key) && value !== null && value !== undefined && typeof value !== "object") {
      stats[`key:${key}`] = (stats[`key:${key}`] ?? 0) + 1;
      return "[REDACTED]";
    }
    if (typeof value === "string") return redactString(value);
    if (Array.isArray(value)) return value.map((v) => redact(v));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, k)]));
    }
    return value;
  };

  return { redact, redactString, stats };
}

/** Detect PII in free text (used to flag scenarios that may contain real customer data). */
export function detectPII(text: string): { type: string; count: number }[] {
  const found: { type: string; count: number }[] = [];
  for (const r of [...PII_RULES, ...CONTACT_RULES, ...SECRET_RULES]) {
    const n = text.match(new RegExp(r.pattern, "g"))?.length ?? 0;
    if (n > 0) found.push({ type: r.name, count: n });
  }
  return found;
}
