// Number, money, date and id formatting for the admin site. Money arrives in
// whole santim (100 per birr); dates show in Addis Ababa time whatever the
// browser's zone, because that is the business day the API buckets by.

export type Book = "real" | "play";

export const TIME_ZONE = "Africa/Addis_Ababa";
const MINUS = "−";

const grouped2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const grouped0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Santim → "1,234.50" (no unit; pair it with `unitFor(book)`). Negative uses a real minus sign. */
export function birr(santim: number | null | undefined): string {
  if (santim == null || !Number.isFinite(santim)) return "–";
  const s = grouped2.format(Math.abs(santim) / 100);
  return santim < 0 ? `${MINUS}${s}` : s;
}

/** "+1,234.50" / "−1,234.50" / "0.00". */
export function signedBirr(santim: number | null | undefined): string {
  if (santim == null || !Number.isFinite(santim)) return "–";
  if (santim > 0) return `+${birr(santim)}`;
  return birr(santim);
}

/** The unit label beside a money value. */
export function unitFor(book: Book): string {
  return book === "play" ? "play" : "ETB";
}

/** "1,234" */
export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  const s = grouped0.format(Math.abs(n));
  return n < 0 ? `${MINUS}${s}` : s;
}

/** "980", "18.1k", "2.4M": for KPI values and chart axes. */
export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : "";
  const one = (x: number) => {
    const r = x >= 100 ? Math.round(x).toString() : (Math.round(x * 10) / 10).toString();
    return r;
  };
  if (a < 1000) return sign + (Number.isInteger(a) ? a.toString() : (Math.round(a * 10) / 10).toString());
  if (a < 999_950) return `${sign}${one(a / 1000)}k`;
  if (a < 999_950_000) return `${sign}${one(a / 1_000_000)}M`;
  return `${sign}${one(a / 1_000_000_000)}B`;
}

/** Santim in compact birr: 1_812_345 santim → "18.1k". */
export function compactBirr(santim: number | null | undefined): string {
  if (santim == null || !Number.isFinite(santim)) return "–";
  const b = santim / 100;
  if (Math.abs(b) < 1000) return birr(santim).replace(/\.00$/, "");
  return compact(b);
}

/**
 * Period change as text: "+12.4%", "−3.0%", "0%", or "new" when there was
 * nothing before (previous 0 or unknown) but there is now. `change` is the
 * API's ratio ((value − previous) / previous) or null.
 */
export function percentChange(change: number | null | undefined, value?: number): string {
  if (change == null || !Number.isFinite(change)) return value === 0 ? "0%" : "new";
  if (change === 0) return "0%";
  const pct = Math.abs(change * 100);
  const s = pct >= 1000 ? grouped0.format(pct) : pct.toFixed(1);
  return `${change > 0 ? "+" : MINUS}${s}%`;
}

/** Up, down or flat, for colouring a change chip. */
export function trendOf(change: number | null | undefined, value?: number): "up" | "down" | "flat" {
  if (change == null || !Number.isFinite(change)) return value ? "up" : "flat";
  return change > 0 ? "up" : change < 0 ? "down" : "flat";
}

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const fullFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short" });
const dayYearFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" });

function parts(fmt: Intl.DateTimeFormat, ts: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(ts)) out[p.type] = p.value;
  return out;
}

/** "15 Nov, 22:41" in Addis Ababa time. */
export function dateTime(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return "–";
  const p = parts(dateTimeFmt, ts);
  return `${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

/** "Sat, 15 Nov 2026, 22:41:07 (Addis Ababa)" for title tooltips. */
export function fullDate(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return "";
  const p = parts(fullFmt, ts);
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}:${p.second} (Addis Ababa)`;
}

/** "15 Nov", or "15 Nov 2025" with `year`. */
export function dateShort(ts: number | null | undefined, year = false): string {
  if (ts == null || !Number.isFinite(ts)) return "–";
  return (year ? dayYearFmt : dayFmt).format(ts);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A series day key "2026-11-15" → "15 Nov" (no time zone maths: the key is already local). */
export function dayLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** Hour of day (0..23) in Addis Ababa, for the greeting. */
export function addisHour(ts: number): number {
  return Number(hourFmt.format(ts)) % 24;
}

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (ts == null || !Number.isFinite(ts)) return "–";
  const s = Math.round((now - ts) / 1000);
  if (s < -60) return `in ${duration(ts - now)}`;
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return dateShort(ts, d > 300);
}

/** Milliseconds → "42s", "3m 05s", "1h 12m", "2d 4h". */
export function duration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "–";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** A long id shortened in the middle: "0x12ab…9f3c", "dep_8f2a…41c0". Short ids stay whole. */
export function shortId(id: string | null | undefined, head = 6, tail = 4): string {
  if (!id) return "–";
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
