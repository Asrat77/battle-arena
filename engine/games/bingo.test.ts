// Unit tests for the BINGO engine — uses Node's built-in test runner.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRng } from "../rng";
import { bingo, BINGO_LETTERS, LINES, uncrossedNumbers } from "./bingo";

function makeState() {
  return bingo.setup({ seed: "test-seed" });
}

describe("setup", () => {
  test("gives each seat a 25-number grid with numbers 1–25", () => {
    const s = makeState();
    for (const seat of [0, 1] as const) {
      assert.equal(s.grids[seat].length, 25);
      assert.deepEqual(
        [...s.grids[seat]].sort((a, b) => a - b),
        Array.from({ length: 25 }, (_, i) => i + 1)
      );
    }
  });

  test("generates different grids for each seat", () => {
    const s = makeState();
    assert.notDeepEqual(s.grids[0], s.grids[1]);
  });

  test("starts with no crossed numbers and seat 0's turn", () => {
    const s = makeState();
    assert.equal(s.crossed[0].length, 0);
    assert.equal(s.crossed[1].length, 0);
    assert.equal(s.turn, 0);
    assert.equal(s.over, false);
  });
});

describe("validate", () => {
  test("rejects a move when it is not your turn", () => {
    const s = makeState();
    const n = s.grids[1][0];
    assert.notEqual(bingo.validate(s, 1, { number: n }), null);
  });

  test("rejects numbers out of range 1–25", () => {
    const s = makeState();
    assert.notEqual(bingo.validate(s, 0, { number: 0 }), null);
    assert.notEqual(bingo.validate(s, 0, { number: 26 }), null);
  });

  test("rejects calling an already-crossed number", () => {
    const s = makeState();
    const num = s.grids[0][0];
    const s2 = bingo.apply(s, 0, { number: num });
    // seat 1 plays, then seat 0 gets the turn back
    const num2 = uncrossedNumbers(s2.grids[1], s2.crossed[1])[0];
    const s3 = bingo.apply(s2, 1, { number: num2 });
    assert.notEqual(bingo.validate(s3, 0, { number: num }), null);
  });

  test("accepts a valid move", () => {
    const s = makeState();
    const num = s.grids[0][0];
    assert.equal(bingo.validate(s, 0, { number: num }), null);
  });

  test("rejects a move when the game is over", () => {
    const s = { ...makeState(), over: true };
    assert.notEqual(bingo.validate(s, 0, { number: s.grids[0][0] }), null);
  });
});

describe("apply — shared crossing", () => {
  test("crosses the called number on both grids", () => {
    const s = makeState();
    const num = s.grids[0][0];
    const s2 = bingo.apply(s, 0, { number: num });
    assert.ok(s2.crossed[0].includes(num));
    assert.ok(s2.crossed[1].includes(num));
  });

  test("advances to the other seat after each call", () => {
    const s = makeState();
    const s2 = bingo.apply(s, 0, { number: s.grids[0][0] });
    assert.equal(s2.turn, 1);
    const s3 = bingo.apply(s2, 1, { number: s2.grids[1][0] });
    assert.equal(s3.turn, 0);
  });

  test("increments moves counter", () => {
    const s = makeState();
    const s2 = bingo.apply(s, 0, { number: s.grids[0][0] });
    assert.equal(s2.moves, 1);
  });
});

describe("line detection & letters", () => {
  test("awards a letter when a row is completed", () => {
    // Cross all 5 numbers in seat 0's first row (index 0..4 → row 0).
    const row0Nums = () => {
      const s = makeState();
      return LINES[0].map((idx) => s.grids[0][idx]);
    };
    let s = makeState();
    const targets = LINES[0].map((idx) => s.grids[0][idx]);
    for (const num of targets) {
      // seat 0 calls the target
      if (s.turn === 0) {
        s = bingo.apply(s, 0, { number: num });
      } else {
        // seat 1 must play first — pick any uncrossed non-target
        const n1 = uncrossedNumbers(s.grids[1], s.crossed[1]).find(
          (n) => !targets.includes(n)
        )!;
        s = bingo.apply(s, 1, { number: n1 });
        s = bingo.apply(s, 0, { number: num });
      }
    }
    assert.ok(s.lettersEarned[0] >= 1, "seat 0 should have at least 1 letter");
  });
});

describe("outcome", () => {
  test("returns null while in progress", () => {
    const s = makeState();
    assert.equal(bingo.outcome(s), null);
  });

  test("seat 0 wins when it earns 5 letters first", () => {
    const s = makeState();
    const forced = { ...s, over: true, lettersEarned: [5, 2] as [number, number] };
    const out = bingo.outcome(forced);
    assert.ok(out !== null);
    assert.equal(out!.winner, 0);
    assert.equal(out!.draw, false);
  });

  test("draw when both hit BINGO simultaneously", () => {
    const s = makeState();
    const forced = { ...s, over: true, lettersEarned: [5, 5] as [number, number] };
    const out = bingo.outcome(forced);
    assert.ok(out !== null && out!.draw === true);
  });
});

describe("view — hidden info", () => {
  test("viewer gets their own grid", () => {
    const s = makeState();
    const v0 = bingo.view(s, 0);
    assert.deepEqual(v0.myGrid, s.grids[0]);
  });

  test("viewer does NOT get opponent grid layout in the view", () => {
    const s = makeState();
    const v0 = bingo.view(s, 0);
    assert.ok(!("oppGrid" in v0));
  });

  test("spectator gets null for myGrid", () => {
    const s = makeState();
    const v = bingo.view(s, "spectator");
    assert.equal(v.myGrid, null);
    assert.equal(v.you, null);
  });

  test("you field is set correctly per viewer", () => {
    const s = makeState();
    assert.equal(bingo.view(s, 0).you, 0);
    assert.equal(bingo.view(s, 1).you, 1);
  });
});

describe("bot", () => {
  test("returns a legal move from a valid state", () => {
    const rng = createRng("bot-test");
    const s = makeState();
    const view = bingo.view(s, 0);
    const move = bingo.bot(view, 0, rng);
    assert.equal(bingo.validate(s, 0, move), null);
  });
});

describe("onTimeout", () => {
  test("auto-calls the first uncrossed number on the active seat's grid", () => {
    const s = makeState();
    const expected = s.grids[s.turn][0];
    const rng = createRng("timeout-seed");
    const s2 = bingo.onTimeout(s, rng);
    assert.ok(s2.crossed[s.turn].includes(expected));
  });
});

describe("deadlineMs", () => {
  test("returns TURN_MS while playing", () => {
    const s = makeState();
    assert.ok(bingo.deadlineMs(s)! > 0);
  });

  test("returns null when game is over", () => {
    const s = { ...makeState(), over: true };
    assert.equal(bingo.deadlineMs(s), null);
  });
});

describe("activeSeats", () => {
  test("returns the current turn seat while playing", () => {
    const s = makeState();
    assert.deepEqual(bingo.activeSeats(s), [0]);
  });

  test("returns empty array when over", () => {
    const s = { ...makeState(), over: true };
    assert.deepEqual(bingo.activeSeats(s), []);
  });
});

describe("BINGO_LETTERS", () => {
  test("has exactly 5 letters: B I N G O", () => {
    assert.deepEqual([...BINGO_LETTERS], ["B", "I", "N", "G", "O"]);
  });
});

describe("uncrossedNumbers", () => {
  test("returns all numbers when nothing is crossed", () => {
    const s = makeState();
    const uncrossed = uncrossedNumbers(s.grids[0], s.crossed[0]);
    assert.equal(uncrossed.length, 25);
  });

  test("excludes crossed numbers", () => {
    const s = makeState();
    const num = s.grids[0][0];
    const s2 = bingo.apply(s, 0, { number: num });
    const uncrossed = uncrossedNumbers(s2.grids[0], s2.crossed[0]);
    assert.equal(uncrossed.includes(num), false);
    assert.equal(uncrossed.length, 24);
  });
});
