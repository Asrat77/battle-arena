import assert from "node:assert/strict";
import { test } from "node:test";
import {
  birr,
  compact,
  compactBirr,
  dateShort,
  dateTime,
  dayLabel,
  duration,
  num,
  percentChange,
  shortId,
  signedBirr,
  timeAgo,
  trendOf,
  unitFor,
} from "./format";

const M = "−";

test("birr formats santim with grouping and two decimals", () => {
  assert.equal(birr(123450), "1,234.50");
  assert.equal(birr(0), "0.00");
  assert.equal(birr(5), "0.05");
  assert.equal(birr(-250), `${M}2.50`);
  assert.equal(birr(null), "–");
  assert.equal(unitFor("real"), "ETB");
  assert.equal(unitFor("play"), "play");
});

test("signed amounts carry + or a minus sign", () => {
  assert.equal(signedBirr(100000), "+1,000.00");
  assert.equal(signedBirr(-1), `${M}0.01`);
  assert.equal(signedBirr(0), "0.00");
});

test("compact numbers for KPIs and axes", () => {
  assert.equal(compact(0), "0");
  assert.equal(compact(980), "980");
  assert.equal(compact(18_100), "18.1k");
  assert.equal(compact(18_149), "18.1k");
  assert.equal(compact(250_000), "250k");
  assert.equal(compact(2_400_000), "2.4M");
  assert.equal(compact(-1500), `${M}1.5k`);
  assert.equal(compactBirr(1_812_345), "18.1k");
  assert.equal(compactBirr(45_000), "450");
  assert.equal(compactBirr(45_050), "450.50");
  assert.equal(num(1234567), "1,234,567");
});

test("percent change, with 'new' when there was nothing before", () => {
  assert.equal(percentChange(0.124), "+12.4%");
  assert.equal(percentChange(-0.03), `${M}3.0%`);
  assert.equal(percentChange(0), "0%");
  assert.equal(percentChange(null, 5), "new");
  assert.equal(percentChange(null, 0), "0%");
  assert.equal(percentChange(12.5), "+1,250%");
  assert.equal(percentChange(7.051), "+705%");
  assert.equal(percentChange(-1.5), `${M}150%`);
  assert.equal(percentChange(0.999), "+99.9%");
  assert.equal(percentChange(250), "+9,999%+");
  assert.equal(trendOf(0.1), "up");
  assert.equal(trendOf(-0.1), "down");
  assert.equal(trendOf(null, 0), "flat");
  assert.equal(trendOf(null, 3), "up");
});

test("dates are shown in Addis Ababa time", () => {
  // 2026-11-15 19:41 UTC = 22:41 in Addis Ababa (UTC+3)
  const ts = Date.UTC(2026, 10, 15, 19, 41);
  assert.equal(dateTime(ts), "15 Nov, 22:41");
  // 22:30 UTC on the 15th is already the 16th in Addis Ababa
  assert.equal(dateShort(Date.UTC(2026, 10, 15, 22, 30)), "16 Nov");
  assert.equal(dateShort(ts, true), "15 Nov 2026");
  assert.equal(dayLabel("2026-11-05"), "5 Nov");
  assert.equal(dayLabel("bad"), "bad");
});

test("time ago and durations", () => {
  const now = Date.UTC(2026, 10, 15, 12);
  assert.equal(timeAgo(now - 10_000, now), "just now");
  assert.equal(timeAgo(now - 5 * 60_000, now), "5m ago");
  assert.equal(timeAgo(now - 3 * 3600_000, now), "3h ago");
  assert.equal(timeAgo(now - 2 * 86400_000, now), "2d ago");
  assert.equal(timeAgo(now - 20 * 86400_000, now), "26 Oct");
  assert.equal(duration(42_000), "42s");
  assert.equal(duration(185_000), "3m 05s");
  assert.equal(duration(4_320_000), "1h 12m");
  assert.equal(duration(42_120_000), "11h 42m");
  assert.equal(duration(2 * 86400_000 + 4 * 3600_000), "2d 4h");
  assert.equal(duration(-1), "–");
});

test("short ids keep the head and tail", () => {
  assert.equal(shortId("0x12ab34cd56ef9f3c"), "0x12ab…9f3c");
  assert.equal(shortId("abc"), "abc");
  assert.equal(shortId(""), "–");
});
