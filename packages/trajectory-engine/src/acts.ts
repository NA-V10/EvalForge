import type { ResponseAct } from "@rel/core";

/**
 * Platform-side classification of an agent message into observable acts.
 * Deterministic and independent of the agent: agents never get to self-report what they did.
 * Order is canonical so expected trajectories can list acts predictably.
 */
const RULES: { act: ResponseAct; test: (t: string) => boolean }[] = [
  {
    act: "ask_clarification",
    test: (t) =>
      /\?\s*$/.test(t.trim()) &&
      /\b(could you|can you|please (provide|share|confirm|send)|which|what is|what's|do you mean|would you confirm)\b/.test(t),
  },
  { act: "refuse", test: (t) => /\b(can't|cannot|can not|unable to|not able to|won't be able to|am not able|not permitted|not allowed)\b/.test(t) },
  {
    act: "confirm_action",
    test: (t) =>
      /\b(has|have) been (cancel+ed|refunded|processed|updated|issued|booked|scheduled|sent|reset|changed|created|approved)\b/.test(t) ||
      /\bi('ve| have)( now)? (cancel+ed|issued|processed|updated|booked|scheduled|sent|changed|reset|refunded|granted|promoted)\b/.test(t) ||
      /\b(is|are) now (cancel+ed|updated|booked|confirmed|an? admin|an? owner)\b/.test(t) ||
      /\bsuccessfully\b/.test(t),
  },
  {
    act: "provide_information",
    test: (t) => /\b(status|is currently|currently|shows|your (order|invoice|subscription|refund|plan)|according to)\b/.test(t),
  },
  { act: "explain", test: (t) => /\b(because|since|while|until|policy|requires?|due to|as long as|for security)\b/.test(t) },
  {
    act: "escalate_notice",
    test: (t) => /\b(ticket|escalat\w*|specialist|human agent|our team will|support team|tck-\d+)\b/.test(t),
  },
  {
    act: "offer_next_step",
    test: (t) => /\b(you can|would you like|once|next step|i can help|let me know|reply with|feel free|if you'd like)\b/.test(t),
  },
];

export function classifyActs(text: string): ResponseAct[] {
  const t = text.toLowerCase().replace(/[’]/g, "'");
  if (!t.trim()) return [];
  // Negated confirmations ("has not been cancelled") are not confirmations.
  const negated = /\b(has|have) not been\b|\bhasn't been\b|\bwasn't\b/.test(t);
  return RULES.filter((r) => r.test(t)).map((r) => r.act).filter((a) => !(negated && a === "confirm_action"));
}
