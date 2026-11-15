// Pure helpers that turn stored data into admin rows: player rows with search, filters
// and sorting, match rows with names and stake, per-game tallies. No store or socket
// access here, so each piece is easy to test; adminPeople.ts gathers the inputs.
import type { MatchRecord } from "../../../engine/types";
import type { Profile } from "../identity";
import { BOT_PLAYER } from "../lobby";
import type { StoredMatch } from "../recorder";
import type { Status } from "../social";
import type { Escrow, WalletMode } from "../wallet";

export type Book = WalletMode;

export interface UserRow {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  createdAt: number;
  hasPassword: boolean;
  status: Status;
  balance: { real: number; play: number };
  matches: number;
  lastMatchAt: number | null;
  lastSignInAt: number | null;
}

export const USER_FILTERS = ["all", "registered", "guest", "online", "funded"] as const;
export const USER_SORTS = ["joined", "name", "balance", "matches", "lastMatch"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];
export type UserSort = (typeof USER_SORTS)[number];

/** One of `allowed`, or the fallback when the value is missing or unknown. */
export function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** Matches played and the newest end time, per profile, from every recorded match. */
export function matchCounts(stored: StoredMatch[]): Map<string, { played: number; lastAt: number }> {
  const out = new Map<string, { played: number; lastAt: number }>();
  for (const { record } of stored) {
    for (const id of new Set(record.players)) {
      const c = out.get(id) ?? { played: 0, lastAt: 0 };
      c.played++;
      c.lastAt = Math.max(c.lastAt, record.endedAt);
      out.set(id, c);
    }
  }
  return out;
}

export interface UserRowInputs {
  hasPassword: boolean;
  status: Status;
  balance: { real: number; play: number };
  matches?: { played: number; lastAt: number };
  lastSignInAt?: number;
}

export function userRow(p: Profile, x: UserRowInputs): UserRow {
  return {
    id: p.id,
    name: p.name,
    username: p.username,
    avatar: p.avatar ?? null,
    createdAt: p.createdAt,
    hasPassword: x.hasPassword,
    status: x.status,
    balance: x.balance,
    matches: x.matches?.played ?? 0,
    lastMatchAt: x.matches?.lastAt || null,
    lastSignInAt: x.lastSignInAt || null,
  };
}

/** Name or @username contains `q`, or the id starts with it. Case-insensitive; a leading @ is ignored. */
export function matchesQuery(row: Pick<UserRow, "id" | "name" | "username">, rawQ: unknown): boolean {
  const q = typeof rawQ === "string" ? rawQ.trim().toLowerCase().replace(/^@/, "") : "";
  if (!q) return true;
  return row.name.toLowerCase().includes(q) || row.username.includes(q) || row.id.startsWith(q);
}

export function passesFilter(row: UserRow, filter: UserFilter): boolean {
  switch (filter) {
    case "registered":
      return row.hasPassword;
    case "guest":
      return !row.hasPassword;
    case "online":
      return row.status !== "offline";
    case "funded":
      return row.balance.real > 0;
    default:
      return true;
  }
}

/** Sorted copy. Ties (and missing values, always last) fall back to newest joined first. */
export function sortUsers(rows: UserRow[], sort: UserSort, dir: "asc" | "desc", book: Book): UserRow[] {
  const key = (r: UserRow): number | string | null => {
    switch (sort) {
      case "name":
        return r.name.toLowerCase();
      case "balance":
        return r.balance[book];
      case "matches":
        return r.matches;
      case "lastMatch":
        return r.lastMatchAt;
      default:
        return r.createdAt;
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) {
      if (ka === null) return 1;
      if (kb === null) return -1;
      const c = typeof ka === "string" ? ka.localeCompare(kb as string) : ka - (kb as number);
      if (c !== 0) return c * sign;
    }
    return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
  });
}

/** One page of rows. */
export function paged<T>(rows: T[], page: number, limit: number): { rows: T[]; total: number } {
  return { rows: rows.slice(page * limit, page * limit + limit), total: rows.length };
}

// ---- matches ----

export interface PlayerRef {
  profileId: string;
  name: string | null;
  username: string | null;
  bot: boolean;
}

export interface StakeInfo {
  amount: number;
  book: Book;
  status: Escrow["status"];
  /** What the winner takes (or would take while held); 0 once refunded. */
  prize: number;
  fee: number;
}

export interface MatchRow {
  matchId: string;
  gameId: string;
  gameName: string;
  players: PlayerRef[];
  bot: boolean;
  outcome: MatchRecord["outcome"];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  moves: number;
  stake: StakeInfo | null;
  status: StoredMatch["status"];
  resultIndex: number | null;
}

/** Profile lookup used for names; null for an id that isn't a profile. */
export type ProfileOf = (id: string) => Pick<Profile, "name" | "username"> | null;

/** A seat's player. The bot (and anything that isn't a profile in a bot match) reads as "Bot". */
export function playerRef(id: string, profileOf: ProfileOf, botMatch: boolean): PlayerRef {
  const p = id === BOT_PLAYER ? null : profileOf(id);
  if (!p && (id === BOT_PLAYER || botMatch)) return { profileId: id, name: "Bot", username: null, bot: true };
  return { profileId: id, name: p?.name ?? null, username: p?.username ?? null, bot: false };
}

/** Pot split for an escrow: prize and fee as settled (or due while held); nothing on a refund. */
export function stakeInfo(found: { book: Book; escrow: Escrow } | null): StakeInfo | null {
  if (!found) return null;
  const { book, escrow: e } = found;
  if (e.status === "refunded") return { amount: e.stake, book, status: e.status, prize: 0, fee: 0 };
  const pot = e.stake * 2;
  const fee = Math.floor((pot * e.feeBps) / 10_000);
  return { amount: e.stake, book, status: e.status, prize: pot - fee, fee };
}

export function matchRow(
  s: StoredMatch,
  x: { gameName: string; profileOf: ProfileOf; escrow: { book: Book; escrow: Escrow } | null },
): MatchRow {
  const r = s.record;
  return {
    matchId: r.matchId,
    gameId: r.gameId,
    gameName: x.gameName,
    players: r.players.map((id) => playerRef(id, x.profileOf, r.bot)),
    bot: r.bot,
    outcome: r.outcome,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: Math.max(0, r.endedAt - r.startedAt),
    moves: r.log.length,
    stake: stakeInfo(x.escrow),
    status: s.status,
    resultIndex: s.resultIndex,
  };
}

export interface MatchFilter {
  game?: string;
  player?: string;
  staked?: boolean;
  bot?: boolean;
}

/** Recorded matches passing the filter, newest end first. `staked` needs the set of staked match ids. */
export function filterMatches(stored: StoredMatch[], f: MatchFilter, stakedIds: ReadonlySet<string>): StoredMatch[] {
  return stored
    .filter(({ record: r }) => {
      if (f.game && r.gameId !== f.game) return false;
      if (f.player && !r.players.includes(f.player)) return false;
      if (f.staked !== undefined && stakedIds.has(r.matchId) !== f.staked) return false;
      if (f.bot !== undefined && r.bot !== f.bot) return false;
      return true;
    })
    .sort((a, b) => b.record.endedAt - a.record.endedAt || a.record.matchId.localeCompare(b.record.matchId));
}

export interface GameTally {
  gameId: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

/** Wins, losses and draws per game for one profile. A match with no winner counts as a draw. */
export function perGame(stored: StoredMatch[], profileId: string): GameTally[] {
  const by = new Map<string, GameTally>();
  for (const { record: r } of stored) {
    const seat = r.players.indexOf(profileId);
    if (seat === -1) continue;
    const t = by.get(r.gameId) ?? { gameId: r.gameId, played: 0, wins: 0, losses: 0, draws: 0 };
    t.played++;
    if (r.outcome.draw || r.outcome.winner === null) t.draws++;
    else if (r.outcome.winner === seat) t.wins++;
    else t.losses++;
    by.set(r.gameId, t);
  }
  return [...by.values()].sort((a, b) => b.played - a.played || a.gameId.localeCompare(b.gameId));
}
