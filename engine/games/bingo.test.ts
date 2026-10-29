import assert from "node:assert/strict";
import { test } from "node:test";
import { replay } from "../replay";
import { createRng } from "../rng";
import { bingo, completedLines, LINES, openNumbers } from "./bingo";

const fresh = () => bingo.setup({ seed: "bingo" });

test("each seat gets its own shuffle of 1-25 from the seed", () => {
  const s = fresh();
  for (const grid of s.grids) assert.deepEqual([...grid].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.notDeepEqual(s.grids[0], s.grids[1]);
  assert.deepEqual(bingo.setup({ seed: "bingo" }), s);
});

test("rejects calls out of turn, out of range or already called", () => {
  const s = bingo.apply(fresh(), 0, { number: 7 });
  assert.equal(bingo.validate(s, 0, { number: 8 }), "not your turn");
  assert.equal(bingo.validate(s, 1, { number: 26 }), "move must be {number: 1..25}");
  assert.equal(bingo.validate(s, 1, { number: 7 }), "that number is already called");
  assert.equal(bingo.validate(s, 1, { number: 8 }), null);
});

test("the first sheet to five lines wins, the same call on both sheets draws", () => {
  let s = fresh();
  for (const cell of LINES.slice(0, 5).flat()) {
    if (bingo.outcome(s)) break;
    s = bingo.apply(s, s.turn, { number: s.grids[0][cell] });
  }
  const out = bingo.outcome(s)!;
  const counts = s.grids.map((grid) => completedLines(grid, s.called).length);
  assert.ok(out.draw ? counts.every((n) => n >= 5) : counts[out.winner!] >= 5 && counts[1 - out.winner!] < 5);
  assert.equal(bingo.validate(s, s.turn, { number: openNumbers(s.grids[s.turn], s.called)[0] }), "match is over");

  const all = { ...fresh(), called: Array.from({ length: 25 }, (_, i) => i + 1) };
  assert.deepEqual(bingo.outcome(all), { winner: null, draw: true, reason: "BINGO on the same call" });
});

test("views hide the other sheet and only count lines", () => {
  const s = fresh();
  assert.deepEqual(bingo.view(s, 1).grid, s.grids[1]);
  assert.equal(bingo.view(s, "spectator").grid, null);
  assert.deepEqual(bingo.view(s, 0).lines, [0, 0]);
});

test("timeout calls the first open number on the active sheet", () => {
  const s = bingo.apply(fresh(), 0, { number: fresh().grids[1][0] });
  const next = bingo.onTimeout(s, createRng("t"));
  assert.equal(next.called[1], s.grids[1][1]);
  assert.equal(next.turn, 0);
});

test("bot against bot finishes and replays to the same result", () => {
  let s = fresh();
  const log = [];
  const rng = createRng("bots");
  while (!bingo.outcome(s)) {
    const move = bingo.bot(bingo.view(s, s.turn), s.turn, rng);
    assert.equal(bingo.validate(s, s.turn, move), null);
    log.push({ t: log.length, seat: s.turn, move });
    s = bingo.apply(s, s.turn, move);
  }
  assert.deepEqual(replay(bingo, "bingo", log).outcome, bingo.outcome(s));
});
