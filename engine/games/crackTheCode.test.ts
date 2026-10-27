import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonical } from "../canonical";
import { getGame } from "../registry";
import { replay, step, initial, checkEntry, type MatchState } from "../replay";
import { createRng } from "../rng";
import type { LogEntry, Seat, Viewer } from "../types";
import {
  ALL_CODES,
  MAX_ROUNDS,
  commitment,
  crackTheCode as game,
  feedback,
  isCode,
  type CtcState,
} from "./crackTheCode";

const SEED = "ctc-seed";
const secret = (t: number, seat: Seat, code: string): LogEntry => ({ t, seat, move: { type: "secret", code } });
const guess = (t: number, seat: Seat, code: string): LogEntry => ({ t, seat, move: { type: "guess", code } });
const timeout = (t: number): LogEntry => ({ t, seat: "system", move: { type: "timeout" } });

describe("feedback", () => {
  const table: [string, string, number, number][] = [
    // guess, secret, present, exact
    ["1234", "1234", 4, 4],
    ["4321", "1234", 4, 0],
    ["5678", "1234", 0, 0],
    ["1243", "1234", 4, 2],
    ["1567", "1234", 1, 1],
    ["5167", "1234", 1, 0],
    ["2135", "1234", 3, 1],
    ["9182", "1234", 2, 0],
    ["1289", "1234", 2, 2],
    ["3412", "1234", 4, 0],
  ];
  for (const [g, s, present, exact] of table) {
    test(`${g} vs ${s} = ${present} present, ${exact} exact`, () => {
      assert.deepEqual(feedback(g, s), { present, exact });
    });
  }
});

describe("codes", () => {
  test("legal codes are 4 distinct digits 1-9", () => {
    assert.equal(ALL_CODES.length, 9 * 8 * 7 * 6);
    for (const bad of ["0123", "1123", "123", "12345", "abcd", 1234, null]) assert.equal(isCode(bad), false, String(bad));
    assert.equal(isCode("9876"), true);
  });
});

describe("rules", () => {
  test("registered in the engine registry", () => {
    assert.equal(getGame("crack-the-code"), game);
  });

  test("seat 0 cracks the code first", () => {
    const { state, outcome } = replay<CtcState>(game, SEED, [
      secret(1, 0, "1234"),
      secret(2, 1, "5678"),
      guess(3, 0, "5687"),
      guess(4, 1, "1243"),
      guess(5, 1, "1235"),
      guess(6, 0, "5678"),
    ]);
    assert.deepEqual(outcome, { winner: 0, draw: false, reason: "cracked the code" });
    assert.deepEqual(state.history[0].guesses, [
      { code: "5687", present: 4, exact: 2 },
      { code: "1243", present: 4, exact: 2 },
    ]);
  });

  test("both cracking in the same round is a draw", () => {
    const { outcome } = replay(game, SEED, [secret(1, 0, "1234"), secret(2, 1, "5678"), guess(3, 0, "5678"), guess(4, 1, "1234")]);
    assert.deepEqual(outcome, { winner: null, draw: true, reason: "both cracked the code" });
  });

  test("illegal moves are rejected with a reason", () => {
    let cur = initial(game, SEED);
    const reject = (e: LogEntry) => assert.ok(checkEntry(game, cur, e), JSON.stringify(e));
    reject(guess(1, 0, "1234"));
    reject(secret(1, 0, "1123"));
    reject(secret(1, 0, "0123"));
    reject({ t: 1, seat: 0, move: "1234" });
    cur = step(game, SEED, cur, secret(1, 0, "1234"), 0);
    reject(secret(2, 0, "5678"));
    cur = step(game, SEED, cur, secret(2, 1, "5678"), 1);
    reject(secret(3, 1, "5678"));
    cur = step(game, SEED, cur, guess(3, 0, "5678".split("").reverse().join("")), 2);
    reject(guess(4, 0, "1234"));
  });

  test("missing secret at the setup deadline forfeits", () => {
    assert.deepEqual(replay(game, SEED, [secret(1, 1, "1234"), timeout(2)]).outcome, {
      winner: 1,
      draw: false,
      reason: "no secret set",
    });
    assert.equal(replay(game, SEED, [timeout(1)]).outcome?.draw, true);
  });

  test("a missed guess counts as no guess and the round still resolves", () => {
    const { state, outcome } = replay<CtcState>(game, SEED, [
      secret(1, 0, "1234"),
      secret(2, 1, "5678"),
      guess(3, 0, "5679"),
      timeout(4),
    ]);
    assert.equal(outcome, null);
    assert.equal(state.round, 2);
    assert.deepEqual(state.history[0].guesses, [{ code: "5679", present: 3, exact: 3 }, null]);
    assert.deepEqual(game.activeSeats(state), [0, 1]);
  });

  test("the match ends in a draw at the round limit", () => {
    const log: LogEntry[] = [secret(1, 0, "1234"), secret(2, 1, "5678")];
    for (let i = 0; i < MAX_ROUNDS; i++) log.push(timeout(3 + i));
    assert.deepEqual(replay(game, SEED, log).outcome, { winner: null, draw: true, reason: "round limit" });
  });
});

describe("hidden information", () => {
  const SECRETS = ["1234", "5678"];
  const viewers: Viewer[] = [0, 1, "spectator"];

  test("no view carries the opponent's secret or pending guess before the end", () => {
    let cur: MatchState<CtcState> = initial(game, SEED);
    const log = [secret(1, 0, SECRETS[0]), secret(2, 1, SECRETS[1]), guess(3, 0, "9867"), guess(4, 1, "4213"), guess(5, 0, "9786")];
    const check = () => {
      for (const v of viewers) {
        const json = canonical(game.view(cur.state, v));
        for (const seat of [0, 1] as const) {
          if (v === seat) continue;
          assert.ok(!json.includes(SECRETS[seat]), `viewer ${v} sees secret of ${seat}: ${json}`);
          for (const salt of cur.state.salts) assert.ok(!json.includes(salt), `viewer ${v} sees a salt`);
          const pending = cur.state.pending[seat];
          if (pending) assert.ok(!json.includes(pending), `viewer ${v} sees pending guess of ${seat}`);
        }
      }
    };
    check();
    log.forEach((e, i) => {
      cur = step(game, SEED, cur, e, i);
      check();
    });
    assert.equal(cur.state.pending[0], "9786");
  });

  test("secrets show in views once the match is over", () => {
    const { state } = replay<CtcState>(game, SEED, [secret(1, 0, "1234"), secret(2, 1, "5678"), guess(3, 0, "5678"), guess(4, 1, "9876")]);
    assert.deepEqual(game.view(state, "spectator").secrets, ["1234", "5678"]);
  });
});

describe("commitments", () => {
  const { state } = replay<CtcState>(game, SEED, [secret(1, 0, "1234"), secret(2, 1, "5678"), guess(3, 0, "5678"), guess(4, 1, "9876")]);
  const commits = game.commitments!(state);
  const revealed = game.reveal!(state) as { secrets: string[]; salts: string[] };

  test("reveal matches the commitments", () => {
    for (const seat of [0, 1]) assert.equal(commitment(revealed.secrets[seat], revealed.salts[seat]), commits[String(seat)]);
  });

  test("a tampered secret fails the check", () => {
    assert.notEqual(commitment("1243", revealed.salts[0]), commits["0"]);
  });

  test("salts come from the seed and differ per seat", () => {
    assert.notEqual(revealed.salts[0], revealed.salts[1]);
    assert.deepEqual(game.setup({ seed: SEED }).salts, revealed.salts);
    assert.notDeepEqual(game.setup({ seed: "other" }).salts, revealed.salts);
  });
});

describe("bot", () => {
  /** Bot vs bot, each bot sees only its own view. Returns rounds played. */
  function botMatch(seed: string): { rounds: number; log: LogEntry[] } {
    const rngs = [createRng(`${seed}:bot0`), createRng(`${seed}:bot1`)];
    let cur = initial(game, seed);
    const log: LogEntry[] = [];
    while (!cur.outcome) {
      for (const seat of game.activeSeats(cur.state)) {
        if (cur.outcome) break;
        const entry: LogEntry = { t: log.length, seat, move: game.bot(game.view(cur.state, seat), seat, rngs[seat]) };
        cur = step(game, seed, cur, entry, log.length);
        log.push(entry);
      }
      assert.ok(log.length < 200, "bot match did not terminate");
    }
    return { rounds: cur.state.history.length, log };
  }

  test("bot vs bot always terminates, median <= 7 rounds over 200 games", () => {
    const rounds = Array.from({ length: 200 }, (_, i) => botMatch(`bot-${i}`).rounds).sort((a, b) => a - b);
    const median = (rounds[99] + rounds[100]) / 2;
    assert.ok(median <= 7, `median ${median}`);
    assert.ok(rounds[199] < MAX_ROUNDS, `max ${rounds[199]}`);
  });

  test("bot guesses stay consistent with its feedback", () => {
    const { log } = botMatch("consistency");
    const { state } = replay<CtcState>(game, "consistency", log);
    const target = state.secrets[1]!;
    const mine = state.history.map((r) => r.guesses[0]!);
    for (let i = 1; i < mine.length; i++) {
      for (const prev of mine.slice(0, i)) assert.deepEqual(feedback(prev.code, mine[i].code), { present: prev.present, exact: prev.exact });
    }
    assert.deepEqual(feedback(mine[0].code, target), { present: mine[0].present, exact: mine[0].exact });
  });

  test("bot replays deterministically", () => {
    assert.deepEqual(botMatch("det").log, botMatch("det").log);
  });
});
