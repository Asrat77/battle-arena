// Pure functions for the admin overview: day buckets in a fixed UTC offset (Addis Ababa
// by default), the zero-filled per-day series, period-over-period change and per-game
// tallies. Data in, numbers out: no Express, no store, no modules, so every rule here
// can be tested with plain arrays. adminInsights.ts gathers the inputs.

export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;
export const DEFAULT_TZ = 180;
export const MAX_DAYS = 180;
export const DEFAULT_DAYS = 30;

/** A number from a query value, clamped to lo..hi, or the fallback when it is not a number. */
export function clampInt(raw: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof raw === "string" || typeof raw === "number" ? Math.floor(Number(raw)) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/** The local calendar day ("YYYY-MM-DD") of a timestamp, `tz` minutes east of UTC. */
export function dayKey(ts: number, tz: number): string {
  return new Date(ts + tz * MINUTE_MS).toISOString().slice(0, 10);
}

/** UTC ms of the local midnight that starts the day containing `ts`. */
export function dayStart(ts: number, tz: number): number {
  return Math.floor((ts + tz * MINUTE_MS) / DAY_MS) * DAY_MS - tz * MINUTE_MS;
}

export interface Range {
  days: number;
  /** Start of the first day (inclusive), ms. */
  from: number;
  /** End of the last day, which is today (exclusive), ms. */
  to: number;
  tz: number;
  /** Start of the previous period of the same length (it ends where this one starts). */
  prevFrom: number;
}

/** The `days` local days ending with the day that contains `now`. A fixed offset has no DST, so a day is 24 h. */
export function rangeOf(now: number, days: number, tz: number): Range {
  const to = dayStart(now, tz) + DAY_MS;
  const from = to - days * DAY_MS;
  return { days, from, to, tz, prevFrom: from - days * DAY_MS };
}

/** The day keys of a range, oldest first. */
export function dayKeys(range: Pick<Range, "from" | "days" | "tz">): string[] {
  return Array.from({ length: range.days }, (_, i) => dayKey(range.from + i * DAY_MS, range.tz));
}

/** (value - previous) / previous, or null when there is nothing to compare with. */
export function periodChange(value: number, previous: number): number | null {
  return previous === 0 ? null : (value - previous) / previous;
}

export interface Kpi {
  value: number;
  previous: number;
  change: number | null;
}

export const kpi = (value: number, previous: number): Kpi => ({ value, previous, change: periodChange(value, previous) });

export interface Stamped {
  ts: number;
  /** Santim (or 1 for a plain count). */
  amount: number;
}

export interface MatchEvent {
  gameId: string;
  endedAt: number;
  /** Distinct human players only (no bot seat). */
  humans: string[];
  /** One seat was the bot. */
  bot: boolean;
  staked: boolean;
}

export interface Joined {
  id: string;
  createdAt: number;
}

const within = (ts: number, from: number, to: number) => ts >= from && ts < to;

/** Sum of `amount` for events with from <= ts < to. */
export function sumIn(events: Stamped[], from: number, to: number): number {
  let sum = 0;
  for (const e of events) if (within(e.ts, from, to)) sum += e.amount;
  return sum;
}

/** Players who finished a match with from <= endedAt < to (bots excluded by the caller). */
export function activeIn(matches: MatchEvent[], from: number, to: number): Set<string> {
  const out = new Set<string>();
  for (const m of matches) if (within(m.endedAt, from, to)) for (const id of m.humans) out.add(id);
  return out;
}

export function countIn(matches: MatchEvent[], from: number, to: number): number {
  return matches.reduce((n, m) => n + (within(m.endedAt, from, to) ? 1 : 0), 0);
}

export interface SeriesDay {
  day: string;
  signups: number;
  activePlayers: number;
  /** Active that day and signed up that same day. */
  newActive: number;
  returningActive: number;
  matches: number;
  matchesVsBot: number;
  matchesVsHuman: number;
  stakeVolume: number;
  fees: number;
  deposits: number;
  depositCount: number;
  withdrawals: number;
  withdrawalCount: number;
}

export interface SeriesInput {
  range: Pick<Range, "from" | "days" | "tz">;
  profiles: Joined[];
  matches: MatchEvent[];
  stakes: Stamped[];
  fees: Stamped[];
  deposits: Stamped[];
  withdrawals: Stamped[];
}

/** One entry per day of the range, oldest first. Days with nothing in them are all zeros. */
export function buildSeries(input: SeriesInput): SeriesDay[] {
  const { range } = input;
  const keys = dayKeys(range);
  const days = new Map<string, SeriesDay>(
    keys.map((day) => [
      day,
      { day, signups: 0, activePlayers: 0, newActive: 0, returningActive: 0, matches: 0, matchesVsBot: 0, matchesVsHuman: 0, stakeVolume: 0, fees: 0, deposits: 0, depositCount: 0, withdrawals: 0, withdrawalCount: 0 },
    ]),
  );
  const at = (ts: number) => days.get(dayKey(ts, range.tz));
  const signedUpOn = new Map<string, string>();
  for (const p of input.profiles) {
    signedUpOn.set(p.id, dayKey(p.createdAt, range.tz));
    const d = at(p.createdAt);
    if (d) d.signups++;
  }
  const activeByDay = new Map<string, Set<string>>();
  for (const m of input.matches) {
    const d = at(m.endedAt);
    if (!d) continue;
    d.matches++;
    if (m.bot) d.matchesVsBot++;
    else d.matchesVsHuman++;
    const set = activeByDay.get(d.day) ?? new Set<string>();
    for (const id of m.humans) set.add(id);
    activeByDay.set(d.day, set);
  }
  for (const [day, set] of activeByDay) {
    const d = days.get(day)!;
    d.activePlayers = set.size;
    for (const id of set) if (signedUpOn.get(id) === day) d.newActive++;
    d.returningActive = d.activePlayers - d.newActive;
  }
  for (const e of input.stakes) {
    const d = at(e.ts);
    if (d) d.stakeVolume += e.amount;
  }
  for (const e of input.fees) {
    const d = at(e.ts);
    if (d) d.fees += e.amount;
  }
  for (const e of input.deposits) {
    const d = at(e.ts);
    if (d) {
      d.deposits += e.amount;
      d.depositCount++;
    }
  }
  for (const e of input.withdrawals) {
    const d = at(e.ts);
    if (d) {
      d.withdrawals += e.amount;
      d.withdrawalCount++;
    }
  }
  return keys.map((k) => days.get(k)!);
}

export interface Kpis {
  newPlayers: Kpi;
  activePlayers: Kpi;
  matches: Kpi;
  stakeVolume: Kpi;
  fees: Kpi;
  deposits: Kpi;
  withdrawals: Kpi;
}

/** Each KPI for the range and for the same-length period right before it. */
export function buildKpis(input: Omit<SeriesInput, "range"> & { range: Range }): Kpis {
  const { range: r } = input;
  const both = <T>(f: (from: number, to: number) => T): [T, T] => [f(r.from, r.to), f(r.prevFrom, r.from)];
  const pair = (f: (from: number, to: number) => number): Kpi => kpi(...both(f));
  return {
    newPlayers: pair((a, b) => input.profiles.filter((p) => within(p.createdAt, a, b)).length),
    activePlayers: pair((a, b) => activeIn(input.matches, a, b).size),
    matches: pair((a, b) => countIn(input.matches, a, b)),
    stakeVolume: pair((a, b) => sumIn(input.stakes, a, b)),
    fees: pair((a, b) => sumIn(input.fees, a, b)),
    deposits: pair((a, b) => sumIn(input.deposits, a, b)),
    withdrawals: pair((a, b) => sumIn(input.withdrawals, a, b)),
  };
}

export interface GameTotal {
  gameId: string;
  gameName: string;
  matches: number;
  /** How many of those matches had a stake. */
  staked: number;
}

/** Matches per game with from <= endedAt < to, most played first (ties by game id). */
export function byGame(matches: MatchEvent[], from: number, to: number, nameOf: (gameId: string) => string): GameTotal[] {
  const by = new Map<string, GameTotal>();
  for (const m of matches) {
    if (!within(m.endedAt, from, to)) continue;
    const t = by.get(m.gameId) ?? { gameId: m.gameId, gameName: nameOf(m.gameId), matches: 0, staked: 0 };
    t.matches++;
    if (m.staked) t.staked++;
    by.set(m.gameId, t);
  }
  return [...by.values()].sort((a, b) => b.matches - a.matches || a.gameId.localeCompare(b.gameId));
}
