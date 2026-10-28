import assert from "node:assert/strict";
import { test } from "node:test";
import type { GebetaView } from "@/engine/games/gebeta";
import { gebetaStatus, legalFor } from "./status";

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
