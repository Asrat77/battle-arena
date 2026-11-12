// Withdrawals: a player asks to cash out to their own Telebirr or CBE
// account. The amount leaves their wallet at once (so it can't be staked
// twice) and a Telegram bot alerts the moderators' group with Paid / Reject
// buttons. A moderator taps Paid first (from then on the player can't cancel),
// sends the money by hand and replies with the transaction number. verify.et
// must confirm that transfer: to the player's account, for the full amount,
// made after the request, from our own account (when PAYOUT_SENDER_NAME is
// set), and not used for another withdrawal. When it can't confirm (or
// verify.et isn't set up) a moderator can still "confirm paid anyway" with a
// written reason, which is recorded. Reject refunds the player; once a payout
// number was given, Reject asks again, since a refund after a real payout pays
// twice. A player can cancel a request no moderator has picked up yet.
//
// On when WALLET_MODE=real and TELEGRAM_BOT_TOKEN and TELEGRAM_MODERATOR_CHAT
// are set. The bot long-polls Telegram, so no public webhook URL is needed;
// run one server process per bot token. Only updates from the moderators'
// chat are acted on.

import { randomBytes } from "node:crypto";
import type { Socket } from "socket.io";
import { type DepositBank, namesMatch, normalizeReference, type VerifyEt } from "./deposits";
import { type Moderators, moderatorList, telegramName } from "./moderators";
import type { Store } from "./store";
import { BIRR, type Wallet } from "./wallet";

const WITHDRAWALS = "withdrawals";
export const MIN_WITHDRAWAL = 50 * BIRR;
const BANKS: Record<DepositBank, string> = { telebirr: "Telebirr", cbe: "CBE" };
/** Clock difference we allow between verify.et's receipt time and ours. */
export const CLOCK_SKEW_MS = 5 * 60_000;
/** Payouts above this need a second moderator's approval (SECOND_APPROVAL_ABOVE_BIRR). */
export const SECOND_APPROVAL_ABOVE = 1_000 * BIRR;

export type WithdrawalStatus = "pending" | "paid" | "rejected" | "cancelled";

export interface Withdrawal {
  id: string;
  profileId: string;
  bank: DepositBank;
  /** The player's own Telebirr number or CBE account. */
  account: string;
  amount: number;
  status: WithdrawalStatus;
  /** Transaction number of the moderator's transfer, once paid. */
  reference: string | null;
  /** Telegram name of the moderator who closed it ("player" when the player cancelled). */
  closedBy: string | null;
  /** The moderator who tapped Paid; from then on the player can't cancel. */
  pickedUpBy?: string | null;
  /** The last payout number verify.et couldn't confirm, and why. */
  unverified?: { reference: string; why: string } | null;
  /** Set when a moderator confirmed the payout without verify.et's check. */
  forced?: { by: string; reason: string } | null;
  /** A large payout one moderator has confirmed, waiting for a second one. */
  approval?: { reference: string; by: string; byId: string; forced: { by: string; reason: string } | null } | null;
  /** The "reply with why you're sure" prompt for a forced confirmation. */
  forcePromptMessageId?: number | null;
  createdAt: number;
  closedAt: number | null;
  /** The alert in the moderators' chat, and the "reply with the number" prompt. */
  alertMessageId: number | null;
  promptMessageId: number | null;
}

export type WithdrawalView = Pick<Withdrawal, "id" | "bank" | "account" | "amount" | "status" | "reference" | "createdAt" | "closedAt"> & {
  /** No moderator has picked it up yet, so the player may still cancel. */
  cancellable: boolean;
};

/** The few Telegram Bot API calls we use. */
export interface TelegramApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bot API JSON
  call(method: string, params: Record<string, unknown>): Promise<any>;
}

export function httpTelegram(token: string, baseUrl = "https://api.telegram.org"): TelegramApi {
  return {
    async call(method, params) {
      const res = await fetch(`${baseUrl}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const body = await res.json().catch(() => ({}));
      if (!body?.ok) throw new Error(`telegram ${method}: ${body?.description ?? res.status}`);
      return body.result;
    },
  };
}

export interface WithdrawalOptions {
  telegram: TelegramApi | null;
  /** Chat id of the moderators' group (a negative number for groups). */
  moderatorChat: string | null;
  verifyEt?: VerifyEt | null;
  /** Telegram user ids allowed to act (TELEGRAM_MODERATORS). Default: the owner of a one-to-one moderator chat. */
  moderators?: Moderators;
  /** Payouts above this many santim need a second moderator; null turns that off. */
  secondApprovalAbove?: number | null;
  /** Name on our payout account; when set, the payout receipt's sender must match it. */
  payoutSenderName?: string | null;
  nameOf?: (profileId: string) => string;
  now?: () => number;
  onUpdate?: (w: Withdrawal) => void;
  /** Other handlers for the same moderators' chat (deposit reviews); given every update from it. */
  alsoHandle?: (update: unknown) => Promise<void>;
}

/** Telebirr: an Ethiopian mobile number, kept as 09XXXXXXXX. CBE: 10 to 16 digits. */
export function normalizeAccount(bank: DepositBank, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  if (bank === "telebirr") {
    const m = digits.match(/^(?:\+?251|0)?([79]\d{8})$/);
    return m ? `0${m[1]}` : null;
  }
  return /^\d{10,16}$/.test(digits) ? digits : null;
}

/** SECOND_APPROVAL_ABOVE_BIRR: a number of birr, or "off". Unset or unreadable: the default. */
export function secondApprovalFromEnv(raw: string | undefined): number | null {
  if (raw?.trim().toLowerCase() === "off") return null;
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? Math.round(n * BIRR) : SECOND_APPROVAL_ABOVE;
}

const birr = (santim: number) => (santim / BIRR).toLocaleString("en-US", { maximumFractionDigits: 2 });

export class Withdrawals {
  private readonly now: () => number;
  private readonly onUpdate: (w: Withdrawal) => void;
  private readonly nameOf: (profileId: string) => string;
  private readonly moderators: Moderators;
  private readonly secondApprovalAbove: number | null;
  private polling = false;
  private offset = 0;

  constructor(
    private readonly store: Store,
    private readonly wallet: Wallet,
    private readonly opts: WithdrawalOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.onUpdate = opts.onUpdate ?? (() => {});
    this.nameOf = opts.nameOf ?? ((id) => id);
    this.moderators = opts.moderators ?? moderatorList(null, opts.moderatorChat);
    this.secondApprovalAbove = opts.secondApprovalAbove === undefined ? SECOND_APPROVAL_ABOVE : opts.secondApprovalAbove;
  }

  get enabled(): boolean {
    return this.wallet.mode === "real" && this.opts.telegram !== null && !!this.opts.moderatorChat;
  }

  private list(): Withdrawal[] {
    return this.store.read<Withdrawal[]>(WITHDRAWALS, []);
  }

  private save(list: Withdrawal[]) {
    this.store.write(WITHDRAWALS, list);
  }

  get(id: string): Withdrawal | null {
    return this.list().find((w) => w.id === id) ?? null;
  }

  /** A player's own requests, without moderator-only notes. */
  forPlayer(profileId: string, limit = 10) {
    return this.list()
      .filter((w) => w.profileId === profileId)
      .slice(-limit)
      .reverse()
      .map((w) => this.view(w));
  }

  /** What the player sees of a request (no moderator notes). */
  view(w: Withdrawal): WithdrawalView {
    return {
      id: w.id,
      bank: w.bank,
      account: w.account,
      amount: w.amount,
      status: w.status,
      reference: w.reference,
      createdAt: w.createdAt,
      closedAt: w.closedAt,
      cancellable: w.status === "pending" && !w.pickedUpBy,
    };
  }

  /** The withdrawal that already used payout number `reference`, if any. */
  private usedBy(reference: string, except: string): Withdrawal | null {
    return (
      this.list().find(
        (x) =>
          x.id !== except &&
          ((x.status === "paid" && x.reference && normalizeReference(x.reference) === reference) || (x.status === "pending" && x.approval?.reference === reference)),
      ) ?? null
    );
  }

  /** The player takes back a request no moderator has picked up yet. */
  async cancel(profileId: string, id: unknown): Promise<{ ok: true } | { ok: false; reason: string }> {
    const w = typeof id === "string" ? this.get(id) : null;
    if (!w || w.profileId !== profileId) return { ok: false, reason: "no such withdrawal" };
    if (w.status !== "pending") return { ok: false, reason: "that withdrawal is already closed" };
    if (w.pickedUpBy) return { ok: false, reason: "a moderator is already sending it" };
    this.wallet.refundWithdrawal(w.profileId, w.amount, w.id);
    await this.close(w, { status: "cancelled", closedBy: "player" });
    return { ok: true };
  }

  async request(
    profileId: string,
    input: { bank?: unknown; account?: unknown; amount?: unknown },
  ): Promise<{ ok: true; withdrawal: WithdrawalView } | { ok: false; reason: string }> {
    if (!this.enabled) return { ok: false, reason: "withdrawals are off" };
    const bank = (["telebirr", "cbe"] as const).find((b) => b === input.bank);
    if (!bank) return { ok: false, reason: "pick Telebirr or CBE" };
    const account = normalizeAccount(bank, input.account);
    if (!account) return { ok: false, reason: bank === "telebirr" ? "enter a Telebirr number like 0911223344" : "enter your CBE account number" };
    const amount = input.amount;
    if (typeof amount !== "number" || !Number.isInteger(amount)) return { ok: false, reason: "enter an amount" };
    if (amount < MIN_WITHDRAWAL) return { ok: false, reason: `the smallest withdrawal is ${birr(MIN_WITHDRAWAL)} birr` };
    if (this.list().some((w) => w.profileId === profileId && w.status === "pending")) {
      return { ok: false, reason: "you already have a withdrawal waiting" };
    }

    const w: Withdrawal = {
      id: randomBytes(4).toString("hex"),
      profileId,
      bank,
      account,
      amount,
      status: "pending",
      reference: null,
      closedBy: null,
      createdAt: this.now(),
      closedAt: null,
      alertMessageId: null,
      promptMessageId: null,
    };
    const taken = this.wallet.withdraw(profileId, amount, w.id);
    if (!taken.ok) return { ok: false, reason: taken.reason };
    const list = this.list();
    list.push(w);
    this.save(list);

    try {
      const msg = await this.opts.telegram!.call("sendMessage", {
        chat_id: this.opts.moderatorChat,
        text: this.alertText(w),
        reply_markup: this.buttons(w),
      });
      this.patch(w.id, { alertMessageId: msg?.message_id ?? null });
    } catch (err) {
      // The request stands (the money is held); moderators can still find it with /pending.
      console.warn(`withdrawal ${w.id}: telegram alert failed`, err);
    }
    return { ok: true, withdrawal: this.view(this.get(w.id)!) };
  }

  private alertText(w: Withdrawal) {
    const lines = [
      `💸 Withdrawal ${w.id}`,
      `Player: ${this.nameOf(w.profileId)}`,
      `Amount: ${birr(w.amount)} birr`,
      `Send to: ${BANKS[w.bank]} ${w.account}`,
    ];
    if (w.status === "paid") lines.push(`✅ Paid by ${w.closedBy} · ref ${w.reference}`);
    if (w.status === "paid" && w.forced) lines.push(`⚠️ Not checked by verify.et. ${w.forced.by}: "${w.forced.reason}"`);
    else if (w.status === "rejected") lines.push(`❌ Rejected by ${w.closedBy} · refunded`);
    else if (w.status === "cancelled") lines.push("🚫 Cancelled by the player · refunded");
    else if (w.approval) lines.push("", `${w.approval.by} confirmed ${w.approval.reference}. Waiting for a second moderator to approve.`);
    else if (w.pickedUpBy) lines.push("", `${w.pickedUpBy} is sending it. Reply to the prompt with the transaction number.`);
    else lines.push("", "Tap Paid BEFORE you send (so the player can't cancel), send the money, then reply with the transaction number.");
    return lines.join("\n");
  }

  private buttons(w: Withdrawal) {
    if (w.status !== "pending") return { inline_keyboard: [] };
    return {
      inline_keyboard: [
        [
          { text: "✅ Paid", callback_data: `paid:${w.id}` },
          { text: "❌ Reject", callback_data: `reject:${w.id}` },
        ],
      ],
    };
  }

  private patch(id: string, changes: Partial<Withdrawal>): Withdrawal | null {
    const list = this.list();
    const w = list.find((x) => x.id === id);
    if (!w) return null;
    Object.assign(w, changes);
    this.save(list);
    return w;
  }

  private async say(text: string, extra: Record<string, unknown> = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bot API JSON
    return this.opts.telegram!.call("sendMessage", { chat_id: this.opts.moderatorChat, text, ...extra }).catch((): any => null);
  }

  private async refreshAlert(w: Withdrawal) {
    if (w.alertMessageId === null) return;
    await this.opts
      .telegram!.call("editMessageText", {
        chat_id: this.opts.moderatorChat,
        message_id: w.alertMessageId,
        text: this.alertText(w),
        reply_markup: this.buttons(w),
      })
      .catch(() => {});
  }

  private close(w: Withdrawal, changes: Partial<Withdrawal>) {
    const closed = this.patch(w.id, { ...changes, closedAt: this.now() })!;
    this.onUpdate(closed);
    return this.refreshAlert(closed);
  }

  /** One update from Telegram's getUpdates. Anything outside the moderators' chat is ignored. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bot API JSON
  async handleUpdate(update: any): Promise<void> {
    if (!this.enabled) return;
    const chat = String(update?.callback_query?.message?.chat?.id ?? update?.message?.chat?.id ?? "");
    if (chat !== String(this.opts.moderatorChat)) return;
    const from = update?.callback_query?.from ?? update?.message?.from;
    if (!this.moderators.allows(from?.id)) {
      console.warn(`moderator chat: ignored an update from ${from?.id}, who isn't on TELEGRAM_MODERATORS`);
      const cbId = update?.callback_query?.id;
      if (cbId) await this.opts.telegram!.call("answerCallbackQuery", { callback_query_id: cbId, text: "You're not on the moderator list." }).catch(() => {});
      return;
    }
    if (this.opts.alsoHandle) await this.opts.alsoHandle(update).catch((err) => console.warn("moderator update failed", err));

    const cb = update.callback_query;
    if (cb) {
      const [action, id] = String(cb.data ?? "").split(":");
      if (!["paid", "reject", "reject!", "force", "approve"].includes(action)) return;
      const w = this.get(id);
      const who = telegramName(cb.from);
      await this.opts.telegram!.call("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => {});
      if (!w) return;
      if (w.status !== "pending") {
        await this.say(`Withdrawal ${w.id} is already ${w.status === "cancelled" ? "cancelled by the player" : w.status}.`);
        return;
      }
      const given = w.approval?.reference ?? w.unverified?.reference;
      if (action === "reject" && given) {
        // A payout number was given: maybe money went out. A refund now would pay twice.
        await this.say(`Withdrawal ${w.id}: ${given} was given as its payout. Reject only if NO money was sent; the player gets ${birr(w.amount)} birr back.`, {
          reply_markup: { inline_keyboard: [[{ text: "❌ Nothing was sent, refund", callback_data: `reject!:${w.id}` }]] },
        });
      } else if (action === "reject" || action === "reject!") {
        this.wallet.refundWithdrawal(w.profileId, w.amount, w.id);
        await this.close(w, { status: "rejected", closedBy: who });
      } else if (action === "paid") {
        if (!w.pickedUpBy) this.patch(w.id, { pickedUpBy: who });
        const prompt = await this.say(`Reply to this message with the ${BANKS[w.bank]} transaction number for withdrawal ${w.id} (${birr(w.amount)} birr to ${w.account}).`, {
          reply_markup: { force_reply: true, selective: true },
        });
        if (prompt?.message_id) this.patch(w.id, { promptMessageId: prompt.message_id });
        await this.refreshAlert(this.get(w.id)!);
      } else if (action === "approve") {
        const a = w.approval;
        if (!a) return;
        if (a.byId === String(cb.from?.id)) {
          await this.say(`Withdrawal ${w.id} needs a different moderator to approve it.`);
          return;
        }
        await this.close(w, { status: "paid", reference: a.reference, closedBy: `${a.by} + ${who}`, forced: a.forced, approval: null });
        await this.say(`✅ Withdrawal ${w.id} approved by ${who} and marked paid (${a.reference}).`);
      } else if (action === "force") {
        if (!w.unverified) return;
        const prompt = await this.say(
          `Confirming withdrawal ${w.id} as paid with ${w.unverified.reference} WITHOUT verify.et's check (${w.unverified.why}). Reply to this message with why you're sure the money reached ${BANKS[w.bank]} ${w.account}. It is recorded with your name.`,
          { reply_markup: { force_reply: true, selective: true } },
        );
        if (prompt?.message_id) this.patch(w.id, { forcePromptMessageId: prompt.message_id });
      }
      return;
    }

    const msg = update.message;
    const repliedTo = msg?.reply_to_message?.message_id;
    if (typeof msg?.text === "string" && msg.text.trim().startsWith("/pending")) {
      const open = this.list().filter((w) => w.status === "pending");
      await this.say(open.length ? open.map((w) => this.alertText(w).split("\n").slice(0, 4).join(" · ")).join("\n\n") : "No withdrawals waiting.");
      return;
    }
    if (!repliedTo || typeof msg.text !== "string") return;
    const who = telegramName(msg.from);
    const whoId = String(msg.from?.id);

    const forcing = this.list().find((x) => x.forcePromptMessageId === repliedTo && x.status === "pending");
    if (forcing?.unverified) {
      const reason = msg.text.trim().slice(0, 300);
      if (reason.length < 5) {
        await this.say("Write a short reason (what you checked). Reply to the prompt again.");
        return;
      }
      const used = this.usedBy(forcing.unverified.reference, forcing.id);
      if (used) {
        await this.say(`${forcing.unverified.reference} was already used for withdrawal ${used.id}.`);
        return;
      }
      await this.markPaid(forcing, forcing.unverified.reference, who, whoId, { by: who, reason });
      return;
    }

    const w = this.list().find((x) => x.promptMessageId === repliedTo && x.status === "pending");
    if (!w || w.approval) return;
    const reference = normalizeReference(msg.text.trim());
    if (!/^[A-Z0-9]{6,40}$/.test(reference)) {
      await this.say("That doesn't look like a transaction number. Reply to the prompt again.");
      return;
    }
    const used = this.usedBy(reference, w.id);
    if (used) {
      await this.say(`${reference} was already used for withdrawal ${used.id}. Reply to the prompt with this payout's own number.`);
      return;
    }
    const why = await this.checkPayout(w, reference);
    if (why) {
      this.patch(w.id, { unverified: { reference, why } });
      await this.say(`Couldn't confirm ${reference} for withdrawal ${w.id}: ${why}. Check it and reply to the prompt again, or confirm it by hand if you're sure.`, {
        reply_markup: { inline_keyboard: [[{ text: "⚠️ Confirm paid anyway", callback_data: `force:${w.id}` }]] },
      });
      return;
    }
    await this.markPaid(w, reference, who, whoId, null);
  }

  /** Close as paid, or, above the second-approval limit, wait for another moderator. */
  private async markPaid(w: Withdrawal, reference: string, who: string, whoId: string, forced: { by: string; reason: string } | null) {
    if (this.secondApprovalAbove !== null && w.amount > this.secondApprovalAbove) {
      const updated = this.patch(w.id, { approval: { reference, by: who, byId: whoId, forced }, unverified: null })!;
      await this.refreshAlert(updated);
      const lonely = this.moderators.count < 2 ? " Only one moderator is on TELEGRAM_MODERATORS: add another, or Reject it if nothing was sent." : "";
      await this.say(`Withdrawal ${w.id} is ${birr(w.amount)} birr, so a second moderator must approve ${reference}${forced ? " (not checked by verify.et)" : ""}.${lonely}`, {
        reply_markup: { inline_keyboard: [[{ text: "✅ Approve payout", callback_data: `approve:${w.id}` }]] },
      });
      return;
    }
    await this.close(w, { status: "paid", reference, closedBy: who, forced, unverified: null });
    await this.say(forced ? `⚠️ Withdrawal ${w.id} marked paid (${reference}) without verify.et's check.` : `✅ Withdrawal ${w.id} marked paid (${reference}).`);
  }

  /** Why verify.et doesn't show `reference` as this payout, or null when it does. */
  private async checkPayout(w: Withdrawal, reference: string): Promise<string | null> {
    if (!this.opts.verifyEt) return "verify.et isn't set up, so payouts can't be checked";
    let r;
    try {
      r = await this.opts.verifyEt.verify({ bank: w.bank, reference, settlementAccount: w.account });
    } catch {
      return "couldn't reach verify.et";
    }
    if (r.state === "pending") return "verify.et is still checking";
    if (r.state === "failed") return r.reason;
    if (!r.toUs) return `it went to a different account than ${w.account}`;
    if (r.amount < w.amount) return `it was ${birr(r.amount)} birr, not ${birr(w.amount)}`;
    if (r.itemStatus && !/^(success|successful|completed)$/i.test(r.itemStatus)) return `the receipt says "${r.itemStatus}"`;
    if (r.paidAt == null) return "the receipt has no date";
    if (r.paidAt < w.createdAt - CLOCK_SKEW_MS) return "it was made before the player asked for this withdrawal";
    const ours = this.opts.payoutSenderName;
    if (ours && !namesMatch(ours, r.senderName)) return `it was sent by "${r.senderName ?? "?"}", not our account`;
    return null;
  }

  /** Long-poll Telegram for button taps and replies until stop(). */
  start() {
    if (!this.enabled || this.polling) return;
    this.polling = true;
    void (async () => {
      while (this.polling) {
        try {
          const updates = await this.opts.telegram!.call("getUpdates", {
            offset: this.offset,
            timeout: 30,
            allowed_updates: ["message", "callback_query"],
          });
          for (const u of updates ?? []) {
            this.offset = Math.max(this.offset, u.update_id + 1);
            await this.handleUpdate(u).catch((err) => console.warn("withdrawal update failed", err));
          }
        } catch (err) {
          console.warn("telegram poll failed", err);
          await new Promise((r) => setTimeout(r, 5_000));
        }
      }
    })();
  }

  stop() {
    this.polling = false;
  }

  /** What the wallet screen needs. */
  summary(profileId: string) {
    return { enabled: this.enabled, minAmount: MIN_WITHDRAWAL, requests: this.forPlayer(profileId) };
  }

  /** wallet:withdraw { bank, account, amount } over the signed-in socket. */
  attach(socket: Socket, profileId: string) {
    socket.on("wallet:withdraw", async (msg: { bank?: unknown; account?: unknown; amount?: unknown }, ack?: (res: unknown) => void) => {
      const res = await this.request(profileId, msg ?? {});
      if (typeof ack === "function") ack(res);
    });
    socket.on("wallet:withdraw-cancel", async (msg: { id?: unknown }, ack?: (res: unknown) => void) => {
      const res = await this.cancel(profileId, msg?.id);
      if (typeof ack === "function") ack(res);
    });
  }
}
