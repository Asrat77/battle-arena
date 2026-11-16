// Pure helpers behind the Activity screen: the type chips and the API types they
// stand for, grouping rows by Addis Ababa day, merging a fresh first page into
// what is already shown (deduplicated by row id, newest first), and row looks.
// No React, so it is tested alone.

import { TIME_ZONE, dateShort } from "./format";
import type { IconName } from "@/components/admin/icons";
import type { ActivityRow } from "./types";

export type ActivityType = ActivityRow["type"];

export const FEED_FILTERS = ["all", "signups", "matches", "deposits", "withdrawals", "adjustments", "tournaments", "admin"] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];

export const FEED_LABELS: Record<FeedFilter, string> = {
  all: "All",
  signups: "Signups",
  matches: "Matches",
  deposits: "Deposits",
  withdrawals: "Withdrawals",
  adjustments: "Adjustments",
  tournaments: "Tournaments",
  admin: "Admin",
};

/** The API `type` value for each chip (all = no filter). */
export const FEED_TYPES: Record<FeedFilter, ActivityType | null> = {
  all: null,
  signups: "signup",
  matches: "match",
  deposits: "deposit",
  withdrawals: "withdrawal",
  adjustments: "adjust",
  tournaments: "tournament",
  admin: "admin",
};

/** The ?type= value, or "all" for anything unknown. */
export function parseFeedFilter(raw: string | null): FeedFilter {
  return (FEED_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as FeedFilter) : "all";
}

/** The `type` parameter of GET activity (undefined = every type). */
export const feedTypeParam = (f: FeedFilter): string | undefined => FEED_TYPES[f] ?? undefined;

export const TYPE_ICONS: Record<ActivityType, IconName> = {
  signup: "players",
  match: "matches",
  deposit: "deposits",
  withdrawal: "withdrawals",
  adjust: "wallet",
  tournament: "tournaments",
  admin: "shield",
};

export const TYPE_NAMES: Record<ActivityType, string> = {
  signup: "Signup",
  match: "Match",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  adjust: "Adjustment",
  tournament: "Tournament",
  admin: "Admin",
};

/** Adjustments carry a sign (credit or debit); the other amounts are plain sums. */
export const isSignedAmount = (r: Pick<ActivityRow, "type">): boolean => r.type === "adjust";

/** Which book an amount is in: adjustments say so in meta, everything else follows the top bar. */
export function rowBook(r: Pick<ActivityRow, "meta">, fallback: "real" | "play"): "real" | "play" {
  const b = r.meta?.book;
  return b === "real" || b === "play" ? b : fallback;
}

// ---------------------------------------------------------------- days

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The Addis Ababa calendar day of a time: "2026-11-16". */
export function addisDay(ts: number): string {
  return dayKeyFmt.format(ts);
}

/** "14:05" in Addis Ababa time. */
export function hhmm(ts: number): string {
  return timeFmt.format(ts);
}

/** "Today", "Yesterday", "14 Nov", or "14 Nov 2025" from another year. */
export function dayHeading(key: string, now = Date.now()): string {
  const today = addisDay(now);
  if (key === today) return "Today";
  // Addis has no daylight saving, so a day is always 24 h.
  if (key === addisDay(now - 86_400_000)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  const noon = Date.UTC(y, m - 1, d, 9); // 12:00 in Addis
  return dateShort(noon, key.slice(0, 4) !== today.slice(0, 4));
}

export interface DayGroup {
  day: string;
  heading: string;
  rows: ActivityRow[];
}

/** Rows (already newest first) in runs of the same Addis day. */
export function groupByDay(rows: readonly ActivityRow[], now = Date.now()): DayGroup[] {
  const out: DayGroup[] = [];
  for (const r of rows) {
    const day = addisDay(r.ts);
    const last = out[out.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else out.push({ day, heading: dayHeading(day, now), rows: [r] });
  }
  return out;
}

// ---------------------------------------------------------------- merging

/** Newest first, ties by id descending (the API's order). */
export const byNewest = (a: Pick<ActivityRow, "ts" | "id">, b: Pick<ActivityRow, "ts" | "id">): number =>
  b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Combine lists, keep one row per id (the first list wins), newest first. */
export function mergeFeed(...lists: readonly (readonly ActivityRow[])[]): ActivityRow[] {
  const seen = new Set<string>();
  const out: ActivityRow[] = [];
  for (const list of lists) {
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
  }
  return out.sort(byNewest);
}

/** The refreshed first page merged into what is shown: how many rows are new, and the new list. */
export function prependFresh(current: readonly ActivityRow[], fresh: readonly ActivityRow[]): { rows: ActivityRow[]; added: number } {
  const known = new Set(current.map((r) => r.id));
  const added = fresh.filter((r) => !known.has(r.id)).length;
  return { rows: mergeFeed(fresh, current), added };
}
