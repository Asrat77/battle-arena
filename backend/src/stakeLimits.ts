// Anti-collusion limits for real-money stakes (audit H8, plan/staked-matches.md
// "Anti-cheat"). Two friends can pass money between them by one losing on
// purpose, so in real-money mode:
// - the same two players can play only so many staked matches a day,
// - each player can put only so much at stake a day,
// - an account must be some hours old, and have a password, before it stakes,
// - a pair whose stakes keep flowing one way is flagged to the moderators.
// Play money has no cash value, so none of this applies to it.

import { BIRR, type Escrow, type Wallet } from "./wallet";

const DAY_MS = 24 * 60 * 60_000;

export const STAKE_LIMITS = {
  /** Staked matches the same two players may start in 24 hours (STAKE_PAIR_DAILY_MAX). */
  pairPerDay: 3,
  /** Santim one player may put at stake in 24 hours (STAKE_DAILY_MAX_BIRR). */
  perDay: 1_000 * BIRR,
  /** How old an account must be before it stakes real money (STAKE_MIN_ACCOUNT_AGE_HOURS). */
  minAccountAgeMs: 24 * 60 * 60_000,
};

/** One-way flow flag: this many settled matches in FLOW_WINDOW_MS, all won by the same player. */
export const FLOW_MIN_MATCHES = 4;
export const FLOW_WINDOW_MS = 7 * DAY_MS;

export interface StakeLimitOptions {
  limits?: Partial<typeof STAKE_LIMITS>;
  /** When the account was made (ms), or null when unknown. */
  createdAt: (profileId: string) => number | null;
  hasPassword: (profileId: string) => boolean;
  nameOf?: (profileId: string) => string;
  /** Tell the moderators about a suspicious pair (Telegram); logged either way. */
  alert?: (text: string) => void;
  now?: () => number;
}

/** STAKE_PAIR_DAILY_MAX / STAKE_DAILY_MAX_BIRR / STAKE_MIN_ACCOUNT_AGE_HOURS; unreadable values keep the defaults. */
export function stakeLimitsFromEnv(env: Record<string, string | undefined> = process.env): Partial<typeof STAKE_LIMITS> {
  const num = (raw: string | undefined, min: number) => {
    const n = Number(raw);
    return raw && raw.trim() !== "" && Number.isFinite(n) && n >= min ? n : undefined;
  };
  const out: Partial<typeof STAKE_LIMITS> = {};
  const pair = num(env.STAKE_PAIR_DAILY_MAX, 1);
  const day = num(env.STAKE_DAILY_MAX_BIRR, 1);
  const age = num(env.STAKE_MIN_ACCOUNT_AGE_HOURS, 0);
  if (pair !== undefined) out.pairPerDay = Math.floor(pair);
  if (day !== undefined) out.perDay = Math.round(day * BIRR);
  if (age !== undefined) out.minAccountAgeMs = Math.round(age * 60 * 60_000);
  return out;
}

const birr = (santim: number) => (santim / BIRR).toLocaleString("en-US", { maximumFractionDigits: 2 });
const samePair = (e: Escrow, a: string, b: string) => (e.players[0] === a && e.players[1] === b) || (e.players[0] === b && e.players[1] === a);

export class StakeLimits {
  readonly limits: typeof STAKE_LIMITS;
  private readonly now: () => number;
  /** Pairs already flagged, so one pair doesn't alert after every match. */
  private flagged = new Map<string, number>();

  constructor(
    private readonly wallet: Wallet,
    private readonly opts: StakeLimitOptions,
  ) {
    this.limits = { ...STAKE_LIMITS, ...opts.limits };
    this.now = opts.now ?? Date.now;
  }

  /** Stakes that moved money or still hold it (a refund moved nothing). */
  private recent(since: number): Escrow[] {
    return this.wallet.escrows("real").filter((e) => e.createdAt > since && e.status !== "refunded");
  }

  /**
   * Why these players can't stake `stake` together now, or null. Pass one player
   * to check only them (creating a room), two to check the pair too. The reason
   * is worded for `players[0]`.
   */
  check(players: string[], stake: number): string | null {
    if (this.wallet.mode !== "real") return null;
    const since = this.now() - DAY_MS;
    const recent = this.recent(since);
    for (const [i, p] of players.entries()) {
      const you = i === 0;
      if (!this.opts.hasPassword(p)) return you ? "add a password to your account (Settings) before playing for real money" : "your opponent needs a password on their account to play for real money";
      const created = this.opts.createdAt(p);
      if (created === null || this.now() - created < this.limits.minAccountAgeMs) {
        const hours = Math.ceil(this.limits.minAccountAgeMs / 3_600_000);
        return you ? `new accounts can play for real money ${hours} hours after signing up` : `your opponent's account is too new to play for real money (${hours} hours)`;
      }
      const staked = recent.filter((e) => e.players.includes(p)).reduce((sum, e) => sum + e.stake, 0);
      if (staked + stake > this.limits.perDay) {
        return you
          ? `you can stake up to ${birr(this.limits.perDay)} birr a day; ${birr(Math.max(0, this.limits.perDay - staked))} birr left for now`
          : "your opponent has reached their daily stake limit";
      }
    }
    if (players.length === 2) {
      const together = recent.filter((e) => samePair(e, players[0], players[1])).length;
      if (together >= this.limits.pairPerDay) return `you've played ${together} staked matches with this player today; try again tomorrow or play someone else`;
    }
    return null;
  }

  /**
   * After a real-money match settles: if one player of this pair won every one of
   * their last FLOW_MIN_MATCHES or more staked matches in a week, tell the moderators.
   * Returns the alert text when it flagged.
   */
  afterSettle(escrow: Escrow): string | null {
    if (escrow.status !== "settled") return null;
    const [a, b] = escrow.players;
    const key = [a, b].sort().join(":");
    const since = this.now() - FLOW_WINDOW_MS;
    if ((this.flagged.get(key) ?? 0) > this.now() - DAY_MS) return null;
    const games = this.wallet.escrows("real").filter((e) => samePair(e, a, b) && e.closedAt !== null && e.closedAt > since && e.status === "settled");
    if (games.length < FLOW_MIN_MATCHES) return null;
    const winners = new Set(games.map((e) => e.players[e.winner!]));
    if (winners.size !== 1) return null;
    const winner = [...winners][0];
    const loser = winner === a ? b : a;
    const net = games.reduce((sum, e) => sum + this.wallet.payout(e.stake, e.feeBps).prize - e.stake, 0);
    const name = this.opts.nameOf ?? ((id: string) => id);
    const text = `⚠️ One-way stakes: ${name(winner)} won all ${games.length} staked matches against ${name(loser)} in the last 7 days (about ${birr(net)} birr moved one way). Check for collusion before paying out withdrawals.`;
    this.flagged.set(key, this.now());
    console.warn(text);
    this.opts.alert?.(text);
    return text;
  }
}
