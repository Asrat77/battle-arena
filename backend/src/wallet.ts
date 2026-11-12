// Wallets for staked matches. Each profile has a balance; a staked match holds
// both players' stakes in escrow until the result is in, then pays the pot to
// the winner (minus the platform fee), or refunds both on a draw or abort.
//
// Amounts are whole santim (1 birr = 100 santim) so nothing is ever rounded
// by floating point. Every balance change is a transaction in the history.
//
// WALLET_MODE=play (the default) uses play money only: players top up from a
// free daily faucet and nothing is ever worth real birr. Real deposits and
// withdrawals need WALLET_MODE=real *and* REAL_MONEY_LEGAL_OK=1 (audit C3).
//
// Play and real money are two separate books (store keys wallet:play and
// wallet:real), so flipping WALLET_MODE never turns faucet birr into
// withdrawable birr (audit H6). Deposits, withdrawals and their refunds always
// touch the real book; stakes and the faucet use the book of the current mode.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Socket } from "socket.io";
import type { Outcome } from "../../engine/types";
import { bearerToken, type Identity } from "./identity";
import { own, profileIdFrom } from "./safe";
import type { Store } from "./store";
import { MemoryTxnLog, type TxnLog, verifyChain } from "./walletLog";

/** Before the split (audit H6) both kinds of money shared this one key. */
const LEGACY = "wallet";
const BOOKS: Record<WalletMode, string> = { play: "wallet:play", real: "wallet:real" };
/** What real money the old shared book held, kept for a manual check after the split. */
export const LEGACY_REPORT = "walletLegacyReport";
/** Fees collect here. Not a profile, so nobody can spend it. */
export const PLATFORM_ACCOUNT = "platform";

export const BIRR = 100;
export const DEFAULTS = {
  /** Platform fee on the pot, in basis points (1000 = 10%). */
  feeBps: 1_000,
  minStake: 10 * BIRR,
  maxStake: 500 * BIRR,
  /** Play-money top-up, once per faucet window. */
  faucetAmount: 500 * BIRR,
  faucetWindowMs: 24 * 60 * 60 * 1000,
};

export type WalletMode = "play" | "real";

export type TxnKind = "faucet" | "deposit" | "withdrawal" | "withdrawal-refund" | "hold" | "release" | "win" | "fee" | "adjust";

/**
 * Game transactions: the store keeps only the newest HOT_TXNS of these per profile
 * (audit L2); the full history is in the wallet log. Money in or out of the
 * platform (deposit, withdrawal, refund, adjust) is always kept, because restart
 * recovery looks those up.
 */
const GAME_KINDS: ReadonlySet<TxnKind> = new Set(["faucet", "hold", "release", "win", "fee"]);
export const HOT_TXNS = 200;

export interface Txn {
  id: string;
  profileId: string;
  kind: TxnKind;
  /** Positive adds to the balance, negative takes from it. */
  amount: number;
  balance: number;
  /** Escrow id for hold/release/win/fee. */
  ref: string | null;
  ts: number;
  /** Manual adjustments: why, and who made it. */
  note?: string;
  by?: string;
}

export type EscrowStatus = "held" | "settled" | "refunded";

export interface Escrow {
  id: string;
  players: [string, string];
  stake: number;
  feeBps: number;
  matchId: string | null;
  status: EscrowStatus;
  createdAt: number;
  closedAt: number | null;
  /** Seat paid on a win; null on a draw or refund. */
  winner: 0 | 1 | null;
}

interface WalletData {
  balances: Record<string, number>;
  txns: Txn[];
  escrows: Record<string, Escrow>;
  lastFaucet: Record<string, number>;
}

export interface WalletOptions {
  mode?: WalletMode;
  now?: () => number;
  feeBps?: number;
  minStake?: number;
  maxStake?: number;
  faucetAmount?: number;
  faucetWindowMs?: number;
  /** Called after a profile's balance changes (to push it to their open tabs). */
  onChange?: (profileId: string, balance: number) => void;
  /** Append-only record of every change (audit M1). Default: in memory only. */
  log?: TxnLog;
  /** Game transactions kept per profile in the store. Default HOT_TXNS. */
  hotTxns?: number;
}

type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

export class Wallet {
  readonly mode: WalletMode;
  readonly feeBps: number;
  readonly minStake: number;
  readonly maxStake: number;
  readonly faucetAmount: number;
  readonly faucetWindowMs: number;
  private readonly now: () => number;
  private readonly onChange: (profileId: string, balance: number) => void;
  private readonly log: TxnLog;
  private readonly hotTxns: number;
  /** Transactions made by the change being saved; logged once the store has them. */
  private pending: { book: WalletMode; txn: Txn }[] = [];
  /** Where players can send real money; set by Deposits when deposits are on. */
  depositAccounts: () => { bank: string; account: string }[] = () => [];
  /** The name this player pays deposits from (locked once one is credited); set by Deposits. */
  depositPayer: (profileId: string) => { name: string; locked: boolean } | null = () => null;
  /** Withdrawal settings and this player's requests; set by Withdrawals when withdrawals are on. */
  withdrawals: (profileId: string) => { enabled: boolean; minAmount: number; maxAmount?: number; requests: unknown[] } = () => ({
    enabled: false,
    minAmount: 0,
    requests: [],
  });

  constructor(
    private readonly store: Store,
    opts: WalletOptions = {},
  ) {
    this.mode = opts.mode ?? "play";
    this.now = opts.now ?? Date.now;
    this.feeBps = opts.feeBps ?? DEFAULTS.feeBps;
    this.minStake = opts.minStake ?? DEFAULTS.minStake;
    this.maxStake = opts.maxStake ?? DEFAULTS.maxStake;
    this.faucetAmount = opts.faucetAmount ?? DEFAULTS.faucetAmount;
    this.faucetWindowMs = opts.faucetWindowMs ?? DEFAULTS.faucetWindowMs;
    this.onChange = opts.onChange ?? (() => {});
    this.log = opts.log ?? new MemoryTxnLog();
    this.hotTxns = opts.hotTxns ?? HOT_TXNS;
    this.migrate();
    // A new log starts from today's balances; reconcile() replays from there.
    if (this.log.empty()) {
      for (const book of ["play", "real"] as const) this.log.append({ type: "open", book, balances: { ...this.data(book).balances } }, this.now());
    }
  }

  /**
   * The old single book becomes the play book: it mixed faucet birr with real
   * deposits, so none of it may become withdrawable. Real money it held is
   * listed under LEGACY_REPORT (and logged) for a manual refund. Escrows still
   * held in it are refunded on boot like any other (refundAllHeld covers both books).
   */
  private migrate() {
    const legacy = this.store.read<WalletData | null>(LEGACY, null);
    if (!legacy) return;
    if (this.store.read<WalletData | null>(BOOKS.play, null) === null) {
      const real: Record<string, { deposited: number; withdrawn: number; refunded: number; balance: number }> = {};
      for (const t of legacy.txns) {
        if (t.kind !== "deposit" && t.kind !== "withdrawal" && t.kind !== "withdrawal-refund") continue;
        const r = (real[t.profileId] ??= { deposited: 0, withdrawn: 0, refunded: 0, balance: 0 });
        if (t.kind === "deposit") r.deposited += t.amount;
        else if (t.kind === "withdrawal") r.withdrawn -= t.amount;
        else r.refunded += t.amount;
      }
      for (const [id, r] of Object.entries(real)) r.balance = own(legacy.balances, id) ?? 0;
      this.store.write(BOOKS.play, legacy);
      if (Object.keys(real).length > 0) {
        this.store.write(LEGACY_REPORT, { migratedAt: this.now(), profiles: real });
        console.warn(`wallet: old shared book moved to play money; ${Object.keys(real).length} profile(s) had real deposits, see ${LEGACY_REPORT}`);
      }
    }
    this.store.remove(LEGACY);
  }

  /** Which book a data object came from, so move() can log it under the right one. */
  private readonly bookOf = new WeakMap<WalletData, WalletMode>();

  private data(mode: WalletMode = this.mode): WalletData {
    const d = this.store.read<WalletData>(BOOKS[mode], { balances: {}, txns: [], escrows: {}, lastFaucet: {} });
    this.bookOf.set(d, mode);
    return d;
  }

  /** The book that holds this escrow, current mode first. */
  private findEscrow(id: string): { mode: WalletMode; d: WalletData; e: Escrow } | null {
    for (const mode of this.modes()) {
      const d = this.data(mode);
      const e = own(d.escrows, id);
      if (e) return { mode, d, e };
    }
    return null;
  }

  private modes(): WalletMode[] {
    return this.mode === "real" ? ["real", "play"] : ["play", "real"];
  }

  balanceOf(profileId: string): number {
    return own(this.data().balances, profileId) ?? 0;
  }

  /** Newest first. */
  history(profileId: string, limit = 50): Txn[] {
    return this.data()
      .txns.filter((t) => t.profileId === profileId)
      .slice(-limit)
      .reverse();
  }

  escrow(id: string): Escrow | null {
    return this.findEscrow(id)?.e ?? null;
  }

  escrowForMatch(matchId: string): Escrow | null {
    for (const mode of this.modes()) {
      const e = Object.values(this.data(mode).escrows).find((x) => x.matchId === matchId);
      if (e) return e;
    }
    return null;
  }

  /** Is this stake allowed, before anyone's balance is looked at? */
  checkStake(stake: unknown): string | null {
    if (typeof stake !== "number" || !Number.isInteger(stake)) return "stake must be a whole number of santim";
    if (stake < this.minStake || stake > this.maxStake) {
      return `stake must be between ${this.minStake / BIRR} and ${this.maxStake / BIRR} birr`;
    }
    return null;
  }

  /** When the faucet can next be used, or null if it can be used now. */
  faucetReadyAt(profileId: string): number | null {
    const last = this.data().lastFaucet[profileId];
    if (last === undefined) return null;
    const next = last + this.faucetWindowMs;
    return next > this.now() ? next : null;
  }

  /** Play-money top-up. Off in real mode. */
  faucet(profileId: string): Result<{ balance: number }> {
    if (this.mode !== "play") return { ok: false, reason: "play money is off" };
    const readyAt = this.faucetReadyAt(profileId);
    if (readyAt !== null) return { ok: false, reason: "already topped up today" };
    const d = this.data();
    d.lastFaucet[profileId] = this.now();
    this.move(d, profileId, this.faucetAmount, "faucet", null);
    this.save(d, this.mode, [profileId]);
    return { ok: true, balance: d.balances[profileId] };
  }

  /**
   * Take the stake from both players into a new escrow. Either both are held
   * or neither is. Bind the escrow to its match with `bind` once it exists.
   */
  hold(players: [string, string], stake: number): Result<{ escrow: Escrow }> {
    const bad = this.checkStake(stake);
    if (bad) return { ok: false, reason: bad };
    if (players[0] === players[1]) return { ok: false, reason: "players must differ" };
    const d = this.data();
    const short = players.find((p) => (d.balances[p] ?? 0) < stake);
    if (short) return { ok: false, reason: short === players[0] ? "insufficient balance" : "opponent has insufficient balance" };
    const escrow: Escrow = {
      id: randomBytes(8).toString("hex"),
      players,
      stake,
      feeBps: this.feeBps,
      matchId: null,
      status: "held",
      createdAt: this.now(),
      closedAt: null,
      winner: null,
    };
    d.escrows[escrow.id] = escrow;
    for (const p of players) this.move(d, p, -stake, "hold", escrow.id);
    this.save(d, this.mode, players);
    return { ok: true, escrow };
  }

  bind(escrowId: string, matchId: string): void {
    const found = this.findEscrow(escrowId);
    if (!found || found.e.status !== "held") return;
    found.e.matchId = matchId;
    this.store.write(BOOKS[found.mode], found.d);
  }

  /** What the winner takes home from a pot of two stakes. */
  payout(stake: number, feeBps = this.feeBps): { prize: number; fee: number } {
    const pot = stake * 2;
    const fee = Math.floor((pot * feeBps) / 10_000);
    return { prize: pot - fee, fee };
  }

  /** Pay out a finished match. A draw refunds both stakes with no fee. */
  settle(escrowId: string, outcome: Pick<Outcome, "winner" | "draw">): Escrow | null {
    const found = this.findEscrow(escrowId);
    if (!found || found.e.status !== "held") return null;
    const { mode, d, e } = found;
    if (outcome.draw || outcome.winner === null) return this.refundIn(mode, d, e);
    const winner = e.players[outcome.winner];
    const { prize, fee } = this.payout(e.stake, e.feeBps);
    this.move(d, winner, prize, "win", e.id);
    if (fee > 0) this.move(d, PLATFORM_ACCOUNT, fee, "fee", e.id);
    e.status = "settled";
    e.winner = outcome.winner;
    e.closedAt = this.now();
    this.save(d, mode, [winner]);
    return e;
  }

  /** Give both stakes back (match never started, aborted, or a draw). */
  refund(escrowId: string): Escrow | null {
    const found = this.findEscrow(escrowId);
    if (!found || found.e.status !== "held") return null;
    return this.refundIn(found.mode, found.d, found.e);
  }

  /**
   * Refund every escrow still held, except those whose match was resumed after a
   * restart (`resumed` match ids). Anything else held at boot belongs to a match that
   * died with the old process.
   */
  refundAllHeld(resumed: ReadonlySet<string> = new Set()): Escrow[] {
    return this.modes().flatMap((mode) => {
      const d = this.data(mode);
      return Object.values(d.escrows)
        .filter((e) => e.status === "held" && !(e.matchId && resumed.has(e.matchId)))
        .map((e) => this.refundIn(mode, d, e));
    });
  }

  private refundIn(mode: WalletMode, d: WalletData, e: Escrow): Escrow {
    for (const p of e.players) this.move(d, p, e.stake, "release", e.id);
    e.status = "refunded";
    e.closedAt = this.now();
    this.save(d, mode, e.players);
    return e;
  }

  /** Add verified real money (a deposit). Real mode only; `ref` is the deposit id. */
  deposit(profileId: string, amount: number, ref: string): Result<{ balance: number }> {
    if (this.mode !== "real") return { ok: false, reason: "real money is off" };
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: "bad amount" };
    const d = this.data("real");
    this.move(d, profileId, amount, "deposit", ref);
    this.save(d, "real", [profileId]);
    return { ok: true, balance: d.balances[profileId] };
  }

  /** The credit for deposit `ref`, if the wallet has one (used after a restart). */
  depositTxn(ref: string): Txn | null {
    return this.txnFor("deposit", ref);
  }

  /**
   * The first transaction of this kind for `ref`, if any (used after a restart).
   * Looks in the real book, then the play book (money moved before the split lives there).
   */
  txnFor(kind: TxnKind, ref: string): Txn | null {
    for (const mode of ["real", "play"] as const) {
      const t = this.data(mode).txns.find((x) => x.kind === kind && x.ref === ref);
      if (t) return t;
    }
    return null;
  }

  /** Take money out for a withdrawal request (refunded if moderators reject it). Real mode only. */
  withdraw(profileId: string, amount: number, ref: string): Result<{ balance: number }> {
    if (this.mode !== "real") return { ok: false, reason: "real money is off" };
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: "bad amount" };
    const d = this.data("real");
    if ((d.balances[profileId] ?? 0) < amount) return { ok: false, reason: "insufficient balance" };
    this.move(d, profileId, -amount, "withdrawal", ref);
    this.save(d, "real", [profileId]);
    return { ok: true, balance: d.balances[profileId] };
  }

  /** Give back a withdrawal that moderators rejected. Always real money, whatever the mode now. */
  refundWithdrawal(profileId: string, amount: number, ref: string) {
    const d = this.data("real");
    this.move(d, profileId, amount, "withdrawal-refund", ref);
    this.save(d, "real", [profileId]);
  }

  private move(d: WalletData, profileId: string, amount: number, kind: TxnKind, ref: string | null, extra: Pick<Txn, "note" | "by"> = {}) {
    const balance = (d.balances[profileId] ?? 0) + amount;
    if (balance < 0) {
      this.pending = [];
      throw new Error(`wallet ${profileId} would go negative`);
    }
    d.balances[profileId] = balance;
    const txn: Txn = { id: randomBytes(6).toString("hex"), profileId, kind, amount, balance, ref, ts: this.now(), ...extra };
    d.txns.push(txn);
    this.pending.push({ book: this.bookOf.get(d) ?? this.mode, txn });
  }

  /** Drop all but the newest `hotTxns` game transactions of each profile just touched. */
  private trim(d: WalletData, profiles: Set<string>) {
    const count = new Map<string, number>();
    for (const t of d.txns) if (profiles.has(t.profileId) && GAME_KINDS.has(t.kind)) count.set(t.profileId, (count.get(t.profileId) ?? 0) + 1);
    const drop = new Map<string, number>();
    for (const [p, n] of count) if (n > this.hotTxns) drop.set(p, n - this.hotTxns);
    if (drop.size === 0) return;
    d.txns = d.txns.filter((t) => {
      const left = drop.get(t.profileId);
      if (!left || !GAME_KINDS.has(t.kind)) return true;
      drop.set(t.profileId, left - 1);
      return false;
    });
  }

  private save(d: WalletData, mode: WalletMode, changed: string[]) {
    const made = this.pending;
    this.pending = [];
    this.trim(d, new Set(made.map((m) => m.txn.profileId)));
    // Throws (and the store rolls back) if the write fails: then nothing is logged.
    this.store.write(BOOKS[mode], d);
    for (const m of made) {
      try {
        this.log.append({ type: "txn", book: m.book, txn: m.txn }, m.txn.ts);
      } catch (err) {
        // Saved but not logged: reconcile() will show this balance as off.
        console.error(`wallet log: could not record txn ${m.txn.id}`, err);
      }
    }
    // Open tabs show the current mode's balance only.
    if (mode !== this.mode) return;
    for (const p of new Set(changed)) if (p !== PLATFORM_ACCOUNT) this.onChange(p, d.balances[p] ?? 0);
  }

  /**
   * A manual credit (positive) or debit (negative), with the reason and who made
   * it in the log. Also how platform fees are taken out (profileId = "platform").
   */
  adjust(book: WalletMode, profileId: string, amount: number, note: string, by: string): Result<{ balance: number; txn: Txn }> {
    if (book !== "play" && book !== "real") return { ok: false, reason: "book must be play or real" };
    if (profileId !== PLATFORM_ACCOUNT && profileIdFrom(profileId) !== profileId) return { ok: false, reason: "bad profile id" };
    if (!Number.isInteger(amount) || amount === 0) return { ok: false, reason: "amount must be a whole, non-zero number of santim" };
    if (typeof note !== "string" || note.trim().length < 3) return { ok: false, reason: "give a reason" };
    const d = this.data(book);
    if ((own(d.balances, profileId) ?? 0) + amount < 0) return { ok: false, reason: "balance would go negative" };
    this.move(d, profileId, amount, "adjust", null, { note: note.trim().slice(0, 500), by });
    this.save(d, book, [profileId]);
    return { ok: true, balance: d.balances[profileId], txn: d.txns[d.txns.length - 1] };
  }

  /**
   * Replay the log and compare it with the stored balances (audit M1). Lists
   * every profile whose stored balance differs from the log, escrows whose money
   * doesn't add up, and where the chain is broken.
   */
  reconcile() {
    const entries = this.log.entries();
    const broken = verifyChain(entries);
    const books = (["play", "real"] as const).map((book) => {
      const expected: Record<string, number> = {};
      const escrowFlow: Record<string, number> = {};
      let txns = 0;
      for (const e of entries) {
        if (e.book !== book) continue;
        if (e.type === "open") {
          for (const k of Object.keys(expected)) delete expected[k];
          Object.assign(expected, e.balances);
          continue;
        }
        txns++;
        const t = e.txn;
        expected[t.profileId] = (expected[t.profileId] ?? 0) + t.amount;
        if (t.ref && (t.kind === "hold" || t.kind === "release" || t.kind === "win" || t.kind === "fee")) {
          escrowFlow[t.ref] = (escrowFlow[t.ref] ?? 0) + t.amount;
        }
      }
      const d = this.data(book);
      const mismatches: { profileId: string; stored: number; logged: number }[] = [];
      for (const id of new Set([...Object.keys(expected), ...Object.keys(d.balances)])) {
        const stored = own(d.balances, id) ?? 0;
        const logged = own(expected, id) ?? 0;
        if (stored !== logged) mismatches.push({ profileId: id, stored, logged });
      }
      // A held escrow has taken both stakes; a closed one has paid all of it back out.
      const escrows: { id: string; status: EscrowStatus; off: number }[] = [];
      let held = 0;
      for (const e of Object.values(d.escrows)) {
        const flow = escrowFlow[e.id];
        if (flow === undefined) continue; // made before the log started
        const want = e.status === "held" ? -2 * e.stake : 0;
        if (e.status === "held") held += 2 * e.stake;
        if (flow !== want) escrows.push({ id: e.id, status: e.status, off: flow - want });
      }
      const total = Object.values(d.balances).reduce((a, b) => a + b, 0);
      return { book, ok: mismatches.length === 0 && escrows.length === 0, txns, total, held, mismatches, escrows };
    });
    return { ok: !broken && books.every((b) => b.ok), entries: entries.length, chain: broken ?? "intact", books };
  }

  /** Platform fees: balance, what came in per day, and what was taken out (audit L1). */
  feeReport(book: WalletMode = this.mode, days = 30) {
    const since = this.now() - days * 24 * 60 * 60 * 1000;
    const byDay: Record<string, { fees: number; matches: number }> = {};
    let collected = 0;
    const takenOut: { amount: number; note?: string; by?: string; ts: number }[] = [];
    for (const e of this.log.entries()) {
      if (e.type !== "txn" || e.book !== book || e.txn.profileId !== PLATFORM_ACCOUNT) continue;
      const t = e.txn;
      if (t.kind === "fee") {
        collected += t.amount;
        if (t.ts >= since) {
          const day = new Date(t.ts).toISOString().slice(0, 10);
          const row = (byDay[day] ??= { fees: 0, matches: 0 });
          row.fees += t.amount;
          row.matches++;
        }
      } else if (t.kind === "adjust") takenOut.push({ amount: t.amount, note: t.note, by: t.by, ts: t.ts });
    }
    return { book, balance: own(this.data(book).balances, PLATFORM_ACCOUNT) ?? 0, collected, byDay, adjustments: takenOut };
  }

  /** Everything the wallet screen shows for one profile. */
  summary(profileId: string) {
    return {
      ...this.config(),
      balance: this.balanceOf(profileId),
      faucetReadyAt: this.mode === "play" ? this.faucetReadyAt(profileId) : null,
      depositAccounts: this.depositAccounts(),
      depositPayer: this.depositPayer(profileId),
      withdrawals: this.withdrawals(profileId),
      history: this.history(profileId),
    };
  }

  /** wallet:get and wallet:faucet over the signed-in socket. */
  attach(socket: Socket, profileId: string) {
    type Ack = (res: { ok: boolean; [k: string]: unknown }) => void;
    socket.on("wallet:get", (_msg: unknown, ack?: Ack) => {
      if (typeof _msg === "function") ack = _msg as Ack;
      if (typeof ack === "function") ack({ ok: true, wallet: this.summary(profileId) });
    });
    socket.on("wallet:faucet", (_msg: unknown, ack?: Ack) => {
      if (typeof _msg === "function") ack = _msg as Ack;
      const r = this.faucet(profileId);
      if (typeof ack !== "function") return;
      ack(r.ok ? { ok: true, wallet: this.summary(profileId) } : { ok: false, reason: r.reason });
    });
  }

  /** Public settings the client needs to show the wallet and stake picker. */
  config() {
    return {
      mode: this.mode,
      currency: this.mode === "play" ? "play birr" : "birr",
      feeBps: this.feeBps,
      minStake: this.minStake,
      maxStake: this.maxStake,
      faucetAmount: this.mode === "play" ? this.faucetAmount : 0,
    };
  }
}

/**
 * Real money needs two settings: WALLET_MODE=real and REAL_MONEY_LEGAL_OK=1, the
 * second set only once real-money play is legally cleared (audit C3). Either one
 * alone keeps play money.
 */
export function walletModeFromEnv(value = process.env.WALLET_MODE, legalOk = process.env.REAL_MONEY_LEGAL_OK): WalletMode {
  if (value !== "real") return "play";
  if (legalOk?.trim() === "1") return "real";
  console.warn("WALLET_MODE=real ignored: REAL_MONEY_LEGAL_OK=1 is not set, so the wallet stays on play money");
  return "play";
}

/** True when `given` is the admin token. Off (always false) unless the token is at least 24 characters. */
export function isAdmin(given: unknown, token = process.env.ADMIN_TOKEN): boolean {
  if (!token || token.length < 24 || typeof given !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

/**
 * Admin-only wallet routes, behind the X-Admin-Token header (ADMIN_TOKEN). Without
 * ADMIN_TOKEN they answer 404, as if they weren't there.
 * - GET  /api/admin/wallet/reconcile   log vs stored balances (audit M1)
 * - GET  /api/admin/wallet/fees?book=  platform fee report (audit L1)
 * - POST /api/admin/wallet/adjust      {book, profileId, amount (santim), reason, by}
 */
export function walletAdminRoutes(wallet: Wallet, token: () => string | undefined = () => process.env.ADMIN_TOKEN): Router {
  const router = Router();
  router.use("/api/admin/wallet", (req, res, next) => {
    const t = token();
    if (!t || t.length < 24) return res.status(404).json({ error: "not found" });
    if (!isAdmin(req.headers["x-admin-token"], t)) return res.status(401).json({ error: "admin token required" });
    next();
  });
  router.get("/api/admin/wallet/reconcile", (_req, res) => {
    res.json(wallet.reconcile());
  });
  router.get("/api/admin/wallet/fees", (req, res) => {
    const book = req.query.book === "play" ? "play" : req.query.book === "real" ? "real" : wallet.mode;
    res.json(wallet.feeReport(book));
  });
  router.post("/api/admin/wallet/adjust", (req, res) => {
    const { book, profileId, amount, reason, by } = req.body ?? {};
    const who = typeof by === "string" && by.trim() ? `admin:${by.trim().slice(0, 40)}` : "admin";
    const r = wallet.adjust(book, profileId, amount, reason, who);
    if (!r.ok) return res.status(400).json({ error: r.reason });
    console.warn(`wallet: ${who} adjusted ${book} ${profileId} by ${amount} santim: ${r.txn.note}`);
    res.json({ balance: r.balance, txn: r.txn });
  });
  return router;
}

export function walletRoutes(wallet: Wallet, identity: Identity): Router {
  const router = Router();

  router.get("/api/wallet/config", (_req, res) => {
    res.json(wallet.config());
  });

  router.get("/api/wallet", (req, res) => {
    const me = identity.byToken(bearerToken(req.headers.authorization));
    if (!me) return res.status(401).json({ error: "sign in first" });
    res.json(wallet.summary(me.id));
  });

  router.post("/api/wallet/faucet", (req, res) => {
    const me = identity.byToken(bearerToken(req.headers.authorization));
    if (!me) return res.status(401).json({ error: "sign in first" });
    const r = wallet.faucet(me.id);
    if (!r.ok) return res.status(400).json({ error: r.reason, faucetReadyAt: wallet.faucetReadyAt(me.id) });
    res.json({ balance: r.balance, faucetReadyAt: wallet.faucetReadyAt(me.id) });
  });

  return router;
}
