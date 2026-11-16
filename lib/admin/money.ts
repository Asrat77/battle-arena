// Pure helpers behind the money screens: birr typed by an admin turned into whole
// santim with integer maths, the type-the-amount confirm, balances before and
// after, the deposit name check, withdrawal waiting buckets, the fee chart days,
// the reconcile summary, the legacy report rows and the ledger URL filters and
// CSV. No React, so every rule that touches money is tested alone.

import type { CsvColumn } from "./csv";
import type { Book } from "./format";
import type { Reconcile, TxnRow } from "./types";

// ---------------------------------------------------------------- amounts

/** The largest single adjustment the dialog accepts, in birr. */
export const MAX_ADJUST_BIRR = 1_000_000;
export const ADJUST_REASON_MIN = 10;
export const ADJUST_REASON_MAX = 500;
/** The API's limits for a deposit decision's written reason. */
export const RESOLVE_REASON_MIN = 5;
export const RESOLVE_REASON_MAX = 300;

export type ParsedBirr = { ok: true; santim: number } | { ok: false; error: string };

const TOO_BIG = `The most one adjustment can move is ${MAX_ADJUST_BIRR.toLocaleString("en-US")} birr.`;

/**
 * "12.5" → 1250 santim. Digits with an optional point and at most two decimals;
 * spaces around are ignored and thousands commas are refused (the confirm step
 * asks for the same plain number). No signs, exponents or zero: the direction is
 * chosen separately, so the amount is always positive.
 */
export function parseBirr(raw: string): ParsedBirr {
  const s = raw.trim();
  if (s === "") return { ok: false, error: "Enter an amount." };
  if (s.startsWith("-") || s.startsWith("+")) return { ok: false, error: "Enter the amount without a sign; pick credit or debit above." };
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) {
    if (/^\d*\.\d{3,}$/.test(s)) return { ok: false, error: "Use at most 2 decimals (santim)." };
    return { ok: false, error: "Enter a number like 250 or 12.50." };
  }
  const whole = m[1].replace(/^0+(?=\d)/, "");
  if (whole.length > 7) return { ok: false, error: TOO_BIG };
  const santim = Number(whole) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (santim === 0) return { ok: false, error: "The amount must be more than 0." };
  if (santim > MAX_ADJUST_BIRR * 100) return { ok: false, error: TOO_BIG };
  return { ok: true, santim };
}

/** 25000 → "250.00", 1250 → "12.50" (no grouping: the text the admin types to confirm). */
export function plainBirr(santim: number): string {
  const a = Math.abs(santim);
  return `${santim < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Whether the typed confirm text is this amount exactly: "250" or "250.00", "12.5" or "12.50". */
export function confirmMatches(typed: string, santim: number): boolean {
  if (!Number.isInteger(santim) || santim <= 0) return false;
  const t = typed.trim();
  const full = plainBirr(santim);
  const ok = new Set([full]);
  if (santim % 100 === 0) ok.add(String(santim / 100));
  else if (santim % 10 === 0) ok.add(full.slice(0, -1));
  return ok.has(t);
}

export type Direction = "credit" | "debit";

/** The signed santim the API takes for a credit or a debit of `santim`. */
export const signedAmount = (santim: number, direction: Direction): number => (direction === "debit" ? -santim : santim);

/** The balance after the adjustment (may be negative: callers show that as an error). */
export const balanceAfter = (balance: number, santim: number, direction: Direction): number => balance + signedAmount(santim, direction);

/** The message under a reason box, or null when it is fine. */
export function reasonError(reason: string, min = ADJUST_REASON_MIN, max = ADJUST_REASON_MAX): string | null {
  const n = reason.trim().length;
  if (n < min) return `Write at least ${min} characters (${n} so far).`;
  if (n > max) return `Keep it to ${max} characters or fewer.`;
  return null;
}

// ---------------------------------------------------------------- deposit name check

export type NameMatch = "same" | "partial" | "different" | "unknown";

const words = (name: string | null | undefined): string[] =>
  (name ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Payer name vs the sender name on the receipt, a visual aid only: the same words
 * in any order is "same", all the words of the shorter one inside the longer is
 * "partial" (a receipt often adds the grandfather's name), anything else
 * "different", and a missing side "unknown".
 */
export function nameMatch(a: string | null | undefined, b: string | null | undefined): NameMatch {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (x.size === 0 || y.size === 0) return "unknown";
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  const inside = [...small].every((w) => big.has(w));
  if (inside && small.size === big.size) return "same";
  if (inside) return "partial";
  return "different";
}

export const NAME_MATCH_TEXT: Record<NameMatch, string> = {
  same: "Looks the same",
  partial: "Partly the same",
  different: "Looks different",
  unknown: "Can't compare",
};

// ---------------------------------------------------------------- withdrawals

export const HOUR = 3_600_000;

/** How long a pending payout has waited: fine under 1 h, amber from 1 h, red from 6 h. */
export function waitBucket(waitedMs: number): "ok" | "amber" | "red" {
  if (waitedMs >= 6 * HOUR) return "red";
  if (waitedMs >= HOUR) return "amber";
  return "ok";
}

/** The oldest createdAt of the rows (null for none). */
export function oldest(rows: readonly { createdAt: number }[]): number | null {
  let min: number | null = null;
  for (const r of rows) if (min === null || r.createdAt < min) min = r.createdAt;
  return min;
}

// ---------------------------------------------------------------- fees

export interface FeeDay {
  /** UTC day "2026-11-15" (the fee report buckets by UTC day). */
  day: string;
  fees: number;
  matches: number;
}

const DAY_MS = 86_400_000;

/** The fee report's byDay, one entry per UTC day for the last `days` days ending today, oldest first, zero-filled. */
export function feeDays(byDay: Record<string, { fees: number; matches: number }> | null | undefined, now: number, days = 30): FeeDay[] {
  const out: FeeDay[] = [];
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today - i * DAY_MS).toISOString().slice(0, 10);
    const hit = byDay?.[day];
    out.push({ day, fees: hit?.fees ?? 0, matches: hit?.matches ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------- reconcile

export interface ReconcileMismatch {
  profileId: string;
  stored: number;
  logged: number;
}
export interface ReconcileEscrowProblem {
  id: string;
  status: string;
  off: number;
}

export interface ReconcileSummary {
  ok: boolean;
  headline: string;
  /** One short line per problem area, empty when all is well. */
  problems: string[];
  mismatches: number;
  escrowProblems: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the big status line says about a reconcile run. */
export function reconcileSummary(r: Pick<Reconcile, "ok" | "chain" | "books">): ReconcileSummary {
  const problems: string[] = [];
  if (r.chain !== "intact") problems.push(`The log's hash chain breaks at entry ${r.chain.at}: ${r.chain.reason}`);
  let mismatches = 0;
  let escrowProblems = 0;
  for (const b of r.books) {
    const name = b.book === "real" ? "Real money" : "Play money";
    if (b.mismatches.length) problems.push(`${name}: ${plural(b.mismatches.length, "balance differs", "balances differ")} from the log`);
    if (b.escrows.length) problems.push(`${name}: ${plural(b.escrows.length, "escrow doesn't", "escrows don't")} add up`);
    mismatches += b.mismatches.length;
    escrowProblems += b.escrows.length;
  }
  const ok = r.ok && problems.length === 0;
  return { ok, headline: ok ? "Books balance" : "Books do not balance", problems, mismatches, escrowProblems };
}

// ---------------------------------------------------------------- legacy report

export interface LegacyRow {
  profileId: string;
  deposited: number;
  withdrawn: number;
  refunded: number;
  /** The old shared book's balance (real and play money mixed). */
  balance: number;
  /** Real money in that never came back out: deposited − withdrawn + refunded. */
  netIn: number;
}

const santimOf = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);

/** The wallet's legacy report ({ migratedAt, profiles: { [id]: { deposited, withdrawn, refunded, balance } } }) as rows, biggest first. */
export function legacyRows(report: unknown): { migratedAt: number | null; rows: LegacyRow[] } {
  if (!report || typeof report !== "object") return { migratedAt: null, rows: [] };
  const r = report as { migratedAt?: unknown; profiles?: unknown };
  const rows: LegacyRow[] = [];
  if (r.profiles && typeof r.profiles === "object") {
    for (const [profileId, v] of Object.entries(r.profiles as Record<string, unknown>)) {
      const p = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      const deposited = santimOf(p.deposited);
      const withdrawn = santimOf(p.withdrawn);
      const refunded = santimOf(p.refunded);
      rows.push({ profileId, deposited, withdrawn, refunded, balance: santimOf(p.balance), netIn: deposited - withdrawn + refunded });
    }
  }
  rows.sort((a, b) => b.netIn - a.netIn || a.profileId.localeCompare(b.profileId));
  return { migratedAt: typeof r.migratedAt === "number" ? r.migratedAt : null, rows };
}

/** The prefilled reason for crediting a legacy row (the wallet screen marks a player done when an adjust note mentions "legacy"). */
export function legacyReason(r: LegacyRow): string {
  return `Legacy real money from before the book split: deposited ${plainBirr(r.deposited)}, withdrawn ${plainBirr(r.withdrawn)}, refunded ${plainBirr(r.refunded)} birr.`;
}

// ---------------------------------------------------------------- liabilities

export interface Liabilities {
  /** Net deposits plus net adjustments: what came into the real book from outside. */
  cameIn: number;
  /** Player balances, platform, escrow and payouts waiting: where it sits now. */
  heldNow: number;
  difference: number;
}

/** Real book only: money in from outside vs where it is now (they should be equal). */
export function liabilities(s: {
  playerBalances: number;
  platformBalance: number;
  heldInEscrow: number;
  deposits: { amount: number };
  withdrawals: { paid: { amount: number }; pending: { amount: number } };
  adjustments: { net: number };
}): Liabilities {
  const cameIn = s.deposits.amount - s.withdrawals.paid.amount + s.adjustments.net;
  const heldNow = s.playerBalances + s.platformBalance + s.heldInEscrow + s.withdrawals.pending.amount;
  return { cameIn, heldNow, difference: heldNow - cameIn };
}

// ---------------------------------------------------------------- ledger filters (URL)

export const TXN_KINDS = ["deposit", "withdrawal", "withdrawal-refund", "hold", "release", "win", "fee", "adjust", "faucet"] as const;
export const WALLET_TABS = ["transactions", "escrows", "adjustments"] as const;
export type WalletTab = (typeof WALLET_TABS)[number];
export const ESCROW_FILTERS = ["all", "held", "settled", "refunded"] as const;
export type EscrowFilter = (typeof ESCROW_FILTERS)[number];
export const LEDGER_PAGE_SIZE = 50;

export interface LedgerParams {
  tab: WalletTab;
  kinds: string[];
  profileId: string;
  /** Addis Ababa days "YYYY-MM-DD", or "". */
  from: string;
  to: string;
  q: string;
  status: EscrowFilter;
  page: number;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const oneOf = <T extends string>(raw: string | null, allowed: readonly T[]): T | null =>
  raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;

/** The wallet screen's state from the URL; unknown values fall back to the defaults. Pages count from 1 in the URL. */
export function parseLedgerParams(get: (key: string) => string | null): LedgerParams {
  const page = Number.parseInt(get("page") ?? "", 10);
  const kinds = (get("kind") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => (TXN_KINDS as readonly string[]).includes(k));
  const day = (k: string) => {
    const v = (get(k) ?? "").trim();
    return addisDayStart(v) === null ? "" : v;
  };
  return {
    tab: oneOf(get("tab"), WALLET_TABS) ?? "transactions",
    kinds: [...new Set(kinds)],
    profileId: (get("profileId") ?? "").trim(),
    from: day("from"),
    to: day("to"),
    q: (get("q") ?? "").trim(),
    status: oneOf(get("status"), ESCROW_FILTERS) ?? "all",
    page: Number.isFinite(page) && page > 1 ? page - 1 : 0,
  };
}

/** Addis Ababa is UTC+3 all year (no daylight saving). */
const ADDIS_OFFSET_MS = 3 * HOUR;

/** "2026-11-15" (an Addis day) → the first ms of that day; null for a bad day. */
export function addisDayStart(day: string): number | null {
  if (!DAY_RE.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (new Date(ms).toISOString().slice(0, 10) !== day) return null;
  return ms - ADDIS_OFFSET_MS;
}

/** "2026-11-15" → the last ms of that Addis day (the API's `to` is inclusive). */
export function addisDayEnd(day: string): number | null {
  const start = addisDayStart(day);
  return start === null ? null : start + DAY_MS - 1;
}

/** Today's Addis day "YYYY-MM-DD". */
export const addisToday = (now = Date.now()): string => new Date(now + ADDIS_OFFSET_MS).toISOString().slice(0, 10);

/** The GET wallet/transactions query for the filters (no page or limit). The adjustments tab is kind=adjust. */
export function ledgerQuery(p: Pick<LedgerParams, "tab" | "kinds" | "profileId" | "from" | "to" | "q">, book: Book): Record<string, string | number> {
  const q: Record<string, string | number> = { book };
  const kinds = p.tab === "adjustments" ? ["adjust"] : p.kinds;
  if (kinds.length) q.kind = kinds.join(",");
  if (p.profileId) q.profileId = p.profileId;
  const from = p.from ? addisDayStart(p.from) : null;
  const to = p.to ? addisDayEnd(p.to) : null;
  if (from !== null) q.from = from;
  if (to !== null) q.to = to;
  if (p.q) q.q = p.q;
  return q;
}

/** True when a filter narrows the transaction list (the tab's own preset does not count). */
export const ledgerFiltered = (p: Pick<LedgerParams, "kinds" | "profileId" | "from" | "to" | "q">): boolean =>
  p.kinds.length > 0 || Boolean(p.profileId || p.from || p.to || p.q);

// ---------------------------------------------------------------- CSV

const iso = (ts: number | null | undefined) => (ts == null ? "" : new Date(ts).toISOString());

/** Columns of the ledger export: money in birr as numbers, times as ISO (UTC). */
export const TXN_CSV_COLUMNS: CsvColumn<TxnRow>[] = [
  { header: "time", value: (t) => iso(t.ts) },
  { header: "seq", value: (t) => t.seq },
  { header: "book", value: (t) => t.book },
  { header: "txn id", value: (t) => t.id },
  { header: "player id", value: (t) => t.profileId },
  { header: "player", value: (t) => (t.profileId === "platform" ? "Platform" : (t.name ?? "")) },
  { header: "username", value: (t) => t.username ?? "" },
  { header: "kind", value: (t) => t.kind },
  { header: "amount birr", value: (t) => t.amount / 100 },
  { header: "balance after birr", value: (t) => t.balance / 100 },
  { header: "ref", value: (t) => t.ref ?? "" },
  { header: "note", value: (t) => t.note ?? "" },
  { header: "by", value: (t) => t.by ?? "" },
];

/** "ledger-real-2026-11-16-adjust-player.csv" from what is being exported. */
export function ledgerFilename(p: Pick<LedgerParams, "tab" | "kinds" | "profileId" | "from" | "to" | "q">, book: Book, now = Date.now()): string {
  const parts = ["ledger", book, new Date(now).toISOString().slice(0, 10)];
  const kinds = p.tab === "adjustments" ? ["adjust"] : p.kinds;
  if (kinds.length) parts.push(kinds.join("+"));
  if (p.profileId) parts.push(p.profileId === "platform" ? "platform" : "player");
  if (p.from || p.to) parts.push(`${p.from || "start"}_to_${p.to || "now"}`);
  if (p.q) parts.push("search");
  return `${parts.join("-")}.csv`;
}

// ---------------------------------------------------------------- deposit and withdrawal lists

export const DEPOSIT_TABS = ["review", "checking", "credited", "rejected", "all"] as const;
export type DepositTab = (typeof DEPOSIT_TABS)[number];
export const DEPOSIT_TAB_LABELS: Record<DepositTab, string> = { review: "In review", checking: "Checking", credited: "Credited", rejected: "Rejected", all: "All" };

export const WITHDRAWAL_TABS = ["pending", "paid", "rejected", "cancelled", "all"] as const;
export type WithdrawalTab = (typeof WITHDRAWAL_TABS)[number];
export const WITHDRAWAL_TAB_LABELS: Record<WithdrawalTab, string> = { pending: "Pending", paid: "Paid", rejected: "Rejected", cancelled: "Cancelled", all: "All" };

/** The tab from the URL, or the default: the waiting queue when it has rows (or before the count is known), else All. */
export function pickTab<T extends string>(raw: string | null, tabs: readonly T[], queue: T, queueCount: number | null): T {
  const hit = oneOf(raw, tabs);
  if (hit) return hit;
  if (queueCount === null || queueCount > 0) return queue;
  return "all" as T;
}
