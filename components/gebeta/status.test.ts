import assert from "node:assert/strict";
import { test } from "node:test";
import type { GebetaView } from "@/engine/games/gebeta";
import { boardHint, gebetaStatus, legalFor } from "./status";

const view = (over: Partial<GebetaView> = {}): GebetaView => ({
  pits: [
    [4, 0, 4, 4, 4, 4],
    [4, 4, 4, 4, 4, 4],
  ],
  stores: [1, 0],
  turn: 0,
  moves: 1,
  last: null,
  over: false,
  you: 0,
  ...over,
});
const names: [string, string] = ["Abebe", "Hana"];

test("legal pits are the mover's non-empty pits, none off turn", () => {
  assert.deepEqual(legalFor(view(), 0), [0, 2, 3, 4, 5]);
  assert.deepEqual(legalFor(view(), 1), []);
  assert.deepEqual(legalFor(view({ over: true }), 0), []);
});

test("status reads your turn, go again, thinking and the result", () => {
  assert.equal(gebetaStatus(view(), 0, names), "Your turn");
  assert.equal(gebetaStatus(view({ last: { seat: 0, pit: 2, extraTurn: true, captured: 0 } }), 0, names), "Go again!");
  assert.equal(gebetaStatus(view(), 1, names), "Abebe is thinking");
  assert.equal(gebetaStatus(view({ turn: 1 }), 0, names), "Hana is thinking");
  assert.equal(gebetaStatus(view({ turn: 1 }), "spectator", names), "Hana's turn");
  assert.equal(gebetaStatus(view({ over: true, stores: [20, 28] }), 0, names), "Hana wins · 28–20");
  assert.equal(gebetaStatus(view({ over: true, stores: [28, 20] }), 0, names), "You win · 28–20");
  assert.equal(gebetaStatus(view({ over: true, stores: [24, 24] }), 1, names), "Draw · 24–24");
});

test("status names a capture until the next move", () => {
  const took = { last: { seat: 0 as const, pit: 1, extraTurn: false, captured: 6 }, turn: 1 as const };
  assert.equal(gebetaStatus(view(took), 0, names), "+6 captured · Hana next");
  assert.equal(gebetaStatus(view(took), 1, names), "Abebe captured 6 · your turn");
  assert.equal(gebetaStatus(view(took), "spectator", names), "Abebe captured 6 · Hana's turn");
});

test("the hint follows sowing, the moment, auto-play and the wait", () => {
  const base = { view: view(), seat: 0 as const, names, hand: null, moment: null, auto: false, disabled: false };
  assert.equal(boardHint({ ...base, hand: 1 }), "1 seed still travelling · tap the board to skip");
  assert.equal(boardHint({ ...base, hand: 3 }), "3 seeds still travelling · tap the board to skip");
  const again = { kind: "again" as const, mover: 0 as const, n: 0, spots: [], key: 1 };
  assert.equal(boardHint({ ...base, moment: again }), "Last seed hit your store · timer reset to 30 s");
  assert.equal(boardHint({ ...base, seat: 1, moment: again }), "Abebe's last seed hit their store");
  const cap = { kind: "capture" as const, mover: 1 as const, n: 6, spots: [], key: 2 };
  assert.equal(boardHint({ ...base, moment: cap }), "Hana's empty pit and your opposite pit empty into their store");
  assert.equal(boardHint({ ...base, seat: 1, moment: cap }), "Your empty pit and Abebe's opposite pit empty into your store");
  assert.equal(boardHint({ ...base, auto: true }), "Your first non-empty pit plays itself at 0:00");
  assert.equal(boardHint({ ...base, view: view({ turn: 1 }) }), "Your pits wake up when it's your turn");
  assert.equal(boardHint(base), "");
  assert.equal(boardHint({ ...base, seat: "spectator" }), "");
});
