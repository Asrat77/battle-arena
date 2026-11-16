import assert from "node:assert/strict";
import { test } from "node:test";
import { addisDay, dayHeading, feedTypeParam, groupByDay, hhmm, mergeFeed, parseFeedFilter, prependFresh, rowBook } from "./activity";
import type { ActivityRow } from "./types";

const row = (id: string, ts: number, type: ActivityRow["type"] = "match"): ActivityRow => ({ id, ts, type, title: id, actor: null, amount: null, link: null, meta: {} });
// 2026-11-16 12:00 in Addis (09:00 UTC)
const NOW = Date.UTC(2026, 10, 16, 9, 0);

test("days follow Addis time, not UTC", () => {
  // 22:30 UTC on the 15th is 01:30 on the 16th in Addis
  assert.equal(addisDay(Date.UTC(2026, 10, 15, 22, 30)), "2026-11-16");
  assert.equal(hhmm(Date.UTC(2026, 10, 15, 22, 30)), "01:30");
  assert.equal(addisDay(Date.UTC(2026, 10, 15, 20, 59)), "2026-11-15");
});

test("headings: Today, Yesterday, date, date with a year from another year", () => {
  assert.equal(dayHeading("2026-11-16", NOW), "Today");
  assert.equal(dayHeading("2026-11-15", NOW), "Yesterday");
  assert.equal(dayHeading("2026-11-14", NOW), "14 Nov");
  assert.equal(dayHeading("2025-12-31", NOW), "31 Dec 2025");
});

test("rows group into runs of one day", () => {
  const rows = [row("a", NOW), row("b", NOW - 3_600_000), row("c", NOW - 86_400_000), row("d", NOW - 3 * 86_400_000)];
  const g = groupByDay(rows, NOW);
  assert.deepEqual(g.map((x) => [x.heading, x.rows.length]), [["Today", 2], ["Yesterday", 1], ["13 Nov", 1]]);
  assert.deepEqual(groupByDay([], NOW), []);
});

test("merge dedupes by id and sorts newest first, ties by id", () => {
  const a = [row("x:1", 100), row("x:2", 300)];
  const b = [row("x:2", 300), row("x:0", 100), row("x:3", 200)];
  assert.deepEqual(mergeFeed(a, b).map((r) => r.id), ["x:2", "x:3", "x:1", "x:0"]);
});

test("prepending a refreshed first page counts only new rows and keeps older pages", () => {
  const current = [row("m:3", 300), row("m:2", 200), row("m:1", 100)];
  const fresh = [row("m:4", 400), row("m:3", 300)];
  const r = prependFresh(current, fresh);
  assert.equal(r.added, 1);
  assert.deepEqual(r.rows.map((x) => x.id), ["m:4", "m:3", "m:2", "m:1"]);
  assert.equal(prependFresh(current, current).added, 0);
});

test("filters map to API types", () => {
  assert.equal(parseFeedFilter("deposits"), "deposits");
  assert.equal(parseFeedFilter("zzz"), "all");
  assert.equal(parseFeedFilter(null), "all");
  assert.equal(feedTypeParam("all"), undefined);
  assert.equal(feedTypeParam("adjustments"), "adjust");
  assert.equal(feedTypeParam("signups"), "signup");
});

test("the book of a row", () => {
  assert.equal(rowBook({ meta: { book: "play" } }, "real"), "play");
  assert.equal(rowBook({ meta: {} }, "play"), "play");
});
