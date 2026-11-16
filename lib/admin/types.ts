// Response shapes of the admin API (see /api/admin in backend/src/admin and the
// API.md contract). Row types come from the backend as `import type` (erased at
// build, nothing from the server ships to the browser); the envelopes the
// routes build inline are declared here.

import type { ActivityRow } from "@/backend/src/admin/adminActivity";
import type { AuditEntry } from "@/backend/src/admin/adminAudit";
import type { GameTally, MatchRow, PlayerRef, StakeInfo, UserRow } from "@/backend/src/admin/adminData";
import type { AdminDeposit, AdminWithdrawal, EscrowRow, TxnRow, Who } from "@/backend/src/admin/adminLedger";
import type { GameTotal, Kpi, Kpis, SeriesDay } from "@/backend/src/admin/analytics";
import type { Escrow, Txn } from "@/backend/src/wallet";
import type { Profile } from "@/lib/api";
import type { Book } from "./format";

export type {
  ActivityRow,
  AdminDeposit,
  AdminWithdrawal,
  AuditEntry,
  EscrowRow,
  GameTally,
  GameTotal,
  Kpi,
  Kpis,
  MatchRow,
  PlayerRef,
  SeriesDay,
  StakeInfo,
  TxnRow,
  UserRow,
  Who,
};
export type { Book };

/** Every list endpoint. */
export interface Page<T> {
  rows: T[];
  total: number;
}

export interface Tally {
  count: number;
  amount: number;
}

/** GET /admin/api/session (via the BFF) */
export interface AdminWhoami {
  name: string;
  expiresAt: number | null;
}

/** GET overview */
export interface Overview {
  range: { days: number; from: number; to: number; tz: number };
  book: Book;
  now: {
    online: number;
    inMatch: number;
    liveMatches: number;
    queued: number;
    pendingWithdrawals: Tally;
    depositsInReview: Tally;
    pendingWrites: number;
  };
  totals: { players: number; registered: number; guests: number; matches: number; stakedMatches: number; tournaments: number };
  kpis: Kpis;
  series: SeriesDay[];
  byGame: GameTotal[];
}

/** GET users/:id */
export interface UserDetail {
  profile: Profile;
  account: { hasPassword: boolean; usernameChangeAt: number | null };
  status: UserRow["status"];
  matchId: string | null;
  balances: { real: number; play: number };
  withdrawable: { amount: number; held: number; heldUntil: number | null };
  depositPayer: { name: string; locked: boolean } | null;
  rewards: {
    points: number;
    tokens: number;
    overall: { rating: number; wins: number; losses: number; draws: number };
    games: Record<string, { rating: number; wins: number; losses: number; draws: number }>;
    streak: number;
    badges: string[];
  };
  perGame: GameTally[];
  matches: number;
  recentMatches: MatchRow[];
  txns: { real: Txn[]; play: Txn[] };
  deposits: AdminDeposit[];
  withdrawals: AdminWithdrawal[];
  friendCount: number;
  openSessions: number;
}

/** GET matches/live rows */
export interface LiveMatchRow {
  matchId: string;
  gameId: string;
  gameName: string;
  players: PlayerRef[];
  bot: boolean;
  startedAt: number;
  spectators: number;
  room: string | null;
  moves: number;
  stake: StakeInfo | null;
}

/** GET matches/:id (recorded) */
export type MatchDetail = MatchRow & {
  commitIndex: number | null;
  resultIndex: number | null;
  resultHash: string | null;
  escrow: (Escrow & { book: Book }) | null;
  replay: string | null;
};

/** GET tournaments rows */
export interface TournamentRow {
  id: string;
  name: string;
  gameId: string;
  gameName: string;
  size: number;
  bestOf: number;
  visibility: string;
  status: "open" | "running" | "finished";
  host: { id: string; name: string } | null;
  players: number;
  bots: number;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  champion: { id: string; name: string; bot: boolean } | null;
  link: string;
}

export interface WalletConfig {
  mode: Book;
  currency: string;
  feeBps: number;
  minStake: number;
  maxStake: number;
  faucetAmount: number;
  depositHoldMs: number;
  depositsEnabled: boolean;
  minDeposit: number;
}

export interface WithdrawalConfig {
  enabled: boolean;
  minAmount: number;
  perRequest: number;
  perDay: number;
  secondApprovalAbove: number | null;
}

/** GET wallet/summary */
export interface WalletSummary {
  book: Book;
  mode: Book;
  playerBalances: number;
  platformBalance: number;
  heldInEscrow: number;
  heldEscrows: number;
  deposits: Tally;
  withdrawals: { paid: Tally; pending: Tally };
  depositsInReview: Tally;
  adjustments: { count: number; net: number };
  legacyReport: unknown;
  config: WalletConfig & { withdrawals: WithdrawalConfig };
}

/** GET wallet/transactions */
export interface TxnPage extends Page<TxnRow> {
  source: "log" | "store";
}

/** POST wallet/adjust */
export interface AdjustResult {
  balance: number;
  txn: Txn;
}

/** GET wallet/reconcile (log replayed against the stored balances) */
export interface Reconcile {
  ok: boolean;
  entries: number;
  chain: "intact" | { at: number; reason: string };
  books: { book: Book; ok: boolean; txns: number; total: number; held: number; mismatches: unknown[]; escrows: unknown[] }[];
}

/** GET system */
export interface SystemInfo {
  time: number;
  uptimeMs: number;
  node: string;
  store: { kind: "postgres" | "file" | "memory"; pendingWrites: number; lastError: string | null };
  database: "ok" | "error" | "none";
  wallet: { mode: Book; config: WalletConfig; logEntries: number; chain: "intact" | { at: number; reason: string } };
  ledger: { blocks: number; pending: number };
  verifyBudget: { used: { day: number; month: number }; limits: { daily: number | null; monthly: number | null } } | null;
  telegram: { configured: boolean; moderatorChat: boolean; moderators: number };
  deposits: { enabled: boolean; accounts: number };
  withdrawals: WithdrawalConfig;
  admin: { liveSessions: number; auditEntries: number };
  counts: {
    profiles: number;
    matches: number;
    deposits: number;
    withdrawals: number;
    tournaments: number;
    liveMatches: number;
    sockets: number;
  };
}
