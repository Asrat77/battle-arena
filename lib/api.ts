// REST helpers and the shapes the server returns. One place to point the UI
// at the backend: NEXT_PUBLIC_API_URL (falls back to the old socket URL var).

import type { Block } from "@/engine/ledger";
import type { MatchRecord, Outcome } from "@/engine/types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001").replace(
  /\/$/,
  "",
);

export const BOT_PLAYER = "bot";

export interface Profile {
  id: string;
  name: string;
  createdAt: number;
  /** Picked picture name (engine/avatars); absent means the default for the id. */
  avatar?: string;
  /** Unique @handle, lowercase. Every profile has one; guests get an automatic one. */
  username: string;
  /** Only on your own profile (GET /api/me): false for a guest, who cannot sign back in. */
  hasPassword?: boolean;
  /** Only on your own profile: when you may change your @username again, or null if you may now. */
  usernameChangeAt?: number | null;
}

export interface Credentials {
  username: string;
  password: string;
}

/** GET /api/usernames/:u */
export interface UsernameStatus {
  username: string;
  available: boolean;
  reason?: string;
}

export interface GameSummary {
  id: string;
  name: string;
  queue: number;
  live: number;
}

/** One row of GET /api/live. */
export interface LiveMatch {
  matchId: string;
  gameId: string;
  gameName: string;
  players: { profileId: string; name: string }[];
  bot: boolean;
  startedAt: number;
  spectators: number;
  room: string | null;
  link: string;
}

export interface MatchSummary {
  matchId: string;
  gameId: string;
  players: [string, string];
  bot: boolean;
  outcome: Outcome;
  endedAt: number;
  status: "pending" | "recorded";
  resultIndex: number | null;
}

export interface StoredMatch {
  record: MatchRecord;
  reveal: Record<string, unknown>;
  commitments: Record<string, string>;
  resultHash: string;
  status: "pending" | "recorded";
  commitIndex: number | null;
  resultIndex: number | null;
}

export interface LedgerResponse {
  publicKey: string;
  pending: number;
  blocks: Block[];
}

/** A private room, as GET /api/rooms/:code and the room:update event send it. */
export interface RoomState {
  code: string;
  link: string;
  gameId: string;
  gameName: string;
  host: string;
  members: { profileId: string; name: string | null; ready: boolean; online: boolean }[];
  state: "waiting" | "ready-check" | "countdown" | "playing";
  matchId: string | null;
  /** Milliseconds left in the 3-2-1 when the payload was sent; null outside it. */
  countdownMs: number | null;
  /** Santim each player puts in, or null for a friendly room. */
  stake?: number | null;
  /** What the winner takes home (both stakes minus the fee). */
  prize?: number | null;
}

/** One balance change, as wallet:get sends it (amounts in santim). */
export interface WalletTxn {
  id: string;
  kind: "faucet" | "deposit" | "withdrawal" | "withdrawal-refund" | "hold" | "release" | "win" | "fee";
  amount: number;
  balance: number;
  ref: string | null;
  ts: number;
}

/** wallet:get over the socket (backend/src/wallet.ts). Amounts are santim. */
export interface WalletSummary {
  mode: "play" | "real";
  currency: string;
  feeBps: number;
  minStake: number;
  maxStake: number;
  faucetAmount: number;
  balance: number;
  faucetReadyAt: number | null;
  /** Where to send real money; empty while deposits are off. */
  depositAccounts: { bank: string; account: string }[];
  withdrawals: { enabled: boolean; minAmount: number; requests: Withdrawal[] };
  history: WalletTxn[];
}

/** A deposit checked with verify.et (backend/src/deposits.ts). */
export interface Deposit {
  id: string;
  bank: "telebirr" | "cbe";
  reference: string;
  status: "checking" | "credited" | "rejected";
  amount: number | null;
  reason: string | null;
  createdAt: number;
}

/** A cash-out request; moderators pay it by hand (backend/src/withdrawals.ts). */
export interface Withdrawal {
  id: string;
  bank: "telebirr" | "cbe";
  account: string;
  amount: number;
  status: "pending" | "paid" | "rejected";
  reference: string | null;
  createdAt: number;
  closedAt: number | null;
}

export type WithdrawalResult = { ok: true; withdrawal: Withdrawal } | { ok: false; reason: string };

export type DepositResult = { ok: true; deposit: Deposit } | { ok: false; reason: string };

export const BANK_NAMES: Record<string, string> = { telebirr: "Telebirr", cbe: "CBE" };

export const SANTIM_PER_BIRR = 100;

/** 12_550 santim → "125.50"; whole birr drop the decimals. */
export function formatBirr(santim: number): string {
  const birr = santim / SANTIM_PER_BIRR;
  return Number.isInteger(birr) ? birr.toLocaleString("en-US") : birr.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface TournamentEntrant {
  id: string;
  name: string;
  bot: boolean;
  seed: number;
}

export interface BracketMatch {
  /** Null until the feeding matches are decided. */
  players: [TournamentEntrant | null, TournamentEntrant | null];
  matchIds: string[];
  /** The latest match for this slot (a rematch after a draw replaces it). */
  matchId: string | null;
  state: "pending" | "playing" | "done";
  winner: TournamentEntrant | null;
  decidedBy: "match" | "coin flip" | null;
  /** Series wins, in players order (best-of-1: [1, 0] once decided by a game). */
  score: [number, number];
  /** Every game in order; winner is 0 or 1 (index into players), null for a draw or a game in play. */
  games: { matchId: string; winner: 0 | 1 | null; state: "playing" | "done" }[];
}

export type TournamentSize = 4 | 8 | 16;

/** What the tournament:create socket event takes. Only gameId is required. */
export interface CreateTournamentInput {
  gameId: string;
  /** Up to 40 characters; defaults to "<Game> tournament". */
  name?: string;
  size?: TournamentSize;
  bestOf?: 1 | 3;
  /** "link" tournaments are left out of GET /api/tournaments. */
  visibility?: "open" | "link";
  /** Start at once with bots in every empty seat. */
  fillWithBots?: boolean;
}

/** A tournament, as GET /api/tournaments/:id and the tournament:update event send it. */
export interface TournamentState {
  id: string;
  name: string;
  link: string;
  gameId: string;
  gameName: string;
  host: string | null;
  state: "open" | "running" | "finished";
  size: TournamentSize;
  bestOf: 1 | 3;
  visibility: "open" | "link";
  entrants: TournamentEntrant[];
  /** First round first; names are "Round of 16", "Quarterfinal", "Semifinal", "Final". */
  rounds: { name: string; matches: BracketMatch[] }[];
  champion: TournamentEntrant | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface Tally {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

/** A badge from GET /api/badges: the rules live in backend/src/rewards.ts. */
export interface BadgeInfo {
  id: string;
  name: string;
  description: string;
}

export interface EarnedBadge extends BadgeInfo {
  earnedAt: number;
  /** The match that earned it, or a tournament id for Champion. */
  source: string;
  /** The badge block, null while pending. */
  ledgerIndex: number | null;
}

/** GET /api/profiles/:id/rewards. */
export interface PlayerRewards {
  points: number;
  tokens: number;
  overall: Tally;
  games: Record<string, Tally>;
  watched: string[];
  badges: EarnedBadge[];
  history: { source: string; matchId: string | null; points: number; reasons: string[]; mintIndex: number | null }[];
}

/** One row of GET /api/leaderboard: rated matches against players only. */
export interface LeaderboardRow {
  rank: number;
  profileId: string;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ProfileHit {
  profileId: string;
  name: string;
  username: string;
  avatar: string | null;
  relationship?: "friend" | "sent" | "incoming" | "none";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error || res.statusText);
  return body as T;
}

export const api = {
  signup: (name: string, creds?: Credentials, avatar?: string) =>
    request<{ profile: Profile; token: string }>("/api/signup", {
      method: "POST",
      body: JSON.stringify({ name, ...creds, avatar }),
    }),
  setAvatar: (token: string, avatar: string) =>
    request<Profile>("/api/me/avatar", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ avatar }),
    }),
  login: (creds: Credentials) =>
    request<{ profile: Profile; token: string }>("/api/login", { method: "POST", body: JSON.stringify(creds) }),
  updateMe: (token: string, changes: { name?: string; username?: string }) =>
    request<Profile>("/api/me", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(changes),
    }),
  changePassword: (token: string, current: string, next: string) =>
    request<Profile>("/api/me/password", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ current, next }),
    }),
  usernameStatus: (username: string, token?: string | null) =>
    request<UsernameStatus>(`/api/usernames/${encodeURIComponent(username)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  searchProfiles: (q: string, token?: string | null, signal?: AbortSignal) =>
    request<{ results: ProfileHit[] }>(`/api/profiles/search?q=${encodeURIComponent(q)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
    }),
  claim: (token: string, creds: { username?: string; password: string }) =>
    request<Profile>("/api/me/credentials", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(creds),
    }),
  logout: (token: string) => request<void>("/api/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
  me: (token: string) => request<Profile>("/api/me", { headers: { Authorization: `Bearer ${token}` } }),
  profile: (id: string) => request<Profile>(`/api/profiles/${id}`),
  presence: (id: string, signal?: AbortSignal) =>
    request<{ profileId: string; status: "online" | "in-match" | "offline"; matchId: string | null }>(`/api/profiles/${id}/presence`, { signal }),
  games: () => request<GameSummary[]>("/api/games"),
  live: () => request<LiveMatch[]>("/api/live"),
  matches: (player: string) => request<MatchSummary[]>(`/api/matches?player=${encodeURIComponent(player)}`),
  match: (id: string) => request<StoredMatch>(`/api/matches/${id}`),
  rewards: (id: string) => request<PlayerRewards>(`/api/profiles/${id}/rewards`),
  leaderboard: (game?: string) =>
    request<{ game: string | null; rows: LeaderboardRow[] }>(`/api/leaderboard${game ? `?game=${encodeURIComponent(game)}` : ""}`),
  badges: () => request<BadgeInfo[]>("/api/badges"),
  ledger: () => request<LedgerResponse>("/api/ledger"),
  matchRoom: (id: string) => request<{ code: string }>(`/api/matches/${id}/room`),
  tournaments: (game?: string) =>
    request<TournamentState[]>(`/api/tournaments${game ? `?game=${encodeURIComponent(game)}` : ""}`),
  tournament: (id: string) => request<TournamentState>(`/api/tournaments/${encodeURIComponent(id)}`),
  room: (code: string) => request<RoomState>(`/api/rooms/${encodeURIComponent(code)}`),
};
