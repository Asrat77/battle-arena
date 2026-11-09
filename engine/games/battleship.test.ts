import assert from "node:assert/strict";
import { test } from "node:test";
import { createRng } from "../rng";
import { replay } from "../replay";
import type { LogEntry } from "../types";
import {
  battleship as game, CELLS, cellName, commitment, FLEET, fleetError, occupancy, PLACE_MS, randomFleet, shipCells, targetHeat,
  TURN_MS, type BattleshipState, type Fleet,
} from "./battleship";

// Rows 0, 2, 4 and 6, all from the left edge.
const LEFT: Fleet = [{ cell: 0, dir: "h" }, { cell: 16, dir: "h" }, { cell: 32, dir: "h" }, { cell: 48, dir: "h" }];
// Columns H, G, F and E, all from the top.
const TOP: Fleet = [{ cell: 7, dir: "v" }, { cell: 6, dir: "v" }, { cell: 5, dir: "v" }, { cell: 4, dir: "v" }];
const shipSquares = (fleet: Fleet) => [...occupancy(fleet).keys()].sort((a, b) => a - b);

const placed = (a = LEFT, b = TOP) => {
  let s = game.setup({ seed: "sea" });
  s = game.apply(s, 0, { type: "place", fleet: a });
  return game.apply(s, 1, { type: "place", fleet: b });
};

test("ships stay on the sea and never overlap", () => {
  assert.deepEqual(shipCells({ cell: 4, dir: "h" }, 4), [4, 5, 6, 7]);
  assert.equal(shipCells({ cell: 5, dir: "h" }, 4), null);
  assert.deepEqual(shipCells({ cell: 40, dir: "v" }, 3), [40, 48, 56]);
  assert.equal(shipCells({ cell: 48, dir: "v" }, 3), null);
  assert.equal(fleetError(LEFT), null);
  assert.equal(fleetError(LEFT.slice(0, 3)), "fleet must place 4 ships");
  assert.equal(fleetError([...LEFT.slice(0, 3), { cell: 1, dir: "h" }]), "ships cannot overlap");
  assert.equal(fleetError([{ cell: 6, dir: "h" }, ...LEFT.slice(1)]), "the Battleship runs off the sea");
  assert.equal(fleetError([{ cell: 0, dir: "x" }, ...LEFT.slice(1)]), "each ship needs {cell, dir: h|v}");
  for (let i = 0; i < 50; i++) assert.equal(fleetError(randomFleet(createRng(`f${i}`))), null);
});

test("placement is private, starts the battle and seals both fleets", () => {
  let s = game.setup({ seed: "sea" });
  assert.equal(game.deadlineMs(s), PLACE_MS);
  assert.equal(game.validate(s, 0, { type: "fire", cell: 0 }), "place your fleet first");
  s = game.apply(s, 0, { type: "place", fleet: LEFT });
  assert.equal(game.validate(s, 0, { type: "place", fleet: TOP }), "fleet already placed");
  assert.deepEqual(game.activeSeats(s), [1]);
  assert.deepEqual(game.view(s, 0).myFleet, LEFT);
  assert.equal(game.view(s, 1).myFleet, null);
  assert.equal(game.view(s, "spectator").myFleet, null);
  assert.deepEqual(Object.keys(game.commitments!(s)), ["0"]);
  s = game.apply(s, 1, { type: "place", fleet: TOP });
  assert.equal(s.phase, "battle");
  assert.equal(game.deadlineMs(s), TURN_MS);
  assert.deepEqual(game.commitments!(s), { 0: commitment(LEFT, s.salts[0]), 1: commitment(TOP, s.salts[1]) });
  for (const viewer of [0, 1, "spectator"] as const) {
    const json = JSON.stringify(game.view(s, viewer));
    assert.ok(viewer === 0 || !json.includes(JSON.stringify(LEFT)));
    assert.ok(viewer === 1 || !json.includes(JSON.stringify(TOP)));
  }
});

test("turns alternate, repeats are refused and hits sink ships", () => {
  let s = placed();
  assert.equal(game.validate(s, 1, { type: "fire", cell: 7 }), "not your turn");
  assert.equal(game.validate(s, 0, { type: "fire", cell: 64 }), "cell must be 0..63");
  s = game.apply(s, 0, { type: "fire", cell: 4 }); // E1: destroyer
  s = game.apply(s, 1, { type: "fire", cell: 63 }); // miss
  assert.equal(game.validate(s, 0, { type: "fire", cell: 4 }), "you already fired at that square");
  s = game.apply(s, 0, { type: "fire", cell: 12 }); // E2: destroyer sunk
  const view = game.view(s, "spectator");
  assert.deepEqual(view.shots[0], [{ cell: 4, hit: true, sunk: null }, { cell: 12, hit: true, sunk: 3 }]);
  assert.deepEqual(view.shots[1], [{ cell: 63, hit: false, sunk: null }]);
  assert.deepEqual(view.sunk[1], [{ ship: 3, at: TOP[3] }]);
  assert.deepEqual(view.last, { seat: 0, cell: 12 });
  assert.equal(cellName(12), "E2");
});

test("the first player sinking the fleet still leaves a reply shot", () => {
  let s = placed();
  const targets = shipSquares(TOP);
  const misses = Array.from({ length: CELLS }, (_, i) => i).filter((c) => !occupancy(LEFT).has(c));
  for (let i = 0; i < targets.length; i++) {
    s = game.apply(s, 0, { type: "fire", cell: targets[i] });
    if (i === targets.length - 1) break;
    s = game.apply(s, 1, { type: "fire", cell: misses[i] });
  }
  assert.equal(s.phase, "battle");
  assert.equal(game.outcome(s), null);
  assert.deepEqual(game.activeSeats(s), [1]);
  const reply = game.apply(s, 1, { type: "fire", cell: misses[targets.length] });
  assert.deepEqual(game.outcome(reply), { winner: 0, draw: false, reason: "fleet sunk" });
  assert.deepEqual(game.view(reply, 1).fleets, [LEFT, TOP]);
  assert.equal(game.validate(reply, 0, { type: "fire", cell: 62 }), "match is over");
});

test("both fleets sunk on even shots is a draw; the second player can win outright", () => {
  // Same layout on both sides, so mirrored shots finish together.
  let s = placed(LEFT, LEFT);
  for (const cell of shipSquares(LEFT)) {
    s = game.apply(s, 0, { type: "fire", cell });
    s = game.apply(s, 1, { type: "fire", cell });
  }
  assert.deepEqual(game.outcome(s), { winner: null, draw: true, reason: "both fleets sunk" });

  s = placed();
  const hits = shipSquares(LEFT);
  for (let i = 0; i < hits.length; i++) {
    s = game.apply(s, 0, { type: "fire", cell: 60 - i }); // seat 0 misses on row 8 and 7
    s = game.apply(s, 1, { type: "fire", cell: hits[i] });
  }
  assert.deepEqual(game.outcome(s), { winner: 1, draw: false, reason: "fleet sunk" });
});

test("placement timeout places missing fleets; turn timeout fires at an open square", () => {
  let s = game.apply(game.setup({ seed: "sea" }), 0, { type: "place", fleet: LEFT });
  s = game.onTimeout(s, createRng("t"));
  assert.equal(s.phase, "battle");
  assert.deepEqual(s.fleets[0], LEFT);
  assert.equal(fleetError(s.fleets[1]), null);
  assert.deepEqual(s.auto, [false, true]);
  s = game.apply(s, 0, { type: "fire", cell: 0 });
  const next = game.onTimeout(s, createRng("t"));
  assert.equal(next.shots[1].length, 1);
  assert.equal(next.turn, 0);
});

test("the bot finishes off a damaged ship", () => {
  // One hit on B1 next to a miss on A1: the rest of the ship must be to the right or below.
  const heat = targetHeat([{ cell: 1, hit: true, sunk: null }, { cell: 0, hit: false, sunk: null }], []);
  const best = heat.indexOf(Math.max(...heat));
  assert.ok([2, 9].includes(best), `aimed at ${cellName(best)}`);
  assert.equal(heat[0], 0);
  assert.equal(heat[1], 0);
});

test("bot against bot finishes, views never mutate state, and replays agree", () => {
  for (const seed of ["a", "b", "c"]) {
    let s: BattleshipState = game.setup({ seed });
    const log: LogEntry[] = [];
    const rng = createRng(`bots:${seed}`);
    while (!game.outcome(s)) {
      const seat = game.activeSeats(s)[0];
      const view = game.view(s, seat);
      const move = game.bot(view, seat, rng);
      assert.equal(game.validate(s, seat, move), null);
      log.push({ t: log.length, seat, move });
      const before = JSON.stringify(s);
      view.shots[0].push({ cell: 0, hit: true, sunk: 0 });
      assert.equal(JSON.stringify(s), before);
      s = game.apply(s, seat, move);
    }
    assert.ok(s.shots[0].length < CELLS);
    assert.ok(game.view(s, "spectator").sunk.some((list) => list.length === FLEET.length));
    assert.deepEqual(replay(game, seed, log).outcome, game.outcome(s));
  }
});
