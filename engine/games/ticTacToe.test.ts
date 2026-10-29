import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonical } from "../canonical";
import { createRng } from "../rng";
import { initial, replay, step } from "../replay";
import type { LogEntry } from "../types";
import { boardResult, markFor, PAUSE_MS, rankedMoves, ticTacToe as game, TURN_MS, WIN_LINES, type TicTacToeState } from "./ticTacToe";

const draw = [0, 1, 2, 4, 3, 5, 7, 6, 8];
const win = [0, 3, 1, 4, 2];
function board(s: TicTacToeState, cells: number[]) {
  return cells.reduce((cur, cell) => {
    assert.equal(game.validate(cur, cur.turn, { cell }), null);
    return game.apply(cur, cur.turn, { cell });
  }, s);
}
const next = (s: TicTacToeState) => game.onTimeout(s, createRng("pause"));

describe("tic-tac-toe series", () => {
  test("starts empty and identifies all eight lines, including intersecting lines", () => {
    const s = game.setup({ seed: "x" });
    assert.deepEqual(s.board, Array(9).fill(null));
    assert.equal(s.turn, 0);
    assert.equal(markFor(1, 0), "X");
    assert.equal(game.deadlineMs(s), TURN_MS);
    for (const line of WIN_LINES) {
      const b = s.board.slice();
      line.forEach((cell) => b[cell] = 1);
      assert.deepEqual(boardResult(b), { winner: 1, winningCells: [...line], over: true });
    }
    assert.deepEqual(boardResult([0, 1, 0, 1, 0, 1, 0, 1, 0]).winningCells.sort(), [0, 2, 4, 6, 8]);
  });

  test("rejects malformed, occupied and off-turn moves without mutating state", () => {
    const s = game.setup({ seed: "x" });
    const before = canonical(s);
    for (const move of [null, 3, {}, { cell: -1 }, { cell: 9 }, { cell: 0.1 }, { cell: "1" }, { cell: NaN }, { cell: Infinity }])
      assert.ok(game.validate(s, 0, move as never));
    assert.equal(game.validate(s, 1, { cell: 0 }), "not your turn");
    const played = game.apply(s, 0, { cell: 0 });
    assert.equal(game.validate(played, 1, { cell: 0 }), "that square is occupied");
    assert.equal(canonical(s), before);
    const view = game.view(played, "spectator");
    view.board[0] = null;
    assert.equal(played.board[0], 0);
  });

  test("pauses three seconds, retains the winning board, then alternates opener and marks", () => {
    const s = board(game.setup({ seed: "x" }), win);
    assert.equal(s.phase, "pause");
    assert.deepEqual(s.scores, [1, 0]);
    assert.deepEqual(s.history[0].winningCells, [0, 1, 2]);
    assert.equal(game.deadlineMs(s), PAUSE_MS);
    assert.deepEqual(game.activeSeats(s), []);
    assert.ok(game.validate(s, 0, { cell: 8 }));
    const two = next(s);
    assert.equal(two.round, 2);
    assert.equal(two.turn, 1);
    assert.equal(markFor(2, 1), "X");
    assert.equal(markFor(2, 0), "O");
    assert.deepEqual(two.board, Array(9).fill(null));
    assert.deepEqual(two.scores, [1, 0]);
    assert.equal(game.deadlineMs(two), TURN_MS);
  });

  test("finishes 2-0 early, with no extra pause or moves", () => {
    let s = next(board(game.setup({ seed: "x" }), win));
    s = board(s, [3, 0, 4, 1, 8, 2]); // The second player (seat 0) wins board two.
    assert.equal(s.phase, "finished");
    assert.equal(s.round, 2);
    assert.deepEqual(s.scores, [2, 0]);
    assert.deepEqual(game.outcome(s), { winner: 0, draw: false, reason: "most boards won" });
    assert.equal(game.deadlineMs(s), null);
    assert.deepEqual(game.activeSeats(s), []);
    assert.ok(game.validate(s, 0, { cell: 5 }));
    assert.deepEqual(next(s), s);
  });

  test("a tied series reaches board three and its winner takes the match", () => {
    let s = board(game.setup({ seed: "x" }), win);
    s = board(next(s), win);
    assert.deepEqual(s.scores, [1, 1]);
    s = board(next(s), win);
    assert.deepEqual(s.scores, [2, 1]);
    assert.equal(game.outcome(s)?.winner, 0);
    assert.equal(s.history.length, 3);
  });

  test("draws consume boards, a 1-0 score wins after three, equal scores draw", () => {
    let s = board(game.setup({ seed: "x" }), draw);
    assert.deepEqual(s.scores, [0, 0]);
    assert.equal(s.history[0].winner, null);
    s = board(next(s), draw);
    assert.equal(s.phase, "pause");
    const tied = board(next(s), draw);
    assert.deepEqual(game.outcome(tied), { winner: null, draw: true, reason: "series draw" });
    const won = board(next(s), win);
    assert.deepEqual(won.scores, [1, 0]);
    assert.equal(game.outcome(won)?.winner, 0);
    s = board(game.setup({ seed: "x" }), win);
    s = board(next(s), win);
    s = board(next(s), draw);
    assert.deepEqual(s.scores, [1, 1]);
    assert.equal(game.outcome(s)?.draw, true);
  });

  test("timeouts select the first empty square and forfeits end the series in either phase", () => {
    let s = game.apply(game.setup({ seed: "x" }), 0, { cell: 4 });
    s = next(s);
    assert.equal(s.board[0], 1);
    assert.equal(s.lastCell, 0);
    for (const state of [s, board(game.setup({ seed: "x" }), win)]) {
      const ended = step(game, "x", { state, outcome: null }, { t: 1, seat: "system", move: { type: "forfeit", seat: 0 } }, 0);
      assert.equal(ended.outcome?.winner, 1);
      assert.equal(ended.outcome?.reason, "forfeit");
    }
  });
});

describe("tic-tac-toe bot and replay", () => {
  test("takes a winning move or blocks a loss; can intentionally choose a weaker move", () => {
    const s = game.setup({ seed: "x" });
    s.board = [0, 0, null, 1, 1, null, null, null, null];
    const optimal = { next: () => 0.8, pick: <T>(items: readonly T[]) => items[0], int: () => 0 };
    assert.equal(game.bot(s, 0, optimal).cell, 2);
    const weaker = game.bot(s, 0, { ...optimal, next: () => 0.01 }).cell;
    assert.notEqual(weaker, 2);
    s.board = [1, 1, null, 0, null, null, null, 0, null];
    assert.equal(game.bot(s, 0, optimal).cell, 2);
    const a = game.bot(s, 0, createRng("same"));
    assert.deepEqual(a, game.bot(s, 0, createRng("same")));
    assert.ok(rankedMoves(s.board, 0).find((m) => m.cell === 2)!.score >= 0, "blocking avoids a forced loss");
  });

  test("bot series terminate, log pause transitions, and replay exactly", () => {
    for (let n = 0; n < 12; n++) {
      const seed = `ttt-${n}`;
      const rng = createRng(seed);
      let cur = initial(game, seed);
      const log: LogEntry[] = [];
      while (!cur.outcome) {
        assert.ok(log.length < 30);
        const s = cur.state;
        const entry: LogEntry = s.phase === "pause" || log.length % 7 === 6
          ? { t: log.length, seat: "system", move: { type: "timeout" } }
          : { t: log.length, seat: s.turn, move: game.bot(game.view(s, s.turn), s.turn, rng) };
        cur = step(game, seed, cur, entry, log.length);
        log.push(entry);
      }
      assert.ok(cur.state.history.length <= 3);
      assert.deepEqual(replay(game, seed, log), cur);
      assert.deepEqual(game.view(cur.state, 0), game.view(cur.state, "spectator"));
    }
  });
});
