import assert from "node:assert/strict";
import { test } from "node:test";
import { toCsv } from "./csv";
import {
  PLAYER_CSV_COLUMNS,
  bankLabel,
  depositAmount,
  parseTab,
  collectAll,
  defaultDir,
  exportFilename,
  gameLabel,
  listQuery,
  opponentOf,
  parseListParams,
  resultFor,
  winRate,
  winRateText,
  wonPrize,
} from "./players";
import type { UserRow } from "./types";

const ref = (profileId: string, bot = false) => ({ profileId, name: profileId, username: bot ? null : profileId, bot });
const match = (winner: 0 | 1 | null, draw = false, players = [ref("a"), ref("b")]) => ({ players, outcome: { winner, draw, reason: "x" } });

test("result for a player comes from their seat", () => {
  assert.equal(resultFor(match(0), "a"), "won");
  assert.equal(resultFor(match(0), "b"), "lost");
  assert.equal(resultFor(match(1), "a"), "lost");
  assert.equal(resultFor(match(1), "b"), "won");
  assert.equal(resultFor(match(null, true), "a"), "draw");
  assert.equal(resultFor(match(null), "b"), "draw");
  assert.equal(resultFor(match(0, true), "a"), "draw");
  assert.equal(resultFor(match(0), "zzz"), null);
});

test("a bot in seat 0 pushes the player to seat 1", () => {
  const m = match(1, false, [ref("bot", true), ref("a")]);
  assert.equal(resultFor(m, "a"), "won");
  assert.equal(opponentOf(m, "a")?.bot, true);
  assert.equal(opponentOf(match(0), "a")?.profileId, "b");
});

test("win rate", () => {
  assert.equal(winRate(3, 4), 0.75);
  assert.equal(winRate(0, 0), null);
  assert.equal(winRateText(5, 8), "63%");
  assert.equal(winRateText(0, 0), "–");
});

test("game labels prefer a known name", () => {
  assert.equal(gameLabel("dots-and-boxes"), "Dots and boxes");
  assert.equal(gameLabel("x", [{ gameId: "x", gameName: "Ex" }]), "Ex");
});

test("the prize shows only for won, settled stakes", () => {
  const stake = { amount: 100, book: "real" as const, status: "settled" as const, prize: 180, fee: 20 };
  assert.equal(wonPrize({ stake }, "won"), 180);
  assert.equal(wonPrize({ stake }, "lost"), null);
  assert.equal(wonPrize({ stake: { ...stake, status: "refunded" } }, "won"), null);
  assert.equal(wonPrize({ stake: null }, "won"), null);
});

test("list parameters fall back to defaults", () => {
  const get = (m: Record<string, string>) => (k: string) => m[k] ?? null;
  assert.deepEqual(parseListParams(get({})), { q: "", filter: "all", sort: "joined", dir: "desc", page: 0 });
  assert.deepEqual(parseListParams(get({ q: " bob ", filter: "guest", sort: "name", page: "3" })), {
    q: "bob",
    filter: "guest",
    sort: "name",
    dir: "asc",
    page: 2,
  });
  assert.equal(parseListParams(get({ sort: "hack", filter: "nope", dir: "up", page: "-3" })).sort, "joined");
  assert.equal(parseListParams(get({ page: "-3" })).page, 0);
  assert.equal(defaultDir("balance"), "desc");
  assert.deepEqual(listQuery(parseListParams(get({ sort: "balance" })), "play"), { q: "", filter: "all", sort: "balance", dir: "desc", book: "play" });
});

test("CSV rows: money in birr, ISO times, formulas defused", () => {
  const u: UserRow = {
    id: "p1",
    name: "=Evil",
    username: "evil",
    avatar: null,
    createdAt: Date.UTC(2026, 0, 2),
    hasPassword: true,
    status: "online",
    balance: { real: 12_345, play: 0 },
    matches: 4,
    lastMatchAt: null,
    lastSignInAt: Date.UTC(2026, 0, 3),
  };
  const lines = toCsv([u], PLAYER_CSV_COLUMNS).trim().split("\r\n");
  assert.equal(lines[0], "id,name,username,joined,registered,status,real balance birr,play balance birr,matches,last match,last sign-in");
  assert.equal(lines[1], "p1,'=Evil,evil,2026-01-02T00:00:00.000Z,yes,online,123.45,0,4,,2026-01-03T00:00:00.000Z");
});

test("export file name", () => {
  const now = Date.UTC(2026, 10, 16);
  assert.equal(exportFilename({ filter: "all", q: "" }, now), "players-2026-11-16.csv");
  assert.equal(exportFilename({ filter: "guest", q: "x" }, now), "players-2026-11-16-guest-search.csv");
});

test("collectAll pages until the total, reporting progress", async () => {
  const all = Array.from({ length: 450 }, (_, i) => i);
  const seen: number[] = [];
  const progress: [number, number][] = [];
  const rows = await collectAll(
    async (page, limit) => {
      seen.push(page);
      return { rows: all.slice(page * limit, page * limit + limit), total: all.length };
    },
    { onProgress: (d, t) => progress.push([d, t]) },
  );
  assert.equal(rows.length, 450);
  assert.deepEqual(seen, [0, 1, 2]);
  assert.deepEqual(progress.at(-1), [450, 450]);
});

test("collectAll handles empty, exact multiples and cancel", async () => {
  assert.deepEqual(await collectAll(async () => ({ rows: [], total: 0 })), []);
  let calls = 0;
  const rows = await collectAll(async (page, limit) => {
    calls++;
    return { rows: Array.from({ length: limit }, (_, i) => page * limit + i), total: 400 };
  });
  assert.equal(rows.length, 400);
  assert.equal(calls, 2);
  assert.deepEqual(await collectAll(async () => ({ rows: [1], total: 1 }), { isCancelled: () => true }), []);
});

test("tab and bank parsing", () => {
  assert.equal(parseTab("wallet"), "wallet");
  assert.equal(parseTab("nope"), "overview");
  assert.equal(parseTab(null), "overview");
  assert.equal(bankLabel("telebirr"), "Telebirr");
  assert.equal(bankLabel("cbe"), "CBE");
  assert.equal(bankLabel("other"), "Other");
});

test("deposit amount falls back to the review amount", () => {
  assert.deepEqual(depositAmount({ amount: 500 }), { amount: 500, review: false });
  assert.deepEqual(depositAmount({ amount: null, reviewAmount: 700 }), { amount: 700, review: true });
  assert.deepEqual(depositAmount({ amount: null }), { amount: null, review: false });
});
