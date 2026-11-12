// Withdrawals: a player asks to cash out to their own Telebirr or CBE
// account. The amount leaves their wallet at once (so it can't be staked
// twice) and a Telegram bot alerts the moderators' group with Paid / Reject
// buttons. A moderator sends the money by hand, taps Paid and replies with
// the transaction number; when verify.et is set up we check that transfer
// really reached the player before closing the request. Reject refunds it.
//
// On when WALLET_MODE=real and TELEGRAM_BOT_TOKEN and TELEGRAM_MODERATOR_CHAT
// are set. The bot long-polls Telegram, so no public webhook URL is needed;
// run one server process per bot token. Only updates from the moderators'
// chat are acted on.

import { randomBytes } from "node:crypto";
import type { Socket } from "socket.io";
import type { DepositBank, VerifyEt } from "./deposits";
import type { Store } from "./store";
import { BIRR, type Wallet } from "./wallet";

const WITHDRAWALS = "withdrawals";
export const MIN_WITHDRAWAL = 50 * BIRR;
const BANKS: Record<DepositBank, string> = { telebirr: "Telebirr", cbe: "CBE" };

export type WithdrawalStatus = "pending" | "paid" | "rejected";

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
  /** Telegram name of the moderator who closed it. */
  closedBy: string | null;
  createdAt: number;
  closedAt: number | null;
  /** The alert in the moderators' chat, and the "reply with the number" prompt. */
  alertMessageId: number | null;
  promptMessageId: number | null;
}

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

const birr = (santim: number) => (santim / BIRR).toLocaleString("en-US", { maximumFractionDigits: 2 });

export class Withdrawals {
  private readonly now: () => number;
  private readonly onUpdate: (w: Withdrawal) => void;
  private readonly nameOf: (profileId: string) => string;
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

  forPlayer(profileId: string, limit = 10): Withdrawal[] {
    return this.list()
      .filter((w) => w.profileId === profileId)
      .slice(-limit)
      .reverse();
  }

  async request(
    profileId: string,
    input: { bank?: unknown; account?: unknown; amount?: unknown },
  ): Promise<{ ok: true; withdrawal: Withdrawal } | { ok: false; reason: string }> {
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
    return { ok: true, withdrawal: this.get(w.id)! };
  }

  private alertText(w: Withdrawal) {
    const lines = [
      `💸 Withdrawal ${w.id}`,
      `Player: ${this.nameOf(w.profileId)}`,
      `Amount: ${birr(w.amount)} birr`,
      `Send to: ${BANKS[w.bank]} ${w.account}`,
    ];
    if (w.status === "paid") lines.push(`✅ Paid by ${w.closedBy} · ref ${w.reference}`);
    else if (w.status === "rejected") lines.push(`❌ Rejected by ${w.closedBy} · refunded`);
    else lines.push("", "Send the money, then tap Paid and reply with the transaction number.");
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
    if (this.opts.alsoHandle) await this.opts.alsoHandle(update).catch((err) => console.warn("moderator update failed", err));

    const cb = update.callback_query;
    if (cb) {
      const [action, id] = String(cb.data ?? "").split(":");
      if (action !== "paid" && action !== "reject") return;
      const w = this.get(id);
      const who = cb.from?.username ? `@${cb.from.username}` : (cb.from?.first_name ?? "a moderator");
      await this.opts.telegram!.call("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => {});
      if (!w || w.status !== "pending") return;
      if (action === "reject") {
        this.wallet.refundWithdrawal(w.profileId, w.amount, w.id);
        await this.close(w, { status: "rejected", closedBy: who });
      } else if (action === "paid") {
        const prompt = await this.say(`Reply to this message with the ${BANKS[w.bank]} transaction number for withdrawal ${w.id} (${birr(w.amount)} birr to ${w.account}).`, {
          reply_markup: { force_reply: true, selective: true },
        });
        if (prompt?.message_id) this.patch(w.id, { promptMessageId: prompt.message_id });
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
    const w = this.list().find((x) => x.promptMessageId === repliedTo && x.status === "pending");
    if (!w) return;
    const reference = msg.text.trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,40}$/.test(reference)) {
      await this.say("That doesn't look like a transaction number. Reply to the prompt again.");
      return;
    }
    const who = msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? "a moderator");

    // With verify.et set up, check the transfer really reached the player's account.
    if (this.opts.verifyEt) {
      let result;
      try {
        result = await this.opts.verifyEt.verify({ bank: w.bank, reference, settlementAccount: w.account });
      } catch {
        result = { state: "failed" as const, reason: "couldn't reach verify.et" };
      }
      const ok = result.state === "verified" && result.toUs && result.amount >= w.amount;
      if (!ok) {
        const why =
          result.state === "verified"
            ? !result.toUs
              ? `it went to a different account than ${w.account}`
              : `it was ${birr(result.amount)} birr, not ${birr(w.amount)}`
            : result.state === "pending"
              ? "verify.et is still checking"
              : result.reason;
        await this.say(`Couldn't confirm ${reference} for withdrawal ${w.id}: ${why}. Check it and reply to the prompt again.`);
        return;
      }
    }
    await this.close(w, { status: "paid", reference, closedBy: who });
    await this.say(`✅ Withdrawal ${w.id} marked paid (${reference}).`);
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
  }
}
