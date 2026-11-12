// Wallets for staked matches. Each profile has a balance; a staked match holds
// both players' stakes in escrow until the result is in, then pays the pot to
// the winner (minus the platform fee), or refunds both on a draw or abort.
//
// Amounts are whole santim (1 birr = 100 santim) so nothing is ever rounded
// by floating point. Every balance change is a transaction in the history.
//
// WALLET_MODE=play (the default) uses play money only: players top up from a
// free daily faucet and nothing is ever worth real birr. Real deposits and
// withdrawals come later, behind WALLET_MODE=real.

import { randomBytes } from "node:crypto";
import { Router } from "express";
import type { Socket } from "socket.io";
import type { Outcome } from "../../engine/types";
import { bearerToken, type Identity } from "./identity";
import { own } from "./safe";
import type { Store } from "./store";

const WALLET = "wallet";
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

export type TxnKind = "faucet" | "deposit" | "withdrawal" | "withdrawal-refund" | "hold" | "release" | "win" | "fee";

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
  }

  private data(): WalletData {
    return this.store.read<WalletData>(WALLET, { balances: {}, txns: [], escrows: {}, lastFaucet: {} });
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
    return own(this.data().escrows, id) ?? null;
  }

  escrowForMatch(matchId: string): Escrow | null {
    return Object.values(this.data().escrows).find((e) => e.matchId === matchId) ?? null;
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
    this.save(d, [profileId]);
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
    this.save(d, players);
    return { ok: true, escrow };
  }

  bind(escrowId: string, matchId: string): void {
    const d = this.data();
    const e = d.escrows[escrowId];
    if (!e || e.status !== "held") return;
    e.matchId = matchId;
    this.store.write(WALLET, d);
  }

  /** What the winner takes home from a pot of two stakes. */
  payout(stake: number, feeBps = this.feeBps): { prize: number; fee: number } {
    const pot = stake * 2;
    const fee = Math.floor((pot * feeBps) / 10_000);
    return { prize: pot - fee, fee };
  }

  /** Pay out a finished match. A draw refunds both stakes with no fee. */
  settle(escrowId: string, outcome: Pick<Outcome, "winner" | "draw">): Escrow | null {
    const d = this.data();
    const e = d.escrows[escrowId];
    if (!e || e.status !== "held") return null;
    if (outcome.draw || outcome.winner === null) return this.refundIn(d, e);
    const winner = e.players[outcome.winner];
    const { prize, fee } = this.payout(e.stake, e.feeBps);
    this.move(d, winner, prize, "win", e.id);
    if (fee > 0) this.move(d, PLATFORM_ACCOUNT, fee, "fee", e.id);
    e.status = "settled";
    e.winner = outcome.winner;
    e.closedAt = this.now();
    this.save(d, [winner]);
    return e;
  }

  /** Give both stakes back (match never started, aborted, or a draw). */
  refund(escrowId: string): Escrow | null {
    const d = this.data();
    const e = d.escrows[escrowId];
    if (!e || e.status !== "held") return null;
    return this.refundIn(d, e);
  }

  /**
   * Refund every escrow still held, except those whose match was resumed after a
   * restart (`resumed` match ids). Anything else held at boot belongs to a match that
   * died with the old process.
   */
  refundAllHeld(resumed: ReadonlySet<string> = new Set()): Escrow[] {
    const d = this.data();
    return Object.values(d.escrows)
      .filter((e) => e.status === "held" && !(e.matchId && resumed.has(e.matchId)))
      .map((e) => this.refundIn(d, e));
  }

  private refundIn(d: WalletData, e: Escrow): Escrow {
    for (const p of e.players) this.move(d, p, e.stake, "release", e.id);
    e.status = "refunded";
    e.closedAt = this.now();
    this.save(d, e.players);
    return e;
  }

  /** Add verified real money (a deposit). Real mode only; `ref` is the deposit id. */
  deposit(profileId: string, amount: number, ref: string): Result<{ balance: number }> {
    if (this.mode !== "real") return { ok: false, reason: "real money is off" };
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: "bad amount" };
    const d = this.data();
    this.move(d, profileId, amount, "deposit", ref);
    this.save(d, [profileId]);
    return { ok: true, balance: d.balances[profileId] };
  }

  /** The credit for deposit `ref`, if the wallet has one (used after a restart). */
  depositTxn(ref: string): Txn | null {
    return this.data().txns.find((t) => t.kind === "deposit" && t.ref === ref) ?? null;
  }

  /** The first transaction of this kind for `ref`, if any (used after a restart). */
  txnFor(kind: TxnKind, ref: string): Txn | null {
    return this.data().txns.find((t) => t.kind === kind && t.ref === ref) ?? null;
  }

  /** Take money out for a withdrawal request (refunded if moderators reject it). Real mode only. */
  withdraw(profileId: string, amount: number, ref: string): Result<{ balance: number }> {
    if (this.mode !== "real") return { ok: false, reason: "real money is off" };
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: "bad amount" };
    const d = this.data();
    if ((d.balances[profileId] ?? 0) < amount) return { ok: false, reason: "insufficient balance" };
    this.move(d, profileId, -amount, "withdrawal", ref);
    this.save(d, [profileId]);
    return { ok: true, balance: d.balances[profileId] };
  }

  /** Give back a withdrawal that moderators rejected. */
  refundWithdrawal(profileId: string, amount: number, ref: string) {
    const d = this.data();
    this.move(d, profileId, amount, "withdrawal-refund", ref);
    this.save(d, [profileId]);
  }

  private move(d: WalletData, profileId: string, amount: number, kind: TxnKind, ref: string | null) {
    const balance = (d.balances[profileId] ?? 0) + amount;
    if (balance < 0) throw new Error(`wallet ${profileId} would go negative`);
    d.balances[profileId] = balance;
    d.txns.push({ id: randomBytes(6).toString("hex"), profileId, kind, amount, balance, ref, ts: this.now() });
  }

  private save(d: WalletData, changed: string[]) {
    this.store.write(WALLET, d);
    for (const p of new Set(changed)) if (p !== PLATFORM_ACCOUNT) this.onChange(p, d.balances[p] ?? 0);
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

export function walletModeFromEnv(value = process.env.WALLET_MODE): WalletMode {
  return value === "real" ? "real" : "play";
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
