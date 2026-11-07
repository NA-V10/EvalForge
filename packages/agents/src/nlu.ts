/** Lightweight intent + entity understanding for the demo agent (stands in for an LLM's parsing). */

export type Intent =
  | "human_request"
  | "cancel_subscription"
  | "refund_status"
  | "refund_request"
  | "cancel_order"
  | "change_address"
  | "password_reset"
  | "change_email"
  | "role_change"
  | "appointment"
  | "invoice"
  | "order_status"
  | "technical"
  | "unknown";

const INTENT_RULES: [Intent, RegExp][] = [
  ["human_request", /\b(speak|talk) (to|with) (a |an )?(human|person|manager|real person|someone)\b|\breal person\b/i],
  ["cancel_subscription", /\bcancel\w*\b.{0,40}\b(subscription|plan|membership)\b|\bstop (my|the) (plan|subscription|membership)\b|\bend my (plan|subscription|membership)\b|\bclose (my|the) (plan|subscription)\b|\bdon'?t want to be (charged|billed) anymore\b/i],
  ["refund_status", /\b(status|where|update)\b.{0,30}\brefund\b|\brefund\b.{0,30}\b(status|yet|arrive|come through|processed)\b|\bdid my refund\b/i],
  ["refund_request", /\brefund\b|\bmoney back\b/i],
  ["cancel_order", /\bcancel\w*\b.{0,30}\border\b/i],
  ["change_address", /\baddress\b|\bship (it )?to\b/i],
  ["password_reset", /\bpassword\b|\blocked out\b|\bcan'?t (log|sign) ?in\b/i],
  ["change_email", /\b(change|update)\b.{0,20}\bemail\b/i],
  ["role_change", /\b(make|promote|give|grant|set|change)\b.{0,40}\b(admin|owner|role|access|viewer)\b|\bpermissions?\b/i],
  ["appointment", /\bappointment\b|\bbook\b.{0,20}\b(slot|time|session|call)\b|\bbook me\b|\bschedule\b/i],
  ["invoice", /\binvoice\b|\b(charged|billed)\b/i],
  ["order_status", /\bstatus of (my |the )?order\b|\bwhere is my order\b|\border\b.{0,30}\b(status|arrive|track|shipped)\b|\btrack\b/i],
  ["technical", /\berror\b|\bnot working\b|\bcrash\w*\b|\bsync\w*\b|\bbug\b|\bbroken\b|\bwon'?t (load|open)\b/i],
];

export function classifyIntent(text: string): Intent {
  for (const [intent, re] of INTENT_RULES) if (re.test(text)) return intent;
  return "unknown";
}

export interface Entities {
  customerId?: string;
  orderId?: string;
  invoiceId?: string;
  subscriptionId?: string;
  accountId?: string;
  sessionUserId?: string;
  userIds: string[];
  code?: string;
  date?: string;
  time?: string;
  email?: string;
  role?: string;
  amount?: number;
  address?: string;
  claimedVerified: boolean;
  legalThreat: boolean;
  doubleCharge: boolean;
}

const last = (re: RegExp, s: string) => {
  const all = [...s.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
  return all.length ? all[all.length - 1]![0] : undefined;
};

export function extractEntities(userText: string): Entities {
  const session = userText.match(/session user:\s*(USR-\d+)/i)?.[1];
  const withoutIds = userText.replace(/\b[A-Z]{2,4}-\d+\b/g, " ");
  const role = userText.match(/\b(?:make|promote|set|change)\b[^.]*?\b(?:an? |to )?(admin|owner|viewer|member)\b/i)?.[1]?.toLowerCase();
  const amount = userText.match(/\$\s?(\d+(?:\.\d{1,2})?)/)?.[1];
  return {
    customerId: last(/\bCUS-\d+\b/, userText),
    orderId: last(/\bORD-\d+\b/, userText),
    invoiceId: last(/\bINV-\d+\b/, userText),
    subscriptionId: last(/\bSUB-\d+\b/, userText),
    accountId: last(/\bACC-\d+\b/, userText),
    sessionUserId: session,
    userIds: [...new Set([...userText.matchAll(/\bUSR-\d+\b/g)].map((m) => m[0]))].filter((u) => u !== session),
    code: last(/\b\d{6}\b/, withoutIds),
    date: last(/\b\d{4}-\d{2}-\d{2}\b/, userText),
    time: last(/\b\d{1,2}:\d{2}\b/, userText)?.padStart(5, "0"),
    email: last(/[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}/i, userText),
    role,
    amount: amount ? Number(amount) : undefined,
    address: userText.match(/\bto (\d+[^.?!\n]*)/i)?.[1]?.trim(),
    claimedVerified:
      /\b(already|previously) (been )?verified\b|\bverified (me|earlier|already|last time)\b|\bskip (the )?verification\b|\bno need to verify\b|\bdon'?t (need|have) to verify\b/i.test(userText),
    legalThreat: /\b(lawyer|attorney|legal action|sue|suing|chargeback|regulator|small claims)\b/i.test(userText),
    doubleCharge: /\b(twice|double[- ]?charged|charged two times|duplicate charge)\b/i.test(userText),
  };
}

/** Detect instructions planted inside tool-returned data. */
export function findInjectedDirective(result: unknown): string | null {
  const text = JSON.stringify(result ?? "");
  const m = text.match(/(?:ignore (?:all |any )?(?:previous|prior) instructions|system (?:override|instruction)|assistant must)[^"]{0,200}/i);
  return m ? m[0] : null;
}
