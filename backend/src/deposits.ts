// Real-money deposits, checked with verify.et (https://verify.et/docs/api).
//
// The player sends birr to one of our accounts by Telebirr or CBE, then pastes
// the transaction number. verify.et confirms the transfer is real, how much
// it was, and that it was paid to our account (settlementAccount). Only then
// is the wallet credited. A reference can be credited once, ever.
//
// verify.et only verifies; it can't collect or pay out. Deposits are on only
// when WALLET_MODE=real, VERIFY_ET_KEY is set, and at least one deposit
// account (DEPOSIT_TELEBIRR, DEPOSIT_CBE) is configured.
//
// A reference alone proves a transfer happened, not who made it. So the player
// tells us the name on the account they pay from (kept once a deposit is
// credited), and a transfer is credited straight away only when the receipt's
// sender matches it, it was made in the last day and after the account was
// created, and it reached our account (and our name, with DEPOSIT_RECEIVER_NAME).
// Anything doubtful goes to the moderators on Telegram to approve or reject;
// a rejected one frees its reference for whoever really paid it.

import { randomBytes } from "node:crypto";
import type { Socket } from "socket.io";
import { RateLimiter } from "./rateLimit";
import type { Store } from "./store";
import { BIRR, type Wallet } from "./wallet";

const DEPOSITS = "deposits";
export const MIN_DEPOSIT = 10 * BIRR;
/** How long to keep asking verify.et about a check it queued. */
export const POLL_MS = 3_000;
export const POLL_TRIES = 20;
/** Extra tries when the bank's receipt server is slow or verify.et is busy. */
export const RETRY_MS = 5_000;
export const RETRIES = 2;
/** A transfer older than this goes to a moderator instead of being credited at once. */
export const MAX_TRANSFER_AGE_MS = 24 * 60 * 60_000;
/**
 * Each check can spend up to 1 + RETRIES of verify.et's monthly credits, so
 * checks are limited per account and per IP, one at a time per account.
 */
export const DEPOSIT_LIMITS = { perAccount: 5, perIp: 15, windowMs: 60 * 60_000 };
/** How often to remind moderators that verify.et credits ran out. */
const CREDITS_ALERT_EVERY_MS = 60 * 60_000;
/** Phone and server clocks differ a little. */
const CLOCK_SLACK_MS = 10 * 60_000;

export type DepositBank = "telebirr" | "cbe";
export const DEPOSIT_BANKS: DepositBank[] = ["telebirr", "cbe"];

/** What we need from one verify.et check. */
export type VerifyResult =
  | { state: "pending"; requestId: string }
  | {
      state: "verified";
      /** Santim. */
      amount: number;
      currency: string;
      senderName: string | null;
      /** Who the receipt says was paid; checked against DEPOSIT_RECEIVER_NAME when set. */
      receiverName?: string | null;
      /** The receipt's own status, "success" when the money moved. */
      itemStatus?: string | null;
      /** When the transfer was made (receipt timestamp), ms. */
      paidAt?: number | null;
      /** settlementAccountMatch.matched && !ambiguous */
      toUs: boolean;
      /** The match was ambiguous (several of our accounts fit the masked digits). */
      ambiguous?: boolean;
    }
  /** retry: a passing problem (bank slow, verify.et busy), worth asking again. */
  | { state: "failed"; reason: string; retry?: boolean; creditsOut?: boolean };

export interface VerifyEt {
  verify(input: { bank: DepositBank; reference: string; settlementAccount: string }): Promise<VerifyResult>;
  status(requestId: string): Promise<VerifyResult>;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- verify.et JSON */
function readResult(body: any): VerifyResult {
  // Two layouts. POST /api/verify answers with `verification` plus `data: [item]`;
  // GET /api/verify/:id (after a queued check) answers with `data: { processingStatus, verified, result: item }`.
  const status = Array.isArray(body?.data) ? undefined : body?.data;
  const v = body?.verification ?? status;
  const item = Array.isArray(body?.data) ? body.data[0] : (status?.result ?? status);
  const processing = v?.processingStatus;
  if (processing && processing !== "completed") {
    if (processing !== "failed" && processing !== "error") {
      return { state: "pending", requestId: String(v.requestId ?? body?.requestId ?? "") };
    }
  }
  if (!(v?.verified ?? item?.verified) || !item || processing === "failed" || processing === "error") {
    const reason = String(item?.message || v?.error?.message || (typeof v?.error === "string" ? v.error : "") || v?.message || body?.message || "transaction not found");
    console.warn("verify.et: not verified", JSON.stringify(body).slice(0, 2000));
    return { state: "failed", reason, retry: processing === "failed" || /too long|timed? ?out|try again/i.test(reason) };
  }
  const match = item.settlementAccountMatch;
  if (!match?.matched || match?.ambiguous) {
    // Logged so a rejected transfer that did reach us can be explained (receipts mask numbers).
    console.warn("verify.et: settlement account not matched", JSON.stringify({ match, receiver: item.receiverAccount ?? item.receiver ?? null }));
  }
  const paidAt = Date.parse(String(item.timestamp ?? item.transactionDate ?? item.date ?? ""));
  return {
    state: "verified",
    amount: Math.round(Number(item.amount) * BIRR),
    currency: String(item.currency ?? "ETB"),
    senderName: item.senderName ?? null,
    receiverName: item.receiverName ?? null,
    itemStatus: item.status == null ? null : String(item.status),
    paidAt: Number.isFinite(paidAt) ? paidAt : null,
    toUs: Boolean(match?.matched) && !match?.ambiguous,
    ambiguous: Boolean(match?.ambiguous),
  };
}

/** The real verify.et API. */
export function httpVerifyEt(apiKey: string, baseUrl = "https://verify.et"): VerifyEt {
  const headers = { "x-api-key": apiKey, "Content-Type": "application/json" };
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(baseUrl + path, { ...init, headers: { ...headers, ...init.headers } });
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 402) return { state: "failed", reason: "deposits are paused for now, try again later", creditsOut: true } as const;
    if (res.status === 429 || res.status === 503) return { state: "failed", reason: "verify.et is busy, try again shortly", retry: true } as const;
    if (!res.ok && res.status !== 202) {
      const reason = String(body?.message || `verify.et error ${res.status}`);
      return { state: "failed", reason, retry: res.status === 408 || res.status >= 500 || /too long|timed? ?out|try again/i.test(reason) } as const;
    }
    return readResult(body);
  };
  return {
    verify: ({ bank, reference, settlementAccount }) =>
      call("/api/verify?waitMs=8000", {
        method: "POST",
        // A fresh key per try, so a retry isn't answered from verify.et's cache of the
        // failed one. Crediting twice is prevented by our own `used` map, not this key.
        headers: { "Idempotency-Key": `${bank}:${reference}:${randomBytes(4).toString("hex")}` },
        body: JSON.stringify(
          bank === "telebirr"
            ? { bank, transactionNumber: reference, settlementAccount }
            : { bank, reference, settlementAccount },
        ),
      }),
    status: (requestId) => call(`/api/verify/${encodeURIComponent(requestId)}`),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** review: verified, but a moderator has to approve it (see the top of this file). */
export type DepositStatus = "checking" | "review" | "credited" | "rejected";

export interface Deposit {
  id: string;
  profileId: string;
  bank: DepositBank;
  reference: string;
  status: DepositStatus;
  amount: number | null;
  reason: string | null;
  createdAt: number;
  closedAt: number | null;
  /** The name the player said they pay from, and what the receipt says. */
  payerName?: string | null;
  senderName?: string | null;
  receiverName?: string | null;
  /** When the transfer was made, from the receipt. */
  paidAt?: number | null;
  /** While in review: the verified amount waiting for approval, and the alert message. */
  reviewAmount?: number | null;
  alertMessageId?: number | null;
  /** Telegram name of the moderator who approved or rejected it. */
  closedBy?: string | null;
}

interface DepositData {
  list: Deposit[];
  /** "bank:REFERENCE" → deposit id, for every reference credited, in review or being checked. */
  used: Record<string, string>;
  /** profileId → the name on the account they pay from. Fixed once a deposit is credited. */
  payers?: Record<string, { name: string; locked: boolean }>;
}

/** Telegram, for deposits a moderator has to look at. Same bot and chat as withdrawals. */
export interface ModeratorChat {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bot API JSON
  call(method: string, params: Record<string, unknown>): Promise<any>;
  chatId: string;
}

export interface DepositOptions {
  verifyEt: VerifyEt | null;
  /** Our receiving account per bank, e.g. a Telebirr phone number and a CBE account number. */
  accounts: Partial<Record<DepositBank, string>>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Tells the player how a deposit ended (pushed to their open tabs). */
  onUpdate?: (deposit: Deposit) => void;
  /** Our account holder's name as banks print it (DEPOSIT_RECEIVER_NAME); checked when set. */
  receiverName?: string | null;
  /** When the player's account was made; a transfer from before then isn't theirs to claim. */
  accountCreatedAt?: (profileId: string) => number | null;
  /** Where deposits needing a human go. Without it they wait in review (logged). */
  moderators?: ModeratorChat | null;
  nameOf?: (profileId: string) => string;
  limits?: Partial<typeof DEPOSIT_LIMITS>;
  /** The caller's IP for a socket (real client IP behind a proxy). */
  ipOf?: (socket: Socket) => string;
}

export function depositAccountsFromEnv(env: Record<string, string | undefined> = process.env): Partial<Record<DepositBank, string>> {
  const accounts: Partial<Record<DepositBank, string>> = {};
  if (env.DEPOSIT_TELEBIRR) accounts.telebirr = env.DEPOSIT_TELEBIRR.trim();
  if (env.DEPOSIT_CBE) accounts.cbe = env.DEPOSIT_CBE.trim();
  return accounts;
}

const refKey = (bank: DepositBank, reference: string) => `${bank}:${reference}`;

/** Lowercase name words, without punctuation; one-letter initials dropped. */
export function nameWords(name: unknown): string[] {
  if (typeof name !== "string") return [];
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Does the name on a receipt belong to `expected`? Banks print two or three
 * names (first, father's, grandfather's), so at least two of the expected
 * words must appear (both, if only two were given).
 */
export function namesMatch(expected: unknown, onReceipt: unknown): boolean {
  const want = nameWords(expected);
  const have = new Set(nameWords(onReceipt));
  if (want.length === 0 || have.size === 0) return false;
  const hits = want.filter((w) => have.has(w)).length;
  return hits >= Math.min(2, want.length);
}

const birr = (santim: number) => (santim / BIRR).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The transaction number from whatever the player pasted: the number itself,
 * a receipt link (telebirr: transactioninfo.ethiotelecom.et/receipt/<number>,
 * CBE: apps.cbe.com.et/?id=<FT reference><account digits>), or SMS text.
 */
export function parseReference(bank: DepositBank, raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  if (bank === "cbe") {
    const ft = text.toUpperCase().match(/FT[A-Z0-9]{10}/);
    if (ft) return ft[0];
  } else {
    const link = text.match(/receipt\/([A-Za-z0-9]{6,40})/i);
    if (link) return link[1].toUpperCase();
    const sms = text.match(/transaction number is\s*([A-Za-z0-9]{6,40})/i);
    if (sms) return sms[1].toUpperCase();
  }
  return text.toUpperCase();
}

export class Deposits {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onUpdate: (deposit: Deposit) => void;
  private readonly nameOf: (profileId: string) => string;
  private readonly accountLimit: RateLimiter;
  private readonly ipLimit: RateLimiter;
  /** Accounts with a check running now. */
  private readonly inFlight = new Set<string>();
  private creditsAlertAt = -Infinity;

  constructor(
    private readonly store: Store,
    private readonly wallet: Wallet,
    private readonly opts: DepositOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onUpdate = opts.onUpdate ?? (() => {});
    this.nameOf = opts.nameOf ?? ((id) => id);
    const limits = { ...DEPOSIT_LIMITS, ...opts.limits };
    this.accountLimit = new RateLimiter(limits.perAccount, limits.windowMs, this.now);
    this.ipLimit = new RateLimiter(limits.perIp, limits.windowMs, this.now);
  }

  /** Deposits need real mode, a verify.et key and somewhere to send money. */
  get enabled(): boolean {
    return this.wallet.mode === "real" && this.opts.verifyEt !== null && Object.keys(this.opts.accounts).length > 0;
  }

  /** Where players send money, for the deposit screen. Empty when deposits are off. */
  accounts(): { bank: DepositBank; account: string }[] {
    if (!this.enabled) return [];
    return DEPOSIT_BANKS.filter((b) => this.opts.accounts[b]).map((bank) => ({ bank, account: this.opts.accounts[bank]! }));
  }

  private data(): DepositData {
    return this.store.read<DepositData>(DEPOSITS, { list: [], used: {} });
  }

  /** The name this player pays from, and whether it can still be changed. */
  payer(profileId: string): { name: string; locked: boolean } | null {
    const p = this.data().payers ?? {};
    return Object.hasOwn(p, profileId) ? p[profileId] : null;
  }

  get(id: string): Deposit | null {
    return this.data().list.find((x) => x.id === id) ?? null;
  }

  history(profileId: string, limit = 20): Deposit[] {
    return this.data()
      .list.filter((x) => x.profileId === profileId)
      .slice(-limit)
      .reverse();
  }

  /**
   * Check a pasted reference and credit the wallet if it is a transfer to us.
   * Resolves once verify.et has answered (or given up queueing).
   */
  async submit(
    profileId: string,
    rawBank: unknown,
    rawReference: unknown,
    rawPayerName?: unknown,
    ip?: string,
  ): Promise<{ ok: true; deposit: Deposit } | { ok: false; reason: string }> {
    if (!this.enabled) return { ok: false, reason: "deposits are off" };
    const bank = DEPOSIT_BANKS.find((b) => b === rawBank);
    const account = bank && this.opts.accounts[bank];
    if (!bank || !account) return { ok: false, reason: "pick Telebirr or CBE" };
    const reference = parseReference(bank, rawReference);
    if (!/^[A-Z0-9-]{6,40}$/.test(reference)) return { ok: false, reason: "that doesn't look like a transaction number" };

    // Reserve the reference first, so two tabs can't credit the same transfer.
    const d = this.data();
    const key = refKey(bank, reference);
    if (d.used[key]) return { ok: false, reason: "this transaction was already used" };

    // Who the player pays from. Once a deposit is credited the name is fixed.
    d.payers ??= {};
    const saved = Object.hasOwn(d.payers, profileId) ? d.payers[profileId] : null;
    let payerName = saved?.name ?? "";
    if (!saved?.locked) {
      const typed = typeof rawPayerName === "string" ? rawPayerName.trim().replace(/\s+/g, " ").slice(0, 80) : "";
      if (typed) payerName = typed;
      if (nameWords(payerName).length < 2) return { ok: false, reason: "enter the full name on the account you pay from" };
      d.payers[profileId] = { name: payerName, locked: false };
    }

    // Every check below spends verify.et credits: one at a time, and only so many an hour.
    if (this.inFlight.has(profileId)) return { ok: false, reason: "a deposit is already being checked, wait for it to finish" };
    if (!this.accountLimit.take(profileId) || (ip !== undefined && !this.ipLimit.take(ip))) {
      console.warn(`deposit rate limit hit by ${profileId} from ${ip ?? "?"}`);
      return { ok: false, reason: "too many deposit checks, try again in an hour" };
    }
    this.inFlight.add(profileId);
    const deposit: Deposit = {
      id: randomBytes(8).toString("hex"),
      profileId,
      bank,
      reference,
      status: "checking",
      amount: null,
      reason: null,
      createdAt: this.now(),
      closedAt: null,
      payerName,
    };
    d.used[key] = deposit.id;
    d.list.push(deposit);
    this.store.write(DEPOSITS, d);

    let result: VerifyResult;
    try {
      for (let attempt = 0; ; attempt++) {
        result = await this.opts.verifyEt!.verify({ bank, reference, settlementAccount: account });
        for (let i = 0; result.state === "pending" && i < POLL_TRIES; i++) {
          await this.sleep(POLL_MS);
          result = await this.opts.verifyEt!.status(result.requestId);
        }
        if (result.state !== "failed" || !result.retry || attempt >= RETRIES) break;
        await this.sleep(RETRY_MS);
      }
    } catch {
      result = { state: "failed", reason: "couldn't reach verify.et, try again shortly" };
    } finally {
      this.inFlight.delete(profileId);
    }
    if (result.state === "failed" && result.creditsOut) await this.creditsOut();
    return { ok: true, deposit: await this.close(deposit.id, result) };
  }

  /** verify.et answered 402: no credits left. Tell the moderators (at most hourly). */
  private async creditsOut() {
    const now = this.now();
    if (now - this.creditsAlertAt < CREDITS_ALERT_EVERY_MS) return;
    this.creditsAlertAt = now;
    const text = "⚠️ verify.et credits are used up (HTTP 402). Deposits can't be checked until the plan is topped up or the month resets.";
    console.error(text);
    const mods = this.opts.moderators;
    if (mods) await mods.call("sendMessage", { chat_id: mods.chatId, text }).catch((err) => console.warn("telegram alert failed", err));
  }

  /** Why a verified transfer to us can't be credited without a human, or null. */
  private doubt(deposit: Deposit, r: Extract<VerifyResult, { state: "verified" }>): string | null {
    if (r.ambiguous) return "the receipt matches more than one of our accounts";
    if (!r.toUs) return "the receipt doesn't show it was paid to our account";
    if (this.opts.receiverName && r.receiverName && !namesMatch(this.opts.receiverName, r.receiverName)) {
      return `it was paid to "${r.receiverName}", not our account name`;
    }
    if (!r.senderName) return "the receipt doesn't show who sent it";
    if (!namesMatch(deposit.payerName, r.senderName)) return `the sender "${r.senderName}" isn't the name you pay from`;
    if (r.paidAt == null) return "the receipt doesn't show when it was sent";
    if (r.paidAt < this.now() - MAX_TRANSFER_AGE_MS) return "the transfer is more than a day old";
    return null;
  }

  private async close(id: string, result: VerifyResult): Promise<Deposit> {
    const d = this.data();
    const deposit = d.list.find((x) => x.id === id)!;
    const reject = (reason: string, freeReference: boolean) => {
      deposit.status = "rejected";
      deposit.reason = reason;
      // A transfer that isn't found yet (or verify.et was down) can be tried again;
      // one that was found but is too small or not birr stays used.
      if (freeReference) delete d.used[refKey(deposit.bank, deposit.reference)];
    };
    let review: string | null = null;
    if (result.state === "verified") {
      deposit.senderName = result.senderName;
      deposit.receiverName = result.receiverName ?? null;
      deposit.paidAt = result.paidAt ?? null;
    }
    const createdAt = this.opts.accountCreatedAt?.(deposit.profileId) ?? null;
    if (result.state === "pending") reject("verify.et is still checking, try again in a few minutes", true);
    else if (result.state === "failed") reject(result.reason, true);
    else if (result.itemStatus && result.itemStatus.toLowerCase() !== "success") {
      reject(`the transfer isn't complete (${result.itemStatus}), try again once it is`, true);
    } else if (result.currency !== "ETB") reject("only birr transfers count", false);
    else if (result.amount < MIN_DEPOSIT) reject(`the smallest deposit is ${MIN_DEPOSIT / BIRR} birr`, false);
    // Made before this account existed: someone else's transfer. Free it for its owner.
    else if (result.paidAt != null && createdAt != null && result.paidAt < createdAt - CLOCK_SLACK_MS) {
      reject("this transfer was made before your account existed", true);
    } else if ((review = this.doubt(deposit, result))) {
      deposit.status = "review";
      deposit.reason = `A moderator will check this transfer: ${review}.`;
      deposit.reviewAmount = result.amount;
    } else this.credit(d, deposit, result.amount);
    if (deposit.status !== "review") deposit.closedAt = this.now();
    this.store.write(DEPOSITS, d);
    if (deposit.status === "review") await this.alert(deposit, review!);
    this.onUpdate(deposit);
    return this.get(id) ?? deposit;
  }

  /** Credit the wallet and fix the payer name. Caller saves `d`. */
  private credit(d: DepositData, deposit: Deposit, amount: number) {
    const credited = this.wallet.deposit(deposit.profileId, amount, deposit.id);
    if (!credited.ok) {
      deposit.status = "rejected";
      deposit.reason = credited.reason;
      delete d.used[refKey(deposit.bank, deposit.reference)];
      return;
    }
    deposit.status = "credited";
    deposit.amount = amount;
    deposit.reason = null;
    if (deposit.payerName) (d.payers ??= {})[deposit.profileId] = { name: deposit.payerName, locked: true };
  }

  private alertText(x: Deposit, why?: string) {
    const lines = [
      `📥 Deposit ${x.id} needs a check`,
      `Player: ${this.nameOf(x.profileId)}`,
      `${x.bank === "cbe" ? "CBE" : "Telebirr"} ref ${x.reference} · ${birr(x.reviewAmount ?? x.amount ?? 0)} birr`,
      `Says they pay from: ${x.payerName ?? "?"}`,
      `Receipt sender: ${x.senderName ?? "?"} · paid to: ${x.receiverName ?? "?"}`,
      `Sent: ${x.paidAt ? new Date(x.paidAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "?"}`,
    ];
    if (why) lines.push(`Why: ${why}`);
    if (x.status === "credited") lines.push(`✅ Approved by ${x.closedBy} · credited`);
    else if (x.status === "rejected") lines.push(`❌ Rejected by ${x.closedBy} · reference freed`);
    else lines.push("", "Approve only if this money reached our account from this player.");
    return lines.join("\n");
  }

  private async alert(x: Deposit, why: string) {
    const mods = this.opts.moderators;
    if (!mods) {
      console.warn(`deposit ${x.id} needs review (no Telegram moderators set up): ${why}`);
      return;
    }
    try {
      const msg = await mods.call("sendMessage", {
        chat_id: mods.chatId,
        text: this.alertText(x, why),
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `dep-ok:${x.id}` },
              { text: "❌ Reject", callback_data: `dep-no:${x.id}` },
            ],
          ],
        },
      });
      const d = this.data();
      const saved = d.list.find((y) => y.id === x.id);
      if (saved && msg?.message_id) {
        saved.alertMessageId = msg.message_id;
        this.store.write(DEPOSITS, d);
      }
    } catch (err) {
      console.warn(`deposit ${x.id}: telegram alert failed`, err);
    }
  }

  /** A moderator approves (credits) or rejects (frees the reference) a deposit in review. */
  resolve(id: string, approve: boolean, by: string): Deposit | null {
    const d = this.data();
    const x = d.list.find((y) => y.id === id);
    if (!x || x.status !== "review") return null;
    if (approve) this.credit(d, x, x.reviewAmount ?? 0);
    else {
      x.status = "rejected";
      x.reason = "A moderator couldn't match this transfer to you.";
      delete d.used[refKey(x.bank, x.reference)];
    }
    x.closedBy = by;
    x.closedAt = this.now();
    this.store.write(DEPOSITS, d);
    this.onUpdate(x);
    return x;
  }

  /** Telegram updates from the moderators' chat (forwarded by the withdrawals bot). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bot API JSON
  async handleUpdate(update: any): Promise<void> {
    const mods = this.opts.moderators;
    const cb = update?.callback_query;
    if (!mods || !cb) return;
    if (String(cb.message?.chat?.id ?? "") !== String(mods.chatId)) return;
    const [action, id] = String(cb.data ?? "").split(":");
    if (action !== "dep-ok" && action !== "dep-no") return;
    const who = cb.from?.username ? `@${cb.from.username}` : (cb.from?.first_name ?? "a moderator");
    await mods.call("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => {});
    const x = this.resolve(id, action === "dep-ok", who);
    if (x?.alertMessageId) {
      await mods
        .call("editMessageText", { chat_id: mods.chatId, message_id: x.alertMessageId, text: this.alertText(x), reply_markup: { inline_keyboard: [] } })
        .catch(() => {});
    }
  }

  /** wallet:deposit { bank, reference, payerName } over the signed-in socket. */
  attach(socket: Socket, profileId: string) {
    socket.on("wallet:deposit", async (msg: { bank?: unknown; reference?: unknown; payerName?: unknown }, ack?: (res: unknown) => void) => {
      const ip = this.opts.ipOf ? this.opts.ipOf(socket) : socket.handshake.address;
      const res = await this.submit(profileId, msg?.bank, msg?.reference, msg?.payerName, ip);
      if (typeof ack === "function") ack(res);
    });
  }
}
