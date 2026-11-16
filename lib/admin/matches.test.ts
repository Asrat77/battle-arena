import assert from "node:assert/strict";
import { test } from "node:test";
import { toCsv } from "./csv";
import {
  MATCH_CSV_COLUMNS,
  filterTournaments,
  gameOptions,
  isFiltered,
  ledgerText,
  matchExportFilename,
  matchQuery,
  matchResult,
  parseMatchParams,
  tournamentCounts,
  tournamentDuration,
  tournamentPlayers,
} from "./matches";
import type { MatchRow } from "./types";

const ref = (id: string, name: string, bot = false) => ({ profileId: id, name: bot ? "Bot" : name, username: bot ? null : id, bot });
const players = [ref("a", "Yodit"), ref("b", "Dawit")];
const out = (winner: 0 | 1 | null, draw: boolean, reason: string) => ({ players, outcome: { winner, draw, reason } });

test("a win names the winner and keeps the game's reason", () => {
  assert.deepEqual(matchResult(out(1, false, "most boxes claimed")), { kind: "won", winnerSeat: 1, label: "Dawit won", reason: "Most boxes claimed" });
  assert.equal(matchResult(out(0, false, "BINGO")).reason, "BINGO");
});

test("a forfeit is a win with a reason", () => {
  const r = matchResult(out(0, false, "forfeit"));
  assert.equal(r.kind, "won");
  assert.equal(r.label, "Yodit won");
  assert.match(r.reason ?? "", /Forfeit/);
});

test("draws, with and without a reason", () => {
  assert.deepEqual(matchResult(out(null, true, "draw 2-2")), { kind: "draw", winnerSeat: null, label: "Draw", reason: "Draw 2-2" });
  assert.equal(matchResult(out(null, true, "draw")).reason, null);
  assert.equal(matchResult(out(null, false, "series draw")).kind, "draw");
  assert.equal(matchResult(out(0, true, "x")).kind, "draw");
});

test("abandoned is aborted, whatever the flags say", () => {
  const r = matchResult(out(null, true, "abandoned"));
  assert.equal(r.kind, "aborted");
  assert.equal(r.label, "Aborted");
  assert.equal(r.reason, "Both players left");
});

test("bots, unknown names and missing outcomes", () => {
  const bot = { players: [ref("a", "Yodit"), ref("bot", "x", true)], outcome: { winner: 1 as const, draw: false, reason: "cracked the code" } };
  assert.equal(matchResult(bot).label, "Bot won");
  assert.equal(matchResult({ players: [{ profileId: "z", name: null, username: null, bot: false }], outcome: { winner: 0, draw: false, reason: "" } }).label, "Unknown player won");
  assert.equal(matchResult({ players: [], outcome: { winner: 1, draw: false, reason: "" } }).label, "Unknown player won");
  assert.equal(matchResult({ players, outcome: undefined as never }).kind, "aborted");
  assert.equal(matchResult(out(0, false, "")).reason, null);
});

test("URL filters parse and become the API query", () => {
  const p = parseMatchParams((k) => ({ game: "bingo", type: "bot", stake: "free", player: "abc", page: "3", open: "m1" })[k] ?? null);
  assert.deepEqual(p, { game: "bingo", type: "bot", stake: "free", player: "abc", page: 2, open: "m1" });
  assert.deepEqual(matchQuery(p), { game: "bingo", bot: "1", staked: "0", player: "abc" });
  const d = parseMatchParams((k) => ({ type: "nope", stake: "x", page: "-1" })[k] ?? null);
  assert.deepEqual(matchQuery(d), {});
  assert.equal(d.page, 0);
  assert.equal(isFiltered(d), false);
  assert.equal(isFiltered(p), true);
  assert.deepEqual(matchQuery({ game: "", type: "human", stake: "staked", player: "" }), { bot: "0", staked: "1" });
});

test("game options include the known games and any new one", () => {
  const o = gameOptions([{ gameId: "chess", gameName: "Chess" }, { gameId: "bingo", gameName: "BINGO" }]);
  assert.equal(o[0].value, "");
  assert.equal(o.length, 8);
  assert.equal(o.at(-1)?.label, "Chess");
});

test("ledger text", () => {
  assert.equal(ledgerText({ status: "recorded", resultIndex: 12 }), "Recorded #12");
  assert.equal(ledgerText({ status: "pending", resultIndex: null }), "Pending");
});

test("export rows: money in birr, a formula-looking name is quoted", () => {
  const m: MatchRow = {
    matchId: "m1", gameId: "bingo", gameName: "BINGO", players: [ref("a", "=cmd"), ref("b", "Dawit")], bot: false,
    outcome: { winner: 0, draw: false, reason: "BINGO" }, startedAt: 0, endedAt: 60_000, durationMs: 60_000, moves: 12,
    stake: { amount: 1000, book: "real", status: "settled", prize: 1800, fee: 200 }, status: "recorded", resultIndex: 4,
  };
  const csv = toCsv([m], MATCH_CSV_COLUMNS).split("\r\n");
  assert.match(csv[1], /'=cmd/);
  assert.match(csv[1], /,10,real,settled,18,2,recorded,4$/);
  assert.equal(matchExportFilename({ game: "bingo", type: "bot", stake: "staked", player: "" }, Date.UTC(2026, 10, 16)), "matches-2026-11-16-bingo-vs-bot-staked.csv");
});

test("tournament texts", () => {
  assert.equal(tournamentPlayers({ players: 8, bots: 2 }), "6 + 2 bots");
  assert.equal(tournamentPlayers({ players: 4, bots: 0 }), "4 players");
  assert.equal(tournamentPlayers({ players: 2, bots: 1 }), "1 + 1 bot");
  assert.equal(tournamentDuration({ startedAt: null, endedAt: null }), null);
  assert.equal(tournamentDuration({ startedAt: 0, endedAt: 90 * 60_000 }), "1h 30m");
  assert.equal(tournamentDuration({ startedAt: 1000, endedAt: null }, 61_000), "1m 00s");
  const rows = [{ status: "open" as const }, { status: "finished" as const }, { status: "finished" as const }];
  assert.equal(filterTournaments(rows, "finished").length, 2);
  assert.equal(filterTournaments(rows, "all").length, 3);
  assert.deepEqual(tournamentCounts(rows), { total: 3, open: 1, running: 0, finished: 2 });
});
