import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getGame } from "../registry";
import { replay, step, initial, type MatchState } from "../replay";
import { createRng } from "../rng";
import type { LogEntry, Seat } from "../types";
import { TOTAL_SEEDS, gebeta, rulesText, type GebetaState } from "./gebeta";

const sum = (b: number[]) => b.reduce((a, n) => a + n, 0);

// Board from seat 0's row, seat 0's store, seat 1's row, seat 1's store.
function state(p0: number[], s0: number, p1: number[], s1: number, turn: Seat = 0): GebetaState {
  return { board: [...p0, s0, ...p1, s1], turn, moves: 0, last: null, over: false };
}

describe("gebeta rules", () => {
  test("setup: 4 seeds in each of 12 pits, empty stores, seat 0 starts", () => {
    const s = gebeta.setup({ seed: "x" });
    assert.deepEqual(s.board, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    assert.equal(s.turn, 0);
    assert.equal(sum(s.board), TOTAL_SEEDS);
  });

  test("sowing pit 0 drops one seed in each next pit and passes the turn", () => {
    const s = gebeta.apply(gebeta.setup({ seed: "x" }), 0, { pit: 0 });
    assert.deepEqual(s.board, [0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    assert.equal(s.turn, 1);
    assert.deepEqual(s.last, { seat: 0, pit: 0, extraTurn: false, captured: 0 });
  });

  test("last seed in own store gives an extra turn", () => {
    const s = gebeta.apply(gebeta.setup({ seed: "x" }), 0, { pit: 2 });
    assert.deepEqual(s.board, [4, 4, 0, 5, 5, 5, 1, 4, 4, 4, 4, 4, 4, 0]);
    assert.equal(s.turn, 0);
    assert.equal(s.last?.extraTurn, true);
  });

  test("seat 1 sows into its own store and wraps onto seat 0's row", () => {
    const s = gebeta.apply(state([4, 4, 4, 4, 4, 4], 0, [4, 4, 4, 4, 4, 4], 0, 1), 1, { pit: 4 });
    assert.deepEqual(s.board, [5, 5, 4, 4, 4, 4, 0, 4, 4, 4, 4, 0, 5, 1]);
    assert.equal(s.turn, 0);
  });

  test("last seed in an empty own pit captures it plus the opposite pit", () => {
    // seat 0 pit 0 has 1 seed and lands in empty pit 1; opposite (seat 1 pit 4) has 5.
    const s = gebeta.apply(state([1, 0, 2, 2, 2, 2], 3, [2, 2, 2, 2, 5, 2], 3), 0, { pit: 0 });
    assert.deepEqual(s.board, [0, 0, 2, 2, 2, 2, 9, 2, 2, 2, 2, 0, 2, 3]);
    assert.equal(s.last?.captured, 6);
    assert.equal(s.turn, 1);
  });

  test("no capture when the opposite pit is empty", () => {
    const s = gebeta.apply(state([1, 0, 2, 2, 2, 2], 3, [2, 2, 2, 2, 0, 7], 3), 0, { pit: 0 });
    assert.deepEqual(s.board, [0, 1, 2, 2, 2, 2, 3, 2, 2, 2, 2, 0, 7, 3]);
    assert.equal(s.last?.captured, 0);
  });

  test("no capture when landing in an empty pit on the opponent's side", () => {
    const s = gebeta.apply(state([1, 0, 0, 0, 0, 3], 0, [9, 0, 9, 9, 9, 9], 0), 0, { pit: 5 });
    assert.deepEqual(s.board, [1, 0, 0, 0, 0, 0, 1, 10, 1, 9, 9, 9, 9, 0]);
    assert.equal(s.last?.captured, 0);
  });

  test("sowing skips the opponent's store and can lap back to capture", () => {
    // 13 seeds from seat 0 pit 5: 6..12 (7), skip 13, 0..5 (6). Last lands in the emptied pit 5.
    const s = gebeta.apply(state([1, 1, 1, 1, 1, 13], 0, [2, 1, 1, 1, 1, 1], 0), 0, { pit: 5 });
    // pit 5 got 1 seed back; opposite is seat 1 pit 0 (index 7) with 2+1 = 3 -> capture 4.
    assert.equal(s.board[13], 0, "opponent store untouched");
    assert.equal(s.last?.captured, 4);
    assert.deepEqual(s.board, [2, 2, 2, 2, 2, 0, 5, 0, 2, 2, 2, 2, 2, 0]);
    assert.equal(sum(s.board), sum([1, 1, 1, 1, 1, 13, 0, 2, 1, 1, 1, 1, 1, 0]));
  });

  test("when a side empties the other side sweeps and the game ends", () => {
    // seat 0's only seed reaches its store; seat 0 row is then empty.
    const s = gebeta.apply(state([0, 0, 0, 0, 0, 1], 20, [3, 3, 3, 3, 3, 3], 10), 0, { pit: 5 });
    assert.equal(s.over, true);
    assert.deepEqual(s.board, [0, 0, 0, 0, 0, 0, 21, 0, 0, 0, 0, 0, 0, 28]);
    assert.deepEqual(gebeta.outcome(s), { winner: 1, draw: false, reason: "most seeds 28-21" });
    assert.deepEqual(gebeta.activeSeats(s), []);
    assert.equal(gebeta.deadlineMs(s), null);
  });

  test("equal stores at the end is a draw", () => {
    const s = gebeta.apply(state([0, 0, 0, 0, 0, 1], 23, [4, 0, 0, 0, 0, 0], 20), 0, { pit: 5 });
    assert.deepEqual(gebeta.outcome(s), { winner: null, draw: true, reason: "draw 24-24" });
  });

  test("validate rejects wrong seat, bad shapes and empty pits", () => {
    const s = gebeta.apply(gebeta.setup({ seed: "x" }), 0, { pit: 0 });
    assert.equal(gebeta.validate(s, 0, { pit: 1 }), "not your turn");
    assert.match(gebeta.validate(s, 1, { pit: 6 }) ?? "", /pit/);
    assert.match(gebeta.validate(s, 1, { pit: 1.5 }) ?? "", /pit/);
    assert.match(gebeta.validate(s, 1, null as never) ?? "", /pit/);
    const s2 = gebeta.apply(s, 1, { pit: 0 });
    assert.equal(gebeta.validate(s2, 0, { pit: 0 }), "that pit is empty");
    assert.equal(gebeta.validate(s2, 0, { pit: 1 }), null);
  });

  test("timeout plays the first legal pit", () => {
    // Pit 2 is the first non-empty one; its last seed also captures pit 5's opposite.
    const s = state([0, 0, 3, 1, 0, 0], 0, [4, 4, 4, 4, 4, 4], 0);
    const t = gebeta.onTimeout(s, createRng("t"));
    assert.deepEqual(t.last, { seat: 0, pit: 2, extraTurn: false, captured: 5 });
    assert.equal(gebeta.deadlineMs(s), 30_000);
  });

  test("apply does not mutate its input", () => {
    const s = gebeta.setup({ seed: "x" });
    const before = JSON.stringify(s);
    gebeta.apply(s, 0, { pit: 3 });
    assert.equal(JSON.stringify(s), before);
  });

  test("view splits rows and stores; spectators have no seat", () => {
    const s = gebeta.apply(gebeta.setup({ seed: "x" }), 0, { pit: 2 });
    const v = gebeta.view(s, "spectator");
    assert.deepEqual(v.pits, [[4, 4, 0, 5, 5, 5], [4, 4, 4, 4, 4, 4]]);
    assert.deepEqual(v.stores, [1, 0]);
    assert.equal(v.you, null);
    assert.equal(gebeta.view(s, 1).you, 1);
  });

  test("is registered and states its variant", () => {
    assert.equal(getGame("gebeta"), gebeta);
    assert.match(rulesText, /counter-clockwise/);
  });
});

describe("gebeta bot", () => {
  test("prefers an extra turn when one is available", () => {
    // Seat 0 pit 2 (4 seeds) ends in the store; nothing else does.
    const s = gebeta.setup({ seed: "x" });
    let extra = 0;
    for (let i = 0; i < 100; i++) {
      const m = gebeta.bot(gebeta.view(s, 0), 0, createRng(`b${i}`));
      if (m.pit === 2) extra++;
    }
    assert.ok(extra >= 70, `chose the extra turn ${extra}/100 times`);
  });

  test("prefers a capture over a plain move", () => {
    // Pit 0 captures 1 + 9; pit 3 is a plain move.
    const s = state([1, 0, 0, 2, 0, 0], 0, [1, 1, 1, 1, 9, 1], 0);
    let caps = 0;
    for (let i = 0; i < 100; i++) if (gebeta.bot(gebeta.view(s, 0), 0, createRng(`c${i}`)).pit === 0) caps++;
    assert.ok(caps >= 80, `chose the capture ${caps}/100 times`);
  });

  test("bot vs bot always terminates, conserves 48 seeds, and replays identically", () => {
    for (let g = 0; g < 200; g++) {
      const seed = `game-${g}`;
      let cur: MatchState<GebetaState> = initial(gebeta, seed);
      const log: LogEntry[] = [];
      const rng = createRng(`${seed}:bots`);
      while (!cur.outcome) {
        assert.ok(log.length < 500, "game did not terminate");
        const seat = cur.state.turn;
        const entry: LogEntry =
          log.length % 37 === 5
            ? { t: log.length, seat: "system", move: { type: "timeout" } }
            : { t: log.length, seat, move: gebeta.bot(gebeta.view(cur.state, seat), seat, rng) };
        cur = step(gebeta, seed, cur, entry, log.length);
        log.push(entry);
        assert.equal(sum(cur.state.board), TOTAL_SEEDS);
      }
      const again = replay<GebetaState>(gebeta, seed, log);
      assert.deepEqual(again, cur);
    }
  });
});
