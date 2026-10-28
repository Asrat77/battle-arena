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
}

export interface GameSummary {
  id: string;
  name: string;
  queue: number;
  live: number;
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
  state: "waiting" | "ready-check" | "playing";
  matchId: string | null;
}

/** Subset of GET /api/profiles/:id/rewards the UI reads so far. */
export interface PlayerRewards {
  points: number;
  tokens: number;
  history?: { matchId: string | null; points: number; reasons: string[] }[];
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
  signup: (name: string) => request<{ profile: Profile; token: string }>("/api/signup", { method: "POST", body: JSON.stringify({ name }) }),
  me: (token: string) => request<Profile>("/api/me", { headers: { Authorization: `Bearer ${token}` } }),
  profile: (id: string) => request<Profile>(`/api/profiles/${id}`),
  games: () => request<GameSummary[]>("/api/games"),
  matches: (player: string) => request<MatchSummary[]>(`/api/matches?player=${encodeURIComponent(player)}`),
  match: (id: string) => request<StoredMatch>(`/api/matches/${id}`),
  rewards: (id: string) => request<PlayerRewards>(`/api/profiles/${id}/rewards`),
  leaderboard: (game?: string) =>
    request<{ game: string | null; rows: LeaderboardRow[] }>(`/api/leaderboard${game ? `?game=${encodeURIComponent(game)}` : ""}`),
  ledger: () => request<LedgerResponse>("/api/ledger"),
  room: (code: string) => request<RoomState>(`/api/rooms/${encodeURIComponent(code)}`),
};
