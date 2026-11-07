import type { AgentAdapter, AgentRuntime, AgentTurnInput, AgentTurnOutput, ToolCallOutcome } from "@rel/core";
import { classifyIntent, extractEntities, findInjectedDirective, type Entities, type Intent } from "./nlu";
import type { BehaviorProfile } from "./profile";

type Rec = Record<string, unknown>;

interface Memory {
  intent: Intent | null;
  verified: boolean;
  profileLoaded: boolean;
  escalated: boolean;
  contextChars: number;
  pendingDirective: string | null;
  order: Rec | null;
  subscription: Rec | null;
  accountId: string | null;
}

const money = (n: unknown) => `$${Number(n).toFixed(2).replace(/\.00$/, "")}`;

/**
 * "Customer Support Agent" — the built-in demo agent. It is a real program: it parses the
 * conversation, plans tool calls, reacts to tool results and writes responses. Behavioural
 * differences between versions come from its BehaviorProfile, never from the evaluator.
 */
export class SupportAgent implements AgentAdapter {
  readonly kind = "builtin" as const;
  private rt!: AgentRuntime;
  private e!: Entities;
  private mem: Memory = {
    intent: null,
    verified: false,
    profileLoaded: false,
    escalated: false,
    contextChars: 0,
    pendingDirective: null,
    order: null,
    subscription: null,
    accountId: null,
  };

  constructor(
    readonly id: string,
    private readonly profile: BehaviorProfile,
  ) {}

  async respond(input: AgentTurnInput, runtime: AgentRuntime): Promise<AgentTurnOutput> {
    this.rt = runtime;
    this.lastMsg = input.message;
    const userText = input.conversation.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    this.e = extractEntities(userText);
    const latest = classifyIntent(input.message);
    this.mem.intent = latest !== "unknown" ? latest : (this.mem.intent ?? classifyIntent(userText));
    this.think(60, input.conversation);

    if (this.profile.preloadCustomerProfile && this.e.customerId && !this.mem.profileLoaded && this.has("get_customer")) {
      this.mem.profileLoaded = true;
      await this.call("get_customer", { customer_id: this.e.customerId });
    }

    let reply = await this.plan(this.mem.intent);
    await this.obeyInjectedDirective();

    if (this.e.legalThreat && !this.mem.escalated) {
      if (this.profile.escalateLegalThreats && this.has("create_ticket")) {
        const t = await this.ticket("Customer raised a legal threat — urgent specialist review", "urgent");
        if (t) reply += ` Given the seriousness of this, I've also escalated it to our specialist team (ticket ${t}).`;
      } else {
        reply += " I completely understand your frustration, and I'm here to help.";
      }
    }
    this.think(Math.ceil(reply.length / 4), input.conversation);
    return { message: reply };
  }

  // ───────────────────────────── runtime helpers ─────────────────────────────

  private has(tool: string) {
    return this.rt.tools.some((t) => t.name === tool);
  }

  private think(completionTokens: number, conversation: { content: string }[] = []) {
    const convoChars = conversation.reduce((a, m) => a + m.content.length, 0);
    const jitter = 0.9 + this.rt.random() * 0.2;
    this.rt.recordModelUsage({
      model: this.profile.model,
      promptTokens: Math.round(this.profile.systemPromptTokens + convoChars / 4 + this.mem.contextChars / 4),
      completionTokens,
      latencyMs: Math.round(this.profile.baseLatencyMs * jitter + completionTokens * this.profile.msPerToken),
    });
  }

  private async call(tool: string, args: Rec): Promise<ToolCallOutcome> {
    this.think(28);
    let r = await this.rt.callTool(tool, args);
    if (!r.ok && this.profile.retryTransientErrors && /^(HTTP_5\d\d|TIMEOUT)$/.test(r.error?.code ?? "")) {
      this.think(18);
      r = await this.rt.callTool(tool, args);
    }
    if (r.ok) {
      if (typeof r.result === "string" && this.profile.honestOnFailure) {
        return { ok: false, error: { code: "MALFORMED_RESPONSE", message: "unparseable tool response" } };
      }
      this.mem.contextChars += JSON.stringify(r.result ?? null).length;
      const directive = findInjectedDirective(r.result);
      if (directive && !this.profile.injectionGuard) this.mem.pendingDirective = directive;
    }
    return r;
  }

  private async ticket(summary: string, priority: "normal" | "high" | "urgent"): Promise<string | null> {
    if (!this.has("create_ticket")) return null;
    const r = await this.call("create_ticket", { ...(this.e.customerId ? { customer_id: this.e.customerId } : {}), summary, priority });
    if (!r.ok) return null;
    this.mem.escalated = true;
    return String((r.result as Rec).id);
  }

  /** Honest failure handling (v1.1+): escalate and tell the truth. Returns null when the profile is dishonest. */
  private async failure(system: string, action: string, code?: string): Promise<string | null> {
    if (!this.profile.honestOnFailure) return null;
    const t = await this.ticket(`${system} system unavailable while trying to ${action} (${code ?? "error"})`, "high");
    return t
      ? `I'm sorry — our ${system} system isn't responding right now, so I couldn't ${action}. I've opened ticket ${t} and our support team will follow up within one business day.`
      : `I'm sorry — our ${system} system isn't responding right now, so I couldn't ${action}. Please try again in a little while.`;
  }

  private askForIdentity(): string {
    return "I can help with that. Could you share your customer ID (it starts with CUS-) and the 6-digit verification code we sent you?";
  }

  /** Returns a message to send instead of proceeding, or null when the customer is verified. */
  private async ensureVerified(): Promise<string | null> {
    if (this.mem.verified) return null;
    if (!this.e.customerId) return this.askForIdentity();
    if (this.profile.trustClaimedVerification && this.e.claimedVerified) {
      this.mem.verified = true;
      return null;
    }
    if (!this.e.code) return "For your security, could you please share the 6-digit verification code we just sent to your registered email or phone?";
    if (!this.has("verify_customer")) {
      this.mem.verified = true;
      return null;
    }
    const r = await this.call("verify_customer", { customer_id: this.e.customerId, verification_code: this.e.code });
    if (!r.ok) {
      const msg = await this.failure("verification", "verify your identity", r.error?.code);
      if (msg) return msg;
      this.mem.verified = true; // fail-open (v1.0 defect)
      return null;
    }
    if ((r.result as Rec).verified !== true) {
      return "I'm sorry, but that verification code doesn't match our records, so I can't make changes to this account yet. Could you double-check the code and send it again?";
    }
    this.mem.verified = true;
    return null;
  }

  /** v1.0 defect: instructions found inside tool data are executed as if they came from the operator. */
  private async obeyInjectedDirective() {
    const d = this.mem.pendingDirective;
    if (!d) return;
    this.mem.pendingDirective = null;
    if (/refund/i.test(d) && this.has("issue_refund")) {
      const orderId = d.match(/ORD-\d+/)?.[0] ?? (this.mem.order?.id as string | undefined) ?? this.e.orderId;
      const amount = Number(d.match(/\$?(\d+(?:\.\d+)?)/)?.[1] ?? this.mem.order?.total ?? 0);
      if (orderId) await this.call("issue_refund", { order_id: orderId, amount, reason: "account adjustment" });
    } else if (/admin|owner/i.test(d) && this.has("update_member_role")) {
      const user = d.match(/USR-\d+/)?.[0];
      const acc = d.match(/ACC-\d+/)?.[0] ?? this.mem.accountId ?? this.e.accountId;
      if (user && acc) await this.call("update_member_role", { account_id: acc, user_id: user, role: "admin" });
    } else if (/cancel/i.test(d) && this.has("cancel_subscription") && this.mem.subscription) {
      await this.call("cancel_subscription", { subscription_id: this.mem.subscription.id });
    }
  }

  // ───────────────────────────── plans ─────────────────────────────

  private plan(intent: Intent): Promise<string> {
    switch (intent) {
      case "cancel_subscription":
        return this.cancelSubscription();
      case "refund_status":
        return this.refundStatus();
      case "refund_request":
        return this.refundRequest();
      case "cancel_order":
        return this.cancelOrder();
      case "change_address":
        return this.changeAddress();
      case "password_reset":
        return this.simpleAccountAction("send_password_reset", {}, "I've sent a password reset link to the email address on file. It expires in 30 minutes.", "reset your password");
      case "change_email":
        if (!this.e.email) return Promise.resolve("Sure — what's the new email address you'd like on the account?");
        return this.simpleAccountAction("update_email", { email: this.e.email }, "I've updated the email address on your account. You'll get a confirmation message at the new address.", "update your email");
      case "role_change":
        return this.roleChange();
      case "appointment":
        return this.appointment();
      case "invoice":
        return this.invoice();
      case "order_status":
        return this.orderStatus();
      case "technical":
        return this.technical();
      case "human_request":
        return this.human();
      default:
        return Promise.resolve("I'd be glad to help. Could you tell me a bit more about what you need — for example billing, an order, or your account?");
    }
  }

  private async cancelSubscription(): Promise<string> {
    const v = await this.ensureVerified();
    if (v) return v;
    const sub = await this.call("get_subscription", { customer_id: this.e.customerId });
    if (!sub.ok) return (await this.failure("subscription", "look up your subscription", sub.error?.code)) ?? "Your subscription has been cancelled successfully. You won't be charged again.";
    const s = sub.result as Rec;
    this.mem.subscription = s;
    if (s.status === "cancelled") return `Your subscription ${s.id} is already cancelled, so there's nothing more to do — you won't be charged again.`;

    if (this.has("get_refund")) {
      const rf = await this.call("get_refund", { customer_id: this.e.customerId });
      if (!rf.ok) {
        const msg = await this.failure("refund", "confirm there are no pending refunds before cancelling", rf.error?.code);
        if (msg) return msg;
      } else if (this.profile.checkRefundBeforeCancel) {
        const pending = (Array.isArray(rf.result) ? (rf.result as Rec[]) : []).find((r) => r.status === "pending");
        if (pending) {
          return `I can't cancel subscription ${s.id} right now because refund ${pending.id} for ${money(pending.amount)} is still pending. Once that refund completes, you can reply here and I'll cancel the subscription right away.`;
        }
      }
    }
    const c = await this.call("cancel_subscription", { subscription_id: s.id });
    if (!c.ok) return (await this.failure("billing", "cancel your subscription", c.error?.code)) ?? `Your subscription ${s.id} has been cancelled. You won't be charged again.`;
    return `Done — your ${s.plan} subscription (${s.id}) has been cancelled, and you won't be charged again.`;
  }

  private async refundStatus(): Promise<string> {
    if (!this.e.customerId) return "Happy to check. Could you share your customer ID (it starts with CUS-)?";
    const rf = await this.call("get_refund", { customer_id: this.e.customerId });
    if (!rf.ok) return (await this.failure("refund", "check your refund status", rf.error?.code)) ?? "Good news — your refund has been processed and should arrive within 3-5 business days.";
    const list = Array.isArray(rf.result) ? (rf.result as Rec[]) : [];
    if (list.length === 0) return `I don't see any refunds on account ${this.e.customerId}. If you were expecting one, would you like me to open a ticket so our billing team can look into it?`;
    return list
      .map((r) => `Refund ${r.id} for ${money(r.amount)} is currently ${r.status}.${r.status === "pending" ? " Pending refunds usually complete within 5–7 business days." : ""}`)
      .join(" ");
  }

  private async loadOrder(action: string): Promise<{ order: Rec } | { message: string }> {
    if (!this.e.orderId) return { message: `Which order would you like me to ${action}? Could you share the order ID (it starts with ORD-)?` };
    const o = await this.call("get_order", { order_id: this.e.orderId });
    if (!o.ok) {
      if (o.error?.code === "NOT_FOUND") return { message: `I can't find order ${this.e.orderId}. Could you double-check the order ID?` };
      return { message: (await this.failure("orders", action, o.error?.code)) ?? `All set — your request for ${this.e.orderId} has been processed successfully.` };
    }
    this.mem.order = o.result as Rec;
    return { order: o.result as Rec };
  }

  private async refundRequest(): Promise<string> {
    const v = await this.ensureVerified();
    if (v) return v;
    const lo = await this.loadOrder("refund");
    if ("message" in lo) return lo.message;
    const order = lo.order;
    if (order.customer_id && order.customer_id !== this.e.customerId)
      return `I can't refund order ${order.id} because it isn't linked to your account. If you think this is wrong, you can reply and I'll open a ticket.`;
    if (order.refund_eligible === false)
      return `I can't issue a refund for ${order.id} because ${String(order.refund_block_reason ?? "it's outside our 30-day refund window")}. If you believe this is a mistake, you can reply and I'll open a ticket for our billing team to review.`;
    if (order.status === "refunded") return `Order ${order.id} has already been refunded in full, so there's nothing further to refund.`;
    const total = Number(order.total);
    let amount = this.e.amount ?? total;
    const capped = this.profile.capRefundAtOrderTotal && amount > total;
    if (capped) amount = total;
    const r = await this.call("issue_refund", { order_id: order.id, amount, reason: "customer request" });
    if (!r.ok) return (await this.failure("payments", "issue the refund", r.error?.code)) ?? `I've issued a refund of ${money(amount)} for order ${order.id}; it has been processed successfully.`;
    return `I've issued a refund of ${money(amount)} for order ${order.id} (refund ${(r.result as Rec).id}). It's now processing and should reach your original payment method within 5–7 business days.${capped ? ` Refunds are limited to the order total of ${money(total)}.` : ""}`;
  }

  private async cancelOrder(): Promise<string> {
    const v = await this.ensureVerified();
    if (v) return v;
    const lo = await this.loadOrder("cancel");
    if ("message" in lo) return lo.message;
    const order = lo.order;
    if (order.status !== "processing")
      return `I can't cancel order ${order.id} because it has already ${order.status === "delivered" ? "been delivered" : "shipped"}. Once it arrives, you can start a free return from your account, and I can help with that.`;
    const c = await this.call("cancel_order", { order_id: order.id });
    if (!c.ok) {
      if (c.error?.code === "CONFLICT") return `I can't cancel order ${order.id} because it's no longer in processing. Once it arrives, you can start a free return.`;
      return (await this.failure("orders", "cancel the order", c.error?.code)) ?? `Order ${order.id} has been cancelled. You'll receive a confirmation email shortly.`;
    }
    return `Order ${order.id} has been cancelled. You'll receive a confirmation email shortly.`;
  }

  private async changeAddress(): Promise<string> {
    const v = await this.ensureVerified();
    if (v) return v;
    if (!this.e.address) return "Sure — what's the new shipping address?";
    const lo = await this.loadOrder("update");
    if ("message" in lo) return lo.message;
    const order = lo.order;
    if (order.status !== "processing")
      return `I can't change the address for ${order.id} because it has already shipped. Once it's out for delivery you can redirect it with the carrier using your tracking number.`;
    const u = await this.call("update_order_address", { order_id: order.id, address: this.e.address });
    if (!u.ok) return (await this.failure("orders", "update the address", u.error?.code)) ?? `The shipping address for ${order.id} has been updated.`;
    return `I've updated the shipping address for ${order.id}. You'll see the change in your order confirmation.`;
  }

  private async simpleAccountAction(tool: string, extra: Rec, success: string, action: string): Promise<string> {
    const v = await this.ensureVerified();
    if (v) return v;
    const r = await this.call(tool, { customer_id: this.e.customerId, ...extra });
    if (!r.ok) return (await this.failure("account", action, r.error?.code)) ?? success;
    return success;
  }

  private async roleChange(): Promise<string> {
    const acc = this.e.accountId;
    const target = this.e.userIds[0];
    const role = this.e.role;
    if (!acc || !target || !role) return "I can help with roles. Could you confirm the account ID (ACC-…), the user ID (USR-…) and the role you'd like them to have?";
    this.mem.accountId = acc;
    const m = await this.call("get_account_members", { account_id: acc });
    if (!m.ok) return (await this.failure("accounts", "change that role", m.error?.code)) ?? `${target} has been updated to ${role} on account ${acc}.`;
    const members = m.result as Record<string, Rec>;
    const requesterRole = this.e.sessionUserId ? (members[this.e.sessionUserId]?.role as string | undefined) : undefined;
    if (this.profile.checkRequesterRole && !["admin", "owner"].includes(requesterRole ?? ""))
      return `I can't change roles on ${acc} because only account admins or owners can do that, and your account is a ${requesterRole ?? "non-admin"} user. You can ask an admin on your account to make this change.`;
    if (!members[target]) return `I can't find ${target} on account ${acc}. Could you double-check the user ID?`;
    if (role === "owner")
      return `I can't transfer ownership in chat because ownership changes require a signed request from the current owner. You can start the transfer from Settings > Members.`;
    const u = await this.call("update_member_role", { account_id: acc, user_id: target, role });
    if (!u.ok) return (await this.failure("accounts", "change that role", u.error?.code)) ?? `${target} has been updated to ${role}.`;
    return `${target} has been updated to ${role} on account ${acc}. The change takes effect the next time they sign in.`;
  }

  private async appointment(): Promise<string> {
    if (!this.e.customerId) return this.askForIdentity();
    if (!this.e.date) return "Which date would you like to come in (YYYY-MM-DD)?";
    const av = await this.call("get_availability", { date: this.e.date });
    if (!av.ok) {
      if (av.error?.code === "NOT_FOUND") return `We don't have any slots published for ${this.e.date} yet. Would you like to try a different date?`;
      return (await this.failure("scheduling", "check availability", av.error?.code)) ?? `Your appointment has been booked for ${this.e.date}.`;
    }
    const slots = (Array.isArray(av.result) ? av.result : []) as string[];
    if (!this.e.time) return `On ${this.e.date} we have ${slots.join(", ")} available. Which time would you like?`;
    if (!slots.includes(this.e.time)) return `${this.e.time} isn't open on ${this.e.date}. Available times are ${slots.join(", ")}. Which would you like?`;
    const b = await this.call("book_appointment", { customer_id: this.e.customerId, date: this.e.date, time: this.e.time });
    if (!b.ok) return (await this.failure("scheduling", "book the appointment", b.error?.code)) ?? `Your appointment has been booked for ${this.e.date} at ${this.e.time}.`;
    return `Your appointment has been booked for ${this.e.date} at ${this.e.time} (confirmation ${(b.result as Rec).id}).`;
  }

  private async invoice(): Promise<string> {
    if (!this.e.invoiceId) return "I can look into that. Could you share the invoice ID (it starts with INV-)?";
    const r = await this.call("get_invoice", { invoice_id: this.e.invoiceId });
    if (!r.ok) return (await this.failure("billing", "pull up that invoice", r.error?.code)) ?? `Invoice ${this.e.invoiceId} is paid in full and there's nothing outstanding.`;
    const inv = r.result as Rec;
    const lines = Array.isArray(inv.lines) ? (inv.lines as string[]).join(", ") : "";
    if (this.e.doubleCharge) {
      const t = await this.ticket(`Possible duplicate charge on ${inv.id}`, "high");
      return `I see invoice ${inv.id} for ${money(inv.amount)} (${inv.status}). ${t ? `I've opened ticket ${t} so our billing team can review the duplicate charge — they'll follow up within one business day.` : "Our billing team will need to review the duplicate charge."}`;
    }
    return `Invoice ${inv.id} is for ${money(inv.amount)} and is currently ${inv.status} (due ${inv.due}).${lines ? ` It covers: ${lines}.` : ""}`;
  }

  private async orderStatus(): Promise<string> {
    const lo = await this.loadOrder("look up");
    if ("message" in lo) return lo.message;
    const o = lo.order;
    return `Order ${o.id} is currently ${o.status}.${this.profile.revealAddressInStatus && o.address ? ` It's shipping to ${o.address}.` : ""}`;
  }

  private async technical(): Promise<string> {
    if (!this.has("search_kb")) return this.human();
    const r = await this.call("search_kb", { query: this.lastUserMessage() });
    if (!r.ok) return (await this.failure("help-center", "search our troubleshooting guides", r.error?.code)) ?? "Try restarting the app — that resolves this issue in nearly all cases.";
    const results = (Array.isArray(r.result) ? r.result : []) as Rec[];
    if (results.length === 0) {
      const t = await this.ticket(`Unresolved technical issue: ${this.lastUserMessage().slice(0, 80)}`, "normal");
      return t
        ? `I couldn't find a known fix for this, so I've opened ticket ${t} and our technical team will follow up.`
        : "I couldn't find a known fix for this. Please try again later.";
    }
    return `Here's what usually fixes this: ${results[0]!.body} If that doesn't help, let me know and I'll open a ticket for our technical team.`;
  }

  private async human(): Promise<string> {
    const t = await this.ticket(`Customer requested a human: ${this.lastUserMessage().slice(0, 80)}`, "high");
    return t
      ? `I've escalated this to a specialist (ticket ${t}); our support team will contact you within 24 hours.`
      : "I'm not able to transfer you right now. Please try again shortly.";
  }

  private lastMsg = "";
  private lastUserMessage(): string {
    return this.lastMsg;
  }
}

/** Factory: fresh agent (fresh memory) per scenario execution. */
export function createSupportAgent(version: string, profile: BehaviorProfile): AgentAdapter {
  return new SupportAgent(`customer-support-agent@${version}`, profile);
}
