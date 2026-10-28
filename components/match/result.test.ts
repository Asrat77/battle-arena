import assert from "node:assert/strict";
import { test } from "node:test";
import type { CtcView } from "@/engine/games/crackTheCode";
import type { GebetaView } from "@/engine/games/gebeta";
import { resultSummary, type ResultInput } from "./result";

const ctcView = (exact: number): CtcView => ({
  phase: "over",
  round: 9,
  mySecret: "4719",
  submitted: [true, true],
  myPending: null,
  history: [{ round: 9, guesses: [{ code: "3826", exact, present: 0 }, { code: "4719", exact: 4, present: 0 }] }],
  secrets: ["4719", "3825"],
});

const ctc = (over: Partial<ResultInput> = {}): ResultInput => ({
  gameId: "crack-the-code",
  gameName: "Crack the Code",
  outcome: { winner: 1, draw: false, reason: "cracked the code" },
  reveal: { secrets: ["4719", "3825"] },
  view: ctcView(3),
  seat: 0,
  names: ["Abebe", "ArenaBot"],
  bots: [false, true],
  ...over,
});

const gebetaView: GebetaView = {
  pits: [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  stores: [29, 19],
  turn: 0,
  moves: 31,
  last: null,
  over: true,
  you: 0,
};

const gebeta = (over: Partial<ResultInput> = {}): ResultInput => ({
  gameId: "gebeta",
  gameName: "Gebeta",
  outcome: { winner: 0, draw: false, reason: "most seeds 29-19" },
  reveal: {},
  view: gebetaView,
  seat: 0,
  names: ["Abebe", "Hana"],
  bots: [false, false],
  ...over,
});

test("a Crack the Code loss to a bot says how close the viewer got", () => {
  const r = resultSummary(ctc());
  assert.equal(r.kind, "loss");
  assert.equal(r.icon, "robot");
  assert.equal(r.eyebrow, "Loss · Crack the Code");
  assert.equal(r.headline, "ArenaBot cracked it");
  assert.equal(r.detail, "Round 9 · you were 1 digit away");
  assert.deepEqual(r.secrets, ["4719", "3825"]);
});

test("a Crack the Code win and a shared crack", () => {
  const win = resultSummary(ctc({ outcome: { winner: 0, draw: false, reason: "cracked the code" } }));
  assert.equal(win.kind, "win");
  assert.equal(win.icon, "popper");
  assert.equal(win.headline, "You cracked it");
  const draw = resultSummary(ctc({ outcome: { winner: null, draw: true, reason: "both cracked the code" } }));
  assert.equal(draw.kind, "draw");
  assert.equal(draw.icon, "handshake");
  assert.equal(draw.detail, "Both cracked it in round 9");
});

test("round limit and setup timeouts read as plain words", () => {
  assert.equal(resultSummary(ctc({ outcome: { winner: null, draw: true, reason: "round limit" } })).headline, "Nobody cracked it");
  const timeout = resultSummary(ctc({ outcome: { winner: 0, draw: false, reason: "no secret set" }, view: null }));
  assert.equal(timeout.headline, "You win");
  assert.equal(timeout.detail, "ArenaBot didn’t lock a secret in time");
});

test("forfeits name who left", () => {
  const mine = resultSummary(ctc({ outcome: { winner: 1, draw: false, reason: "forfeit" } }));
  assert.equal(mine.headline, "You forfeited");
  assert.equal(mine.icon, "whiteflag");
  const theirs = resultSummary(gebeta({ outcome: { winner: 0, draw: false, reason: "forfeit" } }));
  assert.equal(theirs.headline, "Hana forfeited");
  assert.equal(theirs.detail, "You win by forfeit");
});

test("Gebeta shows the score and who out-seeded whom", () => {
  const r = resultSummary(gebeta());
  assert.equal(r.headline, "You out-seeded Hana");
  assert.equal(r.detail, "Board cleared after 31 moves");
  assert.deepEqual(r.score, [29, 19]);
  const lost = resultSummary(gebeta({ seat: 1 }));
  assert.equal(lost.headline, "Abebe out-seeded you");
  assert.equal(lost.icon, "brokenheart");
});

test("spectators get a neutral result", () => {
  const r = resultSummary(gebeta({ seat: "spectator" }));
  assert.equal(r.kind, "watched");
  assert.equal(r.eyebrow, "Final · Gebeta");
  assert.equal(r.headline, "Abebe out-seeded Hana");
});
