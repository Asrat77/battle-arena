import assert from "node:assert/strict";
import { test } from "node:test";
import { gebeta, type GebetaState, type GebetaView } from "@/engine/games/gebeta";
import type { Seat } from "@/engine/types";
import { planSowing, sameSpot } from "./sowing";

const viewOf = (s: GebetaState) => gebeta.view(s, "spectator");
const state = (board: number[], turn: Seat = 0, moves = 3): GebetaState => ({ board, turn, moves, last: null, over: false });
const play = (s: GebetaState, pit: number) => gebeta.apply(s, s.turn, { pit });

test("drops one seed per frame, then lands on the server's board", () => {
  const s = gebeta.setup({} as never);
  const next = play(s, 2);
  const plan = planSowing(viewOf(s), viewOf(next));
  assert.ok(plan);
  assert.equal(plan.frames.length, 5);
  assert.deepEqual(plan.frames[0].pits[0], [4, 4, 0, 4, 4, 4]);
  assert.equal(plan.frames[0].hand, 4);
  assert.deepEqual(plan.frames.map((f) => f.hand), [4, 3, 2, 1, 0]);
  assert.ok(sameSpot(plan.frames[1].hit, { seat: 0, pit: 3 }));
  // Pit 2 with 4 seeds ends in seat 0's store: go again.
  assert.ok(sameSpot(plan.frames[4].hit, { seat: 0, store: true }));
  assert.equal(plan.extraTurn, true);
  const end = plan.frames.at(-1)!;
  assert.deepEqual(end.pits, viewOf(next).pits);
  assert.deepEqual(end.stores, viewOf(next).stores);
});

test("skips the opponent's store and wraps round", () => {
  //            seat 0 pits     st  seat 1 pits       st
  const s = state([0, 0, 0, 0, 0, 9, 0, 1, 1, 1, 1, 1, 1, 0]);
  const plan = planSowing(viewOf(s), viewOf(play(s, 5)));
  assert.ok(plan);
  assert.ok(!plan.frames.some((f) => sameSpot(f.hit, { seat: 1, store: true })));
  assert.ok(sameSpot(plan.frames.at(-1)!.hit, { seat: 0, pit: 1 }));
});

test("names both pits of a capture", () => {
  // Seat 0 sows pit 0 (1 seed) into empty pit 1; seat 1's pit 4 sits opposite.
  const s = state([1, 0, 2, 2, 2, 2, 0, 1, 1, 1, 1, 5, 1, 0]);
  const next = play(s, 0);
  const plan = planSowing(viewOf(s), viewOf(next));
  assert.ok(plan?.capture);
  assert.equal(plan.capture.n, 6);
  assert.ok(sameSpot(plan.capture.spots[0], { seat: 0, pit: 1 }));
  assert.ok(sameSpot(plan.capture.spots[1], { seat: 1, pit: 4 }));
  assert.equal(plan.extraTurn, false);
});

test("jumps instead of animating a gap or a mismatch", () => {
  const s = gebeta.setup({} as never);
  const one = play(s, 2);
  const two = play(one, 0);
  assert.equal(planSowing(viewOf(s), viewOf(two)), null);
  const off: GebetaView = { ...viewOf(one), stores: [5, 0] };
  assert.equal(planSowing(viewOf(s), off), null);
  assert.equal(planSowing(viewOf(s), viewOf(s)), null);
});
