import assert from "node:assert/strict";
import { test } from "node:test";
import { resultSummary } from "@/components/match/result";
import { battleship, occupancy, type BattleshipState, type Fleet } from "@/engine/games/battleship";
import { battleshipStatus, lastShot } from "./status";

const ROWS: Fleet = [{ cell: 0, dir: "h" }, { cell: 16, dir: "h" }, { cell: 32, dir: "h" }, { cell: 48, dir: "h" }];
const COLS: Fleet = [{ cell: 7, dir: "v" }, { cell: 6, dir: "v" }, { cell: 5, dir: "v" }, { cell: 4, dir: "v" }];
const names: [string, string] = ["Abebe", "Hana"];

const placed = (): BattleshipState => {
  let s = battleship.setup({ seed: "words" });
  s = battleship.apply(s, 0, { type: "place", fleet: ROWS });
  return battleship.apply(s, 1, { type: "place", fleet: COLS });
};

test("status follows placement, shots and the reply shot", () => {
  const s0 = battleship.apply(battleship.setup({ seed: "w" }), 0, { type: "place", fleet: ROWS });
  assert.equal(battleshipStatus(battleship.view(s0, 0), 0, names), "Fleet ready · waiting for Hana");
  assert.equal(battleshipStatus(battleship.view(s0, 1), 1, names), "Place your fleet");
  let s = placed();
  assert.equal(battleshipStatus(battleship.view(s, 0), 0, names), "Your shot");
  s = battleship.apply(s, 0, { type: "fire", cell: 4 });
  assert.equal(battleshipStatus(battleship.view(s, 0), 0, names), "You hit E1 · Hana to fire");
  assert.equal(battleshipStatus(battleship.view(s, 1), 1, names), "Abebe hit E1 · your shot");
  s = battleship.apply(s, 1, { type: "fire", cell: 63 });
  assert.equal(lastShot(battleship.view(s, "spectator"), "spectator", names)?.text, "Hana missed at H8");
  s = battleship.apply(s, 0, { type: "fire", cell: 12 });
  assert.equal(lastShot(battleship.view(s, 1), 1, names)?.text, "Abebe sank your Destroyer");
  assert.equal(lastShot(battleship.view(s, "spectator"), "spectator", names)?.short, "Sunk · Destroyer");
});

test("the result names the fleet sinker and the shots it took", () => {
  let s = placed();
  const targets = [...occupancy(COLS).keys()];
  for (let i = 0; !battleship.outcome(s); i++) {
    s = battleship.apply(s, 0, { type: "fire", cell: targets[i] });
    if (i === targets.length - 1) assert.equal(battleshipStatus(battleship.view(s, 1), 1, names).endsWith("one reply shot to draw"), true);
    s = battleship.apply(s, 1, { type: "fire", cell: 56 + (i % 8) - (i >= 8 ? 16 : 0) });
  }
  const r = resultSummary({ gameId: "battleship", gameName: "Battleship", outcome: battleship.outcome(s)!, reveal: {}, view: battleship.view(s, 0), seat: 0, names, bots: [false, true] });
  assert.equal(r.headline, "You sink the fleet");
  assert.equal(r.detail, "12 shots · 100% on target");
  assert.deepEqual(r.score, [4, 0]);
});
