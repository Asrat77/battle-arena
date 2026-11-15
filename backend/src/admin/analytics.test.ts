import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildKpis, buildSeries, byGame, clampInt, dayKey, dayKeys, DAY_MS, periodChange, rangeOf, type MatchEvent } from "./analytics";

const T = Date.UTC(2026, 10, 10, 12, 0); // 2026-11-10 12:00 UTC
const m = (endedAt: number, humans: string[], extra: Partial<MatchEvent> = {}): MatchEvent => ({ gameId: "gebeta", endedAt, humans, bot: false, staked: false, ...extra });

describe("day buckets", () => {
  test("an event at 21:30 UTC belongs to the next day at tz=180, and to the same day at tz=0", () => {
    const ts = Date.UTC(2026, 10, 10, 21, 30);
    assert.equal(dayKey(ts, 180), "2026-11-11");
    assert.equal(dayKey(ts, 0), "2026-11-10");
    assert.equal(dayKey(Date.UTC(2026, 10, 10, 20, 59), 180), "2026-11-10");
    assert.equal(dayKey(Date.UTC(2026, 10, 10, 21, 0), 180), "2026-11-11");
    assert.equal(dayKey(Date.UTC(2026, 10, 10, 3, 0), -300), "2026-11-09");
  });

  test("the range ends with today's local day and has `days` keys, oldest first", () => {
    const r = rangeOf(Date.UTC(2026, 10, 10, 22, 0), 7, 180); // already 01:00 on the 11th in Addis
    assert.equal(r.to - r.from, 7 * DAY_MS);
    assert.equal(r.prevFrom, r.from - 7 * DAY_MS);
    const keys = dayKeys(r);
    assert.equal(keys.length, 7);
    assert.equal(keys[6], "2026-11-11");
    assert.equal(keys[0], "2026-11-05");
  });

  test("clampInt clamps and falls back", () => {
    assert.equal(clampInt("500", 1, 180, 30), 180);
    assert.equal(clampInt("0", 1, 180, 30), 1);
    assert.equal(clampInt("abc", 1, 180, 30), 30);
    assert.equal(clampInt(undefined, -720, 840, 180), 180);
    assert.equal(clampInt("-9999", -720, 840, 180), -720);
  });
});

describe("period change", () => {
  test("a fraction of the previous value, null when previous is 0", () => {
    assert.equal(periodChange(150, 100), 0.5);
    assert.equal(periodChange(50, 100), -0.5);
    assert.equal(periodChange(0, 100), -1);
    assert.equal(periodChange(5, 0), null);
    assert.equal(periodChange(0, 0), null);
  });

  test("kpis compare with the period right before", () => {
    const range = rangeOf(T, 2, 0); // Nov 9 and 10; previous Nov 7 and 8
    const at = (day: number, h = 10) => Date.UTC(2026, 10, day, h);
    const k = buildKpis({
      range,
      profiles: [
        { id: "a", createdAt: at(9) },
        { id: "b", createdAt: at(10) },
        { id: "c", createdAt: at(7) },
      ],
      matches: [m(at(9), ["a", "b"]), m(at(10), ["a", "b"]), m(at(8), ["c", "a"]), m(at(8, 11), ["c", "a"]), m(at(8, 12), ["c", "a"]), m(at(1), ["c"])],
      stakes: [{ ts: at(10), amount: 400 }, { ts: at(8), amount: 100 }],
      fees: [{ ts: at(10), amount: 20 }],
      deposits: [{ ts: at(9), amount: 1000 }],
      withdrawals: [],
    });
    assert.deepEqual(k.newPlayers, { value: 2, previous: 1, change: 1 });
    assert.deepEqual(k.matches, { value: 2, previous: 3, change: -1 / 3 });
    assert.deepEqual(k.activePlayers, { value: 2, previous: 2, change: 0 });
    assert.deepEqual(k.stakeVolume, { value: 400, previous: 100, change: 3 });
    assert.deepEqual(k.fees, { value: 20, previous: 0, change: null });
    assert.deepEqual(k.deposits, { value: 1000, previous: 0, change: null });
    assert.deepEqual(k.withdrawals, { value: 0, previous: 0, change: null });
  });
});

describe("series", () => {
  const range = rangeOf(T, 3, 180); // Nov 8, 9, 10 in Addis
  const empty = { profiles: [], matches: [], stakes: [], fees: [], deposits: [], withdrawals: [] };

  test("zero-filled: one entry per day, all zeros with no data", () => {
    const s = buildSeries({ range, ...empty });
    assert.deepEqual(
      s.map((d) => d.day),
      ["2026-11-08", "2026-11-09", "2026-11-10"],
    );
    for (const d of s) assert.deepEqual({ ...d, day: "" }, { day: "", signups: 0, activePlayers: 0, newActive: 0, returningActive: 0, matches: 0, matchesVsBot: 0, matchesVsHuman: 0, stakeVolume: 0, fees: 0, deposits: 0, depositCount: 0, withdrawals: 0, withdrawalCount: 0 });
  });

  test("new vs returning active players, and the bot vs human split", () => {
    const d9 = Date.UTC(2026, 10, 9, 10);
    const d10 = Date.UTC(2026, 10, 10, 10);
    const s = buildSeries({
      range,
      ...empty,
      profiles: [
        { id: "old", createdAt: Date.UTC(2026, 9, 1) },
        { id: "new", createdAt: d10 - 3_600_000 },
      ],
      matches: [m(d9, ["old"], { bot: true }), m(d10, ["old", "new"]), m(d10 + 1000, ["new"], { bot: true }), m(d10 + 2000, ["old"], { bot: true })],
    });
    assert.deepEqual([s[1].matches, s[1].matchesVsBot, s[1].matchesVsHuman, s[1].activePlayers, s[1].newActive, s[1].returningActive], [1, 1, 0, 1, 0, 1]);
    assert.deepEqual([s[2].matches, s[2].matchesVsBot, s[2].matchesVsHuman, s[2].activePlayers, s[2].newActive, s[2].returningActive], [3, 2, 1, 2, 1, 1]);
    assert.equal(s[2].signups, 1);
  });

  test("money lands on the local day; events outside the range are ignored", () => {
    const lateNov9Utc = Date.UTC(2026, 10, 9, 21, 30); // Nov 10 in Addis
    const s = buildSeries({
      range,
      ...empty,
      stakes: [{ ts: lateNov9Utc, amount: 200 }, { ts: Date.UTC(2026, 5, 1), amount: 999 }],
      deposits: [{ ts: lateNov9Utc, amount: 500 }, { ts: lateNov9Utc, amount: 250 }],
      withdrawals: [{ ts: lateNov9Utc, amount: 300 }],
      fees: [{ ts: lateNov9Utc, amount: 10 }],
    });
    assert.equal(s[1].stakeVolume, 0);
    assert.deepEqual([s[2].stakeVolume, s[2].deposits, s[2].depositCount, s[2].withdrawals, s[2].withdrawalCount, s[2].fees], [200, 750, 2, 300, 1, 10]);
  });
});

describe("by game", () => {
  test("most played first, ties by id, only the period, counts staked matches", () => {
    const at = Date.UTC(2026, 10, 9);
    const list = [
      m(at, ["a"], { gameId: "tictactoe" }),
      m(at, ["a"], { gameId: "gebeta", staked: true }),
      m(at, ["a"], { gameId: "gebeta" }),
      m(at, ["a"], { gameId: "bingo" }),
      m(at - 30 * DAY_MS, ["a"], { gameId: "bingo" }),
    ];
    const out = byGame(list, at - DAY_MS, at + DAY_MS, (id) => id.toUpperCase());
    assert.deepEqual(out, [
      { gameId: "gebeta", gameName: "GEBETA", matches: 2, staked: 1 },
      { gameId: "bingo", gameName: "BINGO", matches: 1, staked: 0 },
      { gameId: "tictactoe", gameName: "TICTACTOE", matches: 1, staked: 0 },
    ]);
  });
});
