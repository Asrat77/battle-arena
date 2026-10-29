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
  /** Sign-in handle; only on your own profile (GET /api/me), null for a guest. */
  username?: string | null;
}

export interface Credentials {
  username: string;
  password: string;
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
}

/** A tournament, as GET /api/tournaments/:id and the tournament:update event send it. */
export interface TournamentState {
  id: string;
  link: string;
  gameId: string;
  gameName: string;
  host: string | null;
  state: "open" | "running" | "finished";
  size: number;
  entrants: TournamentEntrant[];
  rounds: { name: string; matches: BracketMatch[] }[];
  champion: TournamentEntrant | null;
  createdAt: number;
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
  claim: (token: string, creds: Credentials) =>
    request<Profile>("/api/me/credentials", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(creds),
    }),
  logout: (token: string) => request<void>("/api/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
  me: (token: string) => request<Profile>("/api/me", { headers: { Authorization: `Bearer ${token}` } }),
  profile: (id: string) => request<Profile>(`/api/profiles/${id}`),
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
