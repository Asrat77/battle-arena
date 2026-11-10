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

import { randomBytes } from "node:crypto";
import type { Socket } from "socket.io";
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
      /** settlementAccountMatch.matched && !ambiguous */
      toUs: boolean;
    }
  /** retry: a passing problem (bank slow, verify.et busy), worth asking again. */
  | { state: "failed"; reason: string; retry?: boolean };

export interface VerifyEt {
  verify(input: { bank: DepositBank; reference: string; settlementAccount: string }): Promise<VerifyResult>;
  status(requestId: string): Promise<VerifyResult>;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- verify.et JSON */
function readResult(body: any): VerifyResult {
  const v = body?.verification;
  const item = Array.isArray(body?.data) ? body.data[0] : body?.data;
  if (v?.processingStatus && v.processingStatus !== "completed") {
    return { state: "pending", requestId: String(v.requestId ?? body?.requestId ?? "") };
  }
  if (!(v?.verified ?? item?.verified) || !item) {
    const reason = String(body?.message || "transaction not found");
    return { state: "failed", reason, retry: /too long|timed? ?out|try again/i.test(reason) };
  }
  const match = item.settlementAccountMatch;
  if (!match?.matched || match?.ambiguous) {
    // Logged so a rejected transfer that did reach us can be explained (receipts mask numbers).
    console.warn("verify.et: settlement account not matched", JSON.stringify({ match, receiver: item.receiverAccount ?? item.receiver ?? null }));
  }
  return {
    state: "verified",
    amount: Math.round(Number(item.amount) * BIRR),
    currency: String(item.currency ?? "ETB"),
    senderName: item.senderName ?? null,
    toUs: Boolean(match?.matched) && !match?.ambiguous,
  };
}

/** The real verify.et API. */
export function httpVerifyEt(apiKey: string, baseUrl = "https://verify.et"): VerifyEt {
  const headers = { "x-api-key": apiKey, "Content-Type": "application/json" };
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(baseUrl + path, { ...init, headers: { ...headers, ...init.headers } });
    const body: any = await res.json().catch(() => ({}));
    if (res.status === 402) return { state: "failed", reason: "verification credits used up" } as const;
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

export type DepositStatus = "checking" | "credited" | "rejected";

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
}

interface DepositData {
  list: Deposit[];
  /** "bank:REFERENCE" → deposit id, for every reference ever credited or being checked. */
  used: Record<string, string>;
}

export interface DepositOptions {
  verifyEt: VerifyEt | null;
  /** Our receiving account per bank, e.g. a Telebirr phone number and a CBE account number. */
  accounts: Partial<Record<DepositBank, string>>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Tells the player how a deposit ended (pushed to their open tabs). */
  onUpdate?: (deposit: Deposit) => void;
}

export function depositAccountsFromEnv(env: Record<string, string | undefined> = process.env): Partial<Record<DepositBank, string>> {
  const accounts: Partial<Record<DepositBank, string>> = {};
  if (env.DEPOSIT_TELEBIRR) accounts.telebirr = env.DEPOSIT_TELEBIRR.trim();
  if (env.DEPOSIT_CBE) accounts.cbe = env.DEPOSIT_CBE.trim();
  return accounts;
}

const refKey = (bank: DepositBank, reference: string) => `${bank}:${reference}`;

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

  constructor(
    private readonly store: Store,
    private readonly wallet: Wallet,
    private readonly opts: DepositOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onUpdate = opts.onUpdate ?? (() => {});
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
  async submit(profileId: string, rawBank: unknown, rawReference: unknown): Promise<{ ok: true; deposit: Deposit } | { ok: false; reason: string }> {
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
    }
    return { ok: true, deposit: this.close(deposit.id, result) };
  }

  private close(id: string, result: VerifyResult): Deposit {
    const d = this.data();
    const deposit = d.list.find((x) => x.id === id)!;
    const reject = (reason: string, freeReference: boolean) => {
      deposit.status = "rejected";
      deposit.reason = reason;
      // A transfer that isn't found yet (or verify.et was down) can be tried again;
      // one that was found but isn't ours, or is too small, stays used.
      if (freeReference) delete d.used[refKey(deposit.bank, deposit.reference)];
    };
    if (result.state === "pending") reject("verify.et is still checking, try again in a few minutes", true);
    else if (result.state === "failed") reject(result.reason, true);
    else if (!result.toUs) reject("this transfer wasn't paid to our account", false);
    else if (result.currency !== "ETB") reject("only birr transfers count", false);
    else if (result.amount < MIN_DEPOSIT) reject(`the smallest deposit is ${MIN_DEPOSIT / BIRR} birr`, false);
    else {
      const credited = this.wallet.deposit(deposit.profileId, result.amount, deposit.id);
      if (credited.ok) {
        deposit.status = "credited";
        deposit.amount = result.amount;
      } else reject(credited.reason, true);
    }
    deposit.closedAt = this.now();
    this.store.write(DEPOSITS, d);
    this.onUpdate(deposit);
    return deposit;
  }

  /** wallet:deposit { bank, reference } over the signed-in socket. */
  attach(socket: Socket, profileId: string) {
    socket.on("wallet:deposit", async (msg: { bank?: unknown; reference?: unknown }, ack?: (res: unknown) => void) => {
      const res = await this.submit(profileId, msg?.bank, msg?.reference);
      if (typeof ack === "function") ack(res);
    });
  }
}
