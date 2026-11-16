// Pure helpers behind the Matches and Tournaments screens: what a match outcome
// reads as (every Outcome shape), the URL filters and the API query they make,
// the stake line, the CSV export and the tournament texts. No React, tested alone.

import type { CsvColumn } from "./csv";
import { duration } from "./format";
import type { MatchRow, PlayerRef, StakeInfo, TournamentRow } from "./types";

// ---------------------------------------------------------------- outcome

export type ResultKind = "won" | "draw" | "aborted";

export interface MatchResultText {
  kind: ResultKind;
  /** Winning seat (index into players), or null. */
  winnerSeat: 0 | 1 | null;
  /** The pill text: "Yodit won", "Draw" or "Aborted". */
  label: string;
  /** Why it ended, in words, when the outcome carries something worth showing; else null. */
  reason: string | null;
}

/** A player's display name; bots read "Bot" and a deleted profile "Unknown player". */
export function playerName(p: Pick<PlayerRef, "name" | "bot"> | undefined): string {
  if (!p) return "Unknown player";
  return p.bot ? "Bot" : (p.name ?? "Unknown player");
}

/** The engine's reason strings made readable ("forfeit", "abandoned" and the per-game ones like "BINGO"). */
export function reasonText(reason: string | null | undefined, kind: ResultKind): string | null {
  const r = (reason ?? "").trim();
  if (!r) return null;
  const lower = r.toLowerCase();
  if (lower === "forfeit") return "Forfeit: the other player left";
  if (lower === "abandoned") return "Both players left";
  if (lower === "timeout" || lower === "timed out") return "Ran out of time";
  // A plain "draw" adds nothing to a Draw pill.
  if (kind === "draw" && lower === "draw") return null;
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/**
 * Outcome → text. `winner` is a seat and seats follow the order of `players`.
 * Cases: a win (with any reason, a forfeit included), a draw (flagged, or no
 * winner), "abandoned" (both left: aborted), a winner seat nobody sits in, and a
 * missing outcome (aborted).
 */
export function matchResult(match: Pick<MatchRow, "players" | "outcome">): MatchResultText {
  const o = match.outcome as MatchRow["outcome"] | null | undefined;
  if (!o) return { kind: "aborted", winnerSeat: null, label: "Aborted", reason: null };
  if ((o.reason ?? "").toLowerCase() === "abandoned") return { kind: "aborted", winnerSeat: null, label: "Aborted", reason: reasonText(o.reason, "aborted") };
  if (o.draw || o.winner === null || o.winner === undefined) {
    return { kind: "draw", winnerSeat: null, label: "Draw", reason: reasonText(o.reason, "draw") };
  }
  const who = match.players[o.winner];
  return { kind: "won", winnerSeat: o.winner, label: `${playerName(who)} won`, reason: reasonText(o.reason, "won") };
}

// ---------------------------------------------------------------- filters

export const MATCH_PAGE_SIZE = 50;

export const KNOWN_GAMES: readonly { id: string; name: string }[] = [
  { id: "crack-the-code", name: "Crack the Code" },
  { id: "gebeta", name: "Gebeta" },
  { id: "tic-tac-toe", name: "Tic-Tac-Toe" },
  { id: "dots-and-boxes", name: "Dots and Boxes" },
  { id: "bingo", name: "BINGO" },
  { id: "battleship", name: "Battleship" },
];

/** Game choices: the known games plus any the overview reports that are not in the list. */
export function gameOptions(byGame: readonly { gameId: string; gameName: string }[] = []): { value: string; label: string }[] {
  const out = KNOWN_GAMES.map((g) => ({ value: g.id, label: g.name }));
  for (const g of byGame) if (!out.some((o) => o.value === g.gameId)) out.push({ value: g.gameId, label: g.gameName });
  return [{ value: "", label: "All games" }, ...out];
}

export const TYPES = ["all", "human", "bot"] as const;
export type MatchType = (typeof TYPES)[number];
export const STAKES = ["all", "staked", "free"] as const;
export type StakeFilter = (typeof STAKES)[number];
export const TYPE_LABELS: Record<MatchType, string> = { all: "All", human: "vs human", bot: "vs bot" };
export const STAKE_LABELS: Record<StakeFilter, string> = { all: "All", staked: "Staked", free: "Free" };

export interface MatchListParams {
  game: string;
  type: MatchType;
  stake: StakeFilter;
  player: string;
  page: number;
  open: string;
}

const oneOf = <T extends string>(raw: string | null, allowed: readonly T[]): T | null =>
  raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;

/** The list state from the URL; unknown values fall back to the defaults. Pages count from 1 in the URL. */
export function parseMatchParams(get: (key: string) => string | null): MatchListParams {
  const page = Number.parseInt(get("page") ?? "", 10);
  return {
    game: (get("game") ?? "").trim(),
    type: oneOf(get("type"), TYPES) ?? "all",
    stake: oneOf(get("stake"), STAKES) ?? "all",
    player: (get("player") ?? "").trim(),
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
    open: (get("open") ?? "").trim(),
  };
}

/** The GET matches query for the filters (no page or limit). */
export function matchQuery(p: Pick<MatchListParams, "game" | "type" | "stake" | "player">): Record<string, string> {
  const q: Record<string, string> = {};
  if (p.game) q.game = p.game;
  if (p.type !== "all") q.bot = p.type === "bot" ? "1" : "0";
  if (p.stake !== "all") q.staked = p.stake === "staked" ? "1" : "0";
  if (p.player) q.player = p.player;
  return q;
}

/** True when any filter narrows the list. */
export const isFiltered = (p: Pick<MatchListParams, "game" | "type" | "stake" | "player">): boolean =>
  Boolean(p.game) || p.type !== "all" || p.stake !== "all" || Boolean(p.player);

// ---------------------------------------------------------------- stake and ledger

/** The escrow status as a word for the stake cell: "settled", "refunded" or "held". */
export function stakeNote(s: StakeInfo): string {
  if (s.status === "refunded") return "refunded";
  if (s.status === "held") return "held";
  return "settled";
}

/** "Recorded #12" or "Pending". */
export function ledgerText(m: Pick<MatchRow, "status" | "resultIndex">): string {
  return m.status === "recorded" ? (m.resultIndex != null ? `Recorded #${m.resultIndex}` : "Recorded") : "Pending";
}

// ---------------------------------------------------------------- live

/** Running time of a live match at `now`, never negative. */
export const liveElapsed = (startedAt: number, now: number): string => duration(Math.max(0, now - startedAt));

// ---------------------------------------------------------------- CSV

const iso = (ts: number | null | undefined) => (ts == null ? "" : new Date(ts).toISOString());

/** Columns of the export: money in birr as numbers, times as ISO (UTC) text. */
export const MATCH_CSV_COLUMNS: CsvColumn<MatchRow>[] = [
  { header: "match id", value: (m) => m.matchId },
  { header: "ended", value: (m) => iso(m.endedAt) },
  { header: "started", value: (m) => iso(m.startedAt) },
  { header: "game", value: (m) => m.gameName },
  { header: "player 1", value: (m) => playerName(m.players[0]) },
  { header: "player 1 id", value: (m) => m.players[0]?.profileId ?? "" },
  { header: "player 2", value: (m) => playerName(m.players[1]) },
  { header: "player 2 id", value: (m) => m.players[1]?.profileId ?? "" },
  { header: "vs bot", value: (m) => (m.bot ? "yes" : "no") },
  { header: "result", value: (m) => matchResult(m).label },
  { header: "reason", value: (m) => m.outcome?.reason ?? "" },
  { header: "duration seconds", value: (m) => Math.round(m.durationMs / 1000) },
  { header: "moves", value: (m) => m.moves },
  { header: "stake birr", value: (m) => (m.stake ? m.stake.amount / 100 : "") },
  { header: "book", value: (m) => m.stake?.book ?? "" },
  { header: "stake status", value: (m) => m.stake?.status ?? "" },
  { header: "prize birr", value: (m) => (m.stake ? m.stake.prize / 100 : "") },
  { header: "fee birr", value: (m) => (m.stake ? m.stake.fee / 100 : "") },
  { header: "ledger", value: (m) => m.status },
  { header: "result index", value: (m) => m.resultIndex },
];

/** "matches-2026-11-16-bingo-staked.csv" from the filters being exported. */
export function matchExportFilename(p: Pick<MatchListParams, "game" | "type" | "stake" | "player">, now = Date.now()): string {
  const parts = ["matches", new Date(now).toISOString().slice(0, 10)];
  if (p.game) parts.push(p.game);
  if (p.type !== "all") parts.push(p.type === "bot" ? "vs-bot" : "vs-human");
  if (p.stake !== "all") parts.push(p.stake);
  if (p.player) parts.push("player");
  return `${parts.join("-")}.csv`;
}

// ---------------------------------------------------------------- tournaments

export const TOURNAMENT_STATUSES = ["all", "open", "running", "finished"] as const;
export type TournamentStatusFilter = (typeof TOURNAMENT_STATUSES)[number];

/** "6 + 2 bots", "6 players", "1 player + 1 bot". */
export function tournamentPlayers(t: Pick<TournamentRow, "players" | "bots">): string {
  const humans = t.players - t.bots;
  const h = `${humans} ${humans === 1 ? "player" : "players"}`;
  if (t.bots <= 0) return h;
  return `${humans} + ${t.bots} ${t.bots === 1 ? "bot" : "bots"}`;
}

/** "Single elimination" style size and length: "8 players, best of 3". */
export function tournamentFormat(t: Pick<TournamentRow, "size" | "bestOf">): string {
  return `${t.size} players · best of ${t.bestOf}`;
}

/** Started to ended; running ones count up to `now`; null when it never started. */
export function tournamentDuration(t: Pick<TournamentRow, "startedAt" | "endedAt">, now = Date.now()): string | null {
  if (t.startedAt == null) return null;
  const end = t.endedAt ?? now;
  return duration(Math.max(0, end - t.startedAt));
}

/** Rows with the status, newest first order kept. */
export function filterTournaments<T extends Pick<TournamentRow, "status">>(rows: readonly T[], status: TournamentStatusFilter): T[] {
  return status === "all" ? [...rows] : rows.filter((r) => r.status === status);
}

/** Counts for the stat cards and chips. */
export function tournamentCounts(rows: readonly Pick<TournamentRow, "status">[]) {
  const c = { total: rows.length, open: 0, running: 0, finished: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}
