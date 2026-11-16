// Pure helpers behind the Players list and Player detail screens: what a match
// meant for one player, win rates, URL parameter parsing, and the CSV export
// (which pages through the API). No React, so it is tested alone.

import type { CsvColumn } from "./csv";
import type { Book } from "./format";
import type { MatchRow, PlayerRef, UserRow } from "./types";

// ---------------------------------------------------------------- results

export type MatchResult = "won" | "lost" | "draw";

/**
 * What a match meant for one player. `outcome.winner` is a seat (0 or 1) and
 * seats follow the order of `players`, so the player's seat is their index.
 * No winner (or the draw flag) is a draw; null when the player was not in it.
 */
export function resultFor(match: Pick<MatchRow, "players" | "outcome">, profileId: string): MatchResult | null {
  const seat = match.players.findIndex((p) => p.profileId === profileId);
  if (seat === -1) return null;
  const { winner, draw } = match.outcome;
  if (draw || winner === null || winner === undefined) return "draw";
  return winner === seat ? "won" : "lost";
}

export const RESULT_LABELS: Record<MatchResult, string> = { won: "Won", lost: "Lost", draw: "Draw" };

/** The other seat of a two-player match (a bot reads as a bot); null when there is none. */
export function opponentOf(match: Pick<MatchRow, "players">, profileId: string): PlayerRef | null {
  const seat = match.players.findIndex((p) => p.profileId === profileId);
  if (seat === -1) return match.players[0] ?? null;
  return match.players.find((_, i) => i !== seat) ?? null;
}

/** Wins as a share of games played (0..1); null with no games. */
export function winRate(wins: number, played: number): number | null {
  return played > 0 ? Math.min(1, Math.max(0, wins / played)) : null;
}

/** "62%" or "–". */
export function winRateText(wins: number, played: number): string {
  const r = winRate(wins, played);
  return r === null ? "–" : `${Math.round(r * 100)}%`;
}

/** A game's display name: the name a recent match carried, else the id made readable ("dots-and-boxes" → "Dots and boxes"). */
export function gameLabel(gameId: string, known: readonly { gameId: string; gameName: string }[] = []): string {
  const hit = known.find((g) => g.gameId === gameId);
  if (hit) return hit.gameName;
  const words = gameId.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The prize a staked match paid out to its winner, or null when it is not a won staked match. */
export function wonPrize(match: Pick<MatchRow, "stake">, result: MatchResult | null): number | null {
  return match.stake && result === "won" && match.stake.status === "settled" ? match.stake.prize : null;
}

// ---------------------------------------------------------------- list parameters

export const FILTERS = ["all", "registered", "guest", "online", "funded"] as const;
export type PlayerFilter = (typeof FILTERS)[number];
export const SORTS = ["joined", "name", "balance", "matches", "lastMatch"] as const;
export type PlayerSort = (typeof SORTS)[number];
export type Dir = "asc" | "desc";

export const FILTER_LABELS: Record<PlayerFilter, string> = {
  all: "All",
  registered: "Registered",
  guest: "Guests",
  online: "Online",
  funded: "Funded",
};

export const PAGE_SIZE = 50;

export interface PlayerListParams {
  q: string;
  filter: PlayerFilter;
  sort: PlayerSort;
  dir: Dir;
  page: number;
}

/** The API's default direction for a sort: names A to Z, everything else biggest or newest first. */
export const defaultDir = (sort: PlayerSort): Dir => (sort === "name" ? "asc" : "desc");

const oneOf = <T extends string>(raw: string | null, allowed: readonly T[]): T | null =>
  raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;

/** Read the list's state from the URL; anything unknown falls back to the defaults. */
export function parseListParams(get: (key: string) => string | null): PlayerListParams {
  const sort = oneOf(get("sort"), SORTS) ?? "joined";
  const page = Number.parseInt(get("page") ?? "", 10);
  return {
    q: (get("q") ?? "").trim(),
    filter: oneOf(get("filter"), FILTERS) ?? "all",
    sort,
    dir: oneOf(get("dir"), ["asc", "desc"] as const) ?? defaultDir(sort),
    // The URL counts pages from 1, the API from 0.
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
  };
}

/** The API query for the list state (and the book that decides what "balance" sorts by). */
export function listQuery(p: PlayerListParams, book: Book): Record<string, string | number> {
  return { q: p.q, filter: p.filter, sort: p.sort, dir: p.dir, book };
}

// ---------------------------------------------------------------- CSV

const iso = (ts: number | null | undefined) => (ts == null ? "" : new Date(ts).toISOString());

/** Columns of the export: money in birr as numbers, times as ISO (UTC) text. */
export const PLAYER_CSV_COLUMNS: CsvColumn<UserRow>[] = [
  { header: "id", value: (u) => u.id },
  { header: "name", value: (u) => u.name },
  { header: "username", value: (u) => u.username },
  { header: "joined", value: (u) => iso(u.createdAt) },
  { header: "registered", value: (u) => (u.hasPassword ? "yes" : "no") },
  { header: "status", value: (u) => u.status },
  { header: "real balance birr", value: (u) => u.balance.real / 100 },
  { header: "play balance birr", value: (u) => u.balance.play / 100 },
  { header: "matches", value: (u) => u.matches },
  { header: "last match", value: (u) => iso(u.lastMatchAt) },
  { header: "last sign-in", value: (u) => iso(u.lastSignInAt) },
];

/** "players-2026-11-16-registered.csv" from the filters being exported. */
export function exportFilename(p: Pick<PlayerListParams, "filter" | "q">, now = Date.now()): string {
  const day = new Date(now).toISOString().slice(0, 10);
  const parts = ["players", day];
  if (p.filter !== "all") parts.push(p.filter);
  if (p.q) parts.push("search");
  return `${parts.join("-")}.csv`;
}

export const EXPORT_LIMIT = 200;

/**
 * Collect every row of a paged endpoint (limit 200 per request). Reports
 * progress after each page, stops early when `isCancelled` says so, and stops
 * on a short or empty page even if `total` was off.
 */
export async function collectAll<T>(
  fetchPage: (page: number, limit: number) => Promise<{ rows: T[]; total: number }>,
  opts: { limit?: number; onProgress?(done: number, total: number): void; isCancelled?(): boolean } = {},
): Promise<T[]> {
  const limit = opts.limit ?? EXPORT_LIMIT;
  const out: T[] = [];
  for (let page = 0; ; page++) {
    if (opts.isCancelled?.()) break;
    const res = await fetchPage(page, limit);
    out.push(...res.rows);
    opts.onProgress?.(out.length, Math.max(res.total, out.length));
    if (res.rows.length < limit || out.length >= res.total) break;
  }
  return out;
}

// ---------------------------------------------------------------- detail screen

export const TABS = ["overview", "matches", "wallet", "deposits", "withdrawals"] as const;
export type PlayerTab = (typeof TABS)[number];

/** The ?tab= value, or the overview for anything unknown. */
export function parseTab(raw: string | null): PlayerTab {
  return (TABS as readonly string[]).includes(raw ?? "") ? (raw as PlayerTab) : "overview";
}

const BANKS: Record<string, string> = { telebirr: "Telebirr", cbe: "CBE" };

/** "telebirr" → "Telebirr". */
export function bankLabel(bank: string): string {
  return BANKS[bank] ?? bank.charAt(0).toUpperCase() + bank.slice(1);
}

/** The amount to show for a deposit: the credited one, else the verified amount waiting in review. */
export function depositAmount(d: { amount: number | null; reviewAmount?: number | null }): { amount: number | null; review: boolean } {
  if (d.amount != null) return { amount: d.amount, review: false };
  return { amount: d.reviewAmount ?? null, review: d.reviewAmount != null };
}
