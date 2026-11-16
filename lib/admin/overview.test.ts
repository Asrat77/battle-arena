import assert from "node:assert/strict";
import { test } from "node:test";
import { toCsv } from "./csv";
import {
  CSV_COLUMNS,
  attentionItems,
  axisFormatFor,
  calmItems,
  chartIsEmpty,
  chartModel,
  chartTotalText,
  csvFilename,
  kindLabel,
  netFlowChange,
  netFlowSeries,
  netFlowTotal,
  playerSplit,
  updatedAgo,
} from "./overview";
import type { Overview, SeriesDay } from "./types";

const day = (over: Partial<SeriesDay>): SeriesDay => ({
  day: "2026-11-15",
  signups: 0,
  activePlayers: 0,
  newActive: 0,
  returningActive: 0,
  matches: 0,
  matchesVsBot: 0,
  matchesVsHuman: 0,
  stakeVolume: 0,
  fees: 0,
  deposits: 0,
  depositCount: 0,
  withdrawals: 0,
  withdrawalCount: 0,
  ...over,
});

const series = [
  day({ day: "2026-11-14", deposits: 150_000, withdrawals: 50_000, matches: 4, matchesVsBot: 1, matchesVsHuman: 3, stakeVolume: 8000, fees: 800 }),
  day({ day: "2026-11-15", deposits: 0, withdrawals: 20_050, activePlayers: 3, returningActive: 2, newActive: 1 }),
  day({ day: "2026-11-16" }),
];

const now = (over: Partial<Overview["now"]> = {}): Overview["now"] => ({
  online: 2,
  inMatch: 0,
  liveMatches: 1,
  queued: 0,
  pendingWithdrawals: { count: 0, amount: 0 },
  depositsInReview: { count: 0, amount: 0 },
  pendingWrites: 0,
  ...over,
});

test("net flow is deposits minus withdrawals, signed", () => {
  assert.deepEqual(netFlowSeries(series), [100_000, -20_050, 0]);
  assert.equal(netFlowTotal(series), 79_950);
  assert.equal(netFlowTotal([]), 0);
});

test("net flow change compares with the previous period and is null from zero", () => {
  const k = (v: number, p: number) => ({ value: v, previous: p, change: null });
  assert.equal(netFlowChange({ deposits: k(300, 0), withdrawals: k(100, 0) }), null);
  assert.equal(netFlowChange({ deposits: k(300, 200), withdrawals: k(100, 100) }), 1);
});

test("each metric picks its own series and labels the last day Today", () => {
  const m = chartModel("matches", series, 3);
  assert.deepEqual(m.series.map((s) => s.name), ["Vs human", "Vs bot"]);
  assert.deepEqual(m.points[0].values, [3, 1]);
  assert.equal(m.points[2].label, "Today");
  assert.equal(m.points[0].label, "14 Nov");
  assert.equal(m.total, 4);
  assert.equal(m.money, false);

  const money = chartModel("money", series, 3);
  assert.deepEqual(money.points[0].values, [150_000, 50_000]);
  assert.equal(money.money, true);
  assert.equal(money.total, 79_950);

  assert.equal(chartModel("stake", series, 3).total, 8000);
  assert.equal(chartModel("fees", series, 3).total, 800);
});

test("active players total is the distinct count from the KPI when given", () => {
  const kpis = { activePlayers: { value: 9, previous: 0, change: null } } as Overview["kpis"];
  assert.equal(chartModel("active", series, 3, kpis).total, 9);
  assert.deepEqual(chartModel("active", series, 3).points[1].values, [2, 1]);
});

test("header number: birr for money, signed for net flow", () => {
  assert.equal(chartTotalText(chartModel("money", series, 3)), "+799.50");
  assert.equal(chartTotalText(chartModel("stake", series, 3)), "80.00");
  assert.equal(chartTotalText(chartModel("matches", series, 3)), "4");
  assert.equal(chartTotalText({ metric: "money", money: true, total: -500 }), "−5.00");
});

test("an all-zero metric is reported as empty", () => {
  assert.equal(chartIsEmpty(chartModel("fees", [day({}), day({})], 2)), true);
  assert.equal(chartIsEmpty(chartModel("fees", series, 3)), false);
  assert.equal(chartIsEmpty(chartModel("fees", [], 0)), true);
});

test("csv: one row per day, every field, money in birr with 2 decimals", () => {
  const text = toCsv(series, CSV_COLUMNS);
  const lines = text.trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.equal(
    lines[0],
    "day,signups,active_players,new_active,returning_active,matches,matches_vs_bot,matches_vs_human,stake_volume_birr,fees_birr,deposits_birr,deposit_count,withdrawals_birr,withdrawal_count,net_flow_birr",
  );
  assert.equal(lines[1], "2026-11-14,0,0,0,0,4,1,3,80.00,8.00,1500.00,0,500.00,0,1000.00");
  assert.ok(lines[2].endsWith(",200.50,0,-200.50"));
  assert.equal(CSV_COLUMNS.length, Object.keys(series[0]).length + 1);
});

test("csv file name has range, book and the last day", () => {
  assert.equal(csvFilename(30, "real", series), "battle-arena-overview-30d-real-2026-11-16.csv");
  assert.equal(csvFilename(7, "play", [], "x"), "battle-arena-overview-7d-play-x.csv");
});

test("attention: only things that need action, books red when off", () => {
  assert.deepEqual(attentionItems(now(), { ok: true }), []);
  assert.deepEqual(attentionItems(now(), null), []);
  const items = attentionItems(
    now({ depositsInReview: { count: 3, amount: 120_000 }, pendingWithdrawals: { count: 1, amount: 5000 }, pendingWrites: 2 }),
    { ok: false },
  );
  assert.deepEqual(items.map((i) => i.id), ["books", "deposits", "withdrawals", "writes"]);
  assert.equal(items[0].tone, "alert");
  assert.equal(items[1].text, "3 in review");
  assert.equal(items[1].detail, "1,200.00 ETB");
  assert.equal(items[1].href, "/admin/deposits?status=review");
  assert.equal(items[2].href, "/admin/withdrawals?status=pending");
  assert.equal(items[3].text, "2 unsaved writes");
  assert.equal(attentionItems(now({ pendingWrites: 1 }), null)[0].text, "1 unsaved write");
});

test("calm items: books balance and live now", () => {
  const c = calmItems(now({ queued: 2 }), { ok: true });
  assert.deepEqual(c.map((i) => i.id), ["books", "live"]);
  assert.equal(c[1].detail, "1 live · 2 queued");
  assert.deepEqual(calmItems(now(), { ok: false }).map((i) => i.id), ["live"]);
});

test("transaction kinds read as words", () => {
  assert.equal(kindLabel("hold"), "Stake held");
  assert.equal(kindLabel("release"), "Refund");
  assert.equal(kindLabel("adjust"), "Adjustment");
  assert.equal(kindLabel("withdrawal-refund"), "Withdrawal refund");
  assert.equal(kindLabel("something-new"), "Something new");
});

test("player split shares", () => {
  assert.deepEqual(playerSplit({ players: 60, registered: 42, guests: 18 }), { total: 60, registered: 42, guests: 18, registeredShare: 0.7 });
  assert.equal(playerSplit({ players: 0, registered: 0, guests: 0 }).registeredShare, 0);
});

test("updated label", () => {
  assert.equal(updatedAgo(null, 1000), "");
  assert.equal(updatedAgo(0, 2000), "just now");
  assert.equal(updatedAgo(0, 12_000), "12s ago");
  assert.equal(updatedAgo(0, 125_000), "2m ago");
});

test("money axis keeps quarter ticks exact", () => {
  const f = axisFormatFor(true);
  assert.equal(f(125_000), "1.25k");
  assert.equal(f(500_000), "5k");
  assert.equal(f(0), "0");
  assert.equal(f(2_500_000), "25k");
  assert.equal(axisFormatFor(false)(1500), "1.5k");
});
