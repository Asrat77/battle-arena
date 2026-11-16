// Pure calculations behind the overview screen: net flow, which series each
// chart metric plots, the CSV export rows, the "needs attention" items and the
// labels for wallet transaction kinds. No React and no fetching, so it is tested alone.

import type { CsvColumn } from "./csv";
import { birr, compactBirr, compact, dayLabel, num, type Book } from "./format";
import type { Overview, SeriesDay, Tally } from "./types";

/** Deposits minus withdrawals for one day (santim, signed). */
export const netOf = (d: Pick<SeriesDay, "deposits" | "withdrawals">) => d.deposits - d.withdrawals;

/** Net flow per day, oldest first. */
export const netFlowSeries = (series: readonly SeriesDay[]): number[] => series.map(netOf);

/** Net flow over the whole range: all deposits minus all withdrawals. */
export const netFlowTotal = (series: readonly SeriesDay[]): number => series.reduce((a, d) => a + netOf(d), 0);

/** Net flow of the previous period from the KPIs (value - previous), as a ratio change; null when it was 0. */
export function netFlowChange(kpis: Pick<Overview["kpis"], "deposits" | "withdrawals">): number | null {
  const now = kpis.deposits.value - kpis.withdrawals.value;
  const before = kpis.deposits.previous - kpis.withdrawals.previous;
  if (before === 0) return null;
  return (now - before) / Math.abs(before);
}

// ---------------------------------------------------------------- chart metrics

export const METRICS = ["active", "matches", "stake", "fees", "money"] as const;
export type Metric = (typeof METRICS)[number];

export interface ChartSeriesDef {
  name: string;
  tone: "primary" | "soft" | "grey";
}

export interface ChartModel {
  metric: Metric;
  /** Money metrics are santim and are formatted in birr. */
  money: boolean;
  series: ChartSeriesDef[];
  /** One point per day, oldest first; `values` line up with `series` (bottom first). */
  points: { day: string; label: string; values: number[] }[];
  /** The number shown in the card header (a sum over the range, or the range's active players from the KPI). */
  total: number;
  /** What the total means, e.g. "in 30 days". */
  totalNote: string;
  title: string;
}

/** The chart label of a day: the last one is "Today" (with tz=180 it is today in Addis time). */
export function chartLabel(day: string, isLast: boolean): string {
  return isLast ? "Today" : dayLabel(day);
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function chartModel(metric: Metric, series: readonly SeriesDay[], days: number, kpis?: Overview["kpis"]): ChartModel {
  const last = series.length - 1;
  const pick = (fn: (d: SeriesDay) => number[]) =>
    series.map((d, i) => ({ day: d.day, label: chartLabel(d.day, i === last), values: fn(d) }));
  const note = `in ${days} days`;
  switch (metric) {
    case "active":
      return {
        metric,
        money: false,
        series: [
          { name: "Returning", tone: "primary" },
          { name: "New", tone: "grey" },
        ],
        points: pick((d) => [d.returningActive, d.newActive]),
        // Distinct people over the whole range (a person active on 5 days counts once), so it comes from the KPI.
        total: kpis ? kpis.activePlayers.value : Math.max(0, ...series.map((d) => d.activePlayers)),
        totalNote: note,
        title: `Active players per day, last ${days} days`,
      };
    case "matches":
      return {
        metric,
        money: false,
        series: [
          { name: "Vs human", tone: "primary" },
          { name: "Vs bot", tone: "grey" },
        ],
        points: pick((d) => [d.matchesVsHuman, d.matchesVsBot]),
        total: sum(series.map((d) => d.matches)),
        totalNote: note,
        title: `Matches per day, last ${days} days`,
      };
    case "stake":
      return {
        metric,
        money: true,
        series: [{ name: "Stake volume", tone: "primary" }],
        points: pick((d) => [d.stakeVolume]),
        total: sum(series.map((d) => d.stakeVolume)),
        totalNote: note,
        title: `Stake volume per day, last ${days} days`,
      };
    case "fees":
      return {
        metric,
        money: true,
        series: [{ name: "Fees", tone: "primary" }],
        points: pick((d) => [d.fees]),
        total: sum(series.map((d) => d.fees)),
        totalNote: note,
        title: `Platform fees per day, last ${days} days`,
      };
    case "money":
      return {
        metric,
        money: true,
        series: [
          { name: "Deposits", tone: "primary" },
          { name: "Withdrawals", tone: "grey" },
        ],
        points: pick((d) => [d.deposits, d.withdrawals]),
        total: netFlowTotal(series),
        totalNote: `net in ${days} days`,
        title: `Deposits and withdrawals per day, last ${days} days`,
      };
  }
}

/** Header number: money in birr, counts as plain numbers (net flow carries its sign). */
export function chartTotalText(m: Pick<ChartModel, "money" | "total" | "metric">): string {
  if (!m.money) return num(m.total);
  const s = birr(Math.abs(m.total));
  if (m.metric === "money" && m.total !== 0) return `${m.total > 0 ? "+" : "−"}${s}`;
  return s;
}

/** Y axis label for a chart: compact birr for money (the chart values are santim). */
export function axisFormatFor(money: boolean) {
  if (!money) return (v: number) => compact(v);
  // Two decimals under 10k so quarter ticks read "1.25k", not "1.3k".
  return (santim: number) => {
    const b = santim / 100;
    if (Math.abs(b) >= 1000 && Math.abs(b) < 10_000) return `${Number((b / 1000).toFixed(2))}k`;
    return compactBirr(santim);
  };
}
/** Tooltip value: birr with 2 decimals for money. */
export const valueFormatFor = (money: boolean) => (v: number) => (money ? birr(v) : num(v));

/** True when the metric has nothing to draw (all zero), so the card can say so. */
export const chartIsEmpty = (m: ChartModel) => m.points.every((p) => p.values.every((v) => v === 0));

// ---------------------------------------------------------------- CSV export

/** Money columns are birr with 2 decimals ("12.50", "-3.00"); csvCell leaves plain numeric text alone. */
const birrText = (santim: number) => (santim / 100).toFixed(2);

/** One column per SeriesDay field, plus the net flow. Money as birr with 2 decimals. */
export const CSV_COLUMNS: CsvColumn<SeriesDay>[] = [
  { header: "day", value: (d) => d.day },
  { header: "signups", value: (d) => d.signups },
  { header: "active_players", value: (d) => d.activePlayers },
  { header: "new_active", value: (d) => d.newActive },
  { header: "returning_active", value: (d) => d.returningActive },
  { header: "matches", value: (d) => d.matches },
  { header: "matches_vs_bot", value: (d) => d.matchesVsBot },
  { header: "matches_vs_human", value: (d) => d.matchesVsHuman },
  { header: "stake_volume_birr", value: (d) => birrText(d.stakeVolume) },
  { header: "fees_birr", value: (d) => birrText(d.fees) },
  { header: "deposits_birr", value: (d) => birrText(d.deposits) },
  { header: "deposit_count", value: (d) => d.depositCount },
  { header: "withdrawals_birr", value: (d) => birrText(d.withdrawals) },
  { header: "withdrawal_count", value: (d) => d.withdrawalCount },
  { header: "net_flow_birr", value: (d) => birrText(netOf(d)) },
];

/** The daily series as CSV rows (oldest first). */
export const csvRows = (series: readonly SeriesDay[]): SeriesDay[] => [...series];

/** "battle-arena-overview-30d-real-2026-11-16.csv"; the date is the last day of the series (today in Addis). */
export function csvFilename(days: number, book: Book, series: readonly SeriesDay[], fallbackDay?: string): string {
  const day = series.length ? series[series.length - 1].day : (fallbackDay ?? "export");
  return `battle-arena-overview-${days}d-${book}-${day}.csv`;
}

// ---------------------------------------------------------------- needs attention

export type AttentionTone = "alert" | "warn" | "ok" | "neutral";

export interface AttentionItem {
  id: "deposits" | "withdrawals" | "books" | "writes" | "live";
  tone: AttentionTone;
  label: string;
  /** Main text, e.g. "3 in review". */
  text: string;
  /** Secondary text, e.g. "1,200.00 ETB". */
  detail?: string;
  href: string;
}

export interface ReconcileLite {
  ok: boolean;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function tallyItem(id: "deposits" | "withdrawals", t: Tally): AttentionItem | null {
  if (t.count <= 0) return null;
  return id === "deposits"
    ? {
        id,
        tone: "warn",
        label: "Deposits",
        text: `${num(t.count)} in review`,
        detail: `${birr(t.amount)} ETB`,
        href: "/admin/deposits?status=review",
      }
    : {
        id,
        tone: "warn",
        label: "Withdrawals",
        text: `${num(t.count)} pending`,
        detail: `${birr(t.amount)} ETB`,
        href: "/admin/withdrawals?status=pending",
      };
}

/**
 * Items that need action (amber or red), in the order of the strip. `reconcile` is
 * null until the first answer (nothing is shown for it then) or when it failed.
 */
export function attentionItems(now: Overview["now"], reconcile: ReconcileLite | null): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (reconcile && !reconcile.ok) {
    out.push({ id: "books", tone: "alert", label: "", text: "Books do not balance", href: "/admin/reconcile" });
  }
  const dep = tallyItem("deposits", now.depositsInReview);
  if (dep) out.push(dep);
  const wd = tallyItem("withdrawals", now.pendingWithdrawals);
  if (wd) out.push(wd);
  if (now.pendingWrites > 0) {
    out.push({
      id: "writes",
      tone: "warn",
      label: "Saving",
      text: `${num(now.pendingWrites)} unsaved ${plural(now.pendingWrites, "write", "writes")}`,
      href: "/admin/system",
    });
  }
  return out;
}

/** The calm chips that sit beside the attention items: books status (when fine) and live now. */
export function calmItems(now: Overview["now"], reconcile: ReconcileLite | null): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (reconcile?.ok) out.push({ id: "books", tone: "ok", label: "", text: "Books balance", href: "/admin/reconcile" });
  out.push({
    id: "live",
    tone: "neutral",
    label: "Live now",
    text: `${num(now.online)} online`,
    detail: `${num(now.liveMatches)} live · ${num(now.queued)} queued`,
    href: "/admin/matches",
  });
  return out;
}

/** True when nothing needs the owner (the strip shows "Nothing needs you right now"). */
export const allClear = (now: Overview["now"], reconcile: ReconcileLite | null) => attentionItems(now, reconcile).length === 0;

// ---------------------------------------------------------------- wallet transaction kinds

const KIND_LABELS: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  "withdrawal-refund": "Withdrawal refund",
  hold: "Stake held",
  win: "Win",
  fee: "Fee",
  release: "Refund",
  faucet: "Faucet",
  adjust: "Adjustment",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/-/g, " ");
}

/** The tone a kind's pill dot takes (matches StatusPill tones). */
export function kindTone(kind: string): "success" | "pending" | "review" | "rejected" | "refunded" | "neutral" {
  switch (kind) {
    case "deposit":
    case "win":
      return "success";
    case "withdrawal":
      return "review";
    case "hold":
      return "pending";
    case "fee":
      return "neutral";
    case "release":
    case "withdrawal-refund":
      return "refunded";
    case "adjust":
      return "review";
    default:
      return "neutral";
  }
}

// ---------------------------------------------------------------- players card

export interface PlayerSplit {
  total: number;
  registered: number;
  guests: number;
  /** 0..1 */
  registeredShare: number;
}

export function playerSplit(t: Pick<Overview["totals"], "players" | "registered" | "guests">): PlayerSplit {
  const total = t.players;
  return { total, registered: t.registered, guests: t.guests, registeredShare: total > 0 ? Math.min(1, t.registered / total) : 0 };
}

/** "12s ago" style age for the "Updated" label (seconds below a minute, then minutes). */
export function updatedAgo(ts: number | null, now: number): string {
  if (ts == null) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}
