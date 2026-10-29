import assert from "node:assert/strict";
import { test } from "node:test";
import { createRng } from "../rng";
import { initial, replay, step } from "../replay";
import type { LogEntry } from "../types";
import { available, boxEdges, dotsAndBoxes as game, TURN_MS } from "./dotsAndBoxes";

test("edges, invalid moves, capture, extra turn and immutable views", () => {
  let s = game.setup({ seed: "x" });
  assert.equal(s.edges.length, 60); assert.equal(s.boxes.length, 25);
  assert.deepEqual(boxEdges(0), [0, 5, 30, 31]);
  assert.deepEqual(boxEdges(24), [24, 29, 58, 59]);
  for (const edge of [-1, 60, 1.5]) assert.ok(game.validate(s, 0, { edge }));
  assert.ok(game.validate(s, 1, { edge: 0 }));
  const original = JSON.stringify(s);
  for (const edge of [0, 5, 30]) s = game.apply(s, s.turn, { edge });
  assert.equal(game.validate(s, s.turn, { edge: 0 }), "that line is already drawn");
  assert.equal(JSON.stringify(game.setup({ seed: "x" })), original);
  const seat = s.turn; s = game.apply(s, seat, { edge: 31 });
  assert.deepEqual(s.last?.captured, [0]); assert.equal(s.turn, seat); assert.equal(s.scores[seat], 1);
  assert.equal(game.deadlineMs(s), TURN_MS);
  const view = game.view(s, "spectator"); view.edges[0] = null; assert.notEqual(s.edges[0], null);
});

test("one line can claim two boxes and timeout chooses the first free line", () => {
  let s = game.setup({ seed: "x" });
  for (const edge of [0, 1, 5, 6, 30, 32]) s = game.apply(s, s.turn, { edge });
  const seat = s.turn; s = game.apply(s, seat, { edge: 31 });
  assert.deepEqual(s.last?.captured, [0, 1]); assert.equal(s.scores[seat], 2); assert.equal(s.turn, seat);
  s = game.onTimeout(s, createRng("x")); assert.equal(s.last?.edge, 2);
});

test("bot series finish in 60 legal moves and replay identically", () => {
  for (let n = 0; n < 3; n++) {
    const seed = `dots-${n}`, rng = createRng(seed), log: LogEntry[] = [];
    let cur = initial(game, seed);
    while (!cur.outcome) {
      const seat = cur.state.turn;
      const move = game.bot(game.view(cur.state, seat), seat, rng);
      assert.ok(available(cur.state.edges).includes(move.edge));
      const entry: LogEntry = { t: log.length, seat, move };
      cur = step(game, seed, cur, entry, log.length); log.push(entry);
      assert.ok(log.length <= 60);
    }
    assert.equal(log.length, 60); assert.equal(cur.state.scores[0] + cur.state.scores[1], 25);
    assert.deepEqual(replay(game, seed, log), cur);
  }
});
