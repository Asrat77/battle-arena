import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonical } from "./canonical";
import { firstToThree, type FirstToThreeMove } from "./games/firstToThree";
import { sha256Hex } from "./hash";
import { resultHash } from "./record";
import { getGame } from "./registry";
import { ReplayError, checkEntry, initial, replay, step } from "./replay";
import { createRng, rngForEntry } from "./rng";
import type { LogEntry, MatchRecord, Seat } from "./types";

const SEED = "seed-abc";

const mv = (t: number, seat: Seat, type: FirstToThreeMove["type"]): LogEntry => ({ t, seat, move: { type } });

// seat 0 scores 3 with a pass, a timeout and seat 1 points in between.
const LOG: LogEntry[] = [
  mv(1, 0, "point"),
  mv(2, 1, "point"),
  mv(3, 0, "pass"),
  { t: 4, seat: "system", move: { type: "timeout" } },
  mv(5, 0, "point"),
  mv(6, 1, "pass"),
  mv(7, 0, "point"),
];

function record(log: LogEntry[]): MatchRecord {
  const { outcome } = replay(firstToThree, SEED, log);
  assert.ok(outcome, "test log should finish the match");
  return {
    matchId: "m1",
    gameId: firstToThree.id,
    players: ["0xaaa", "0xbbb"],
    bot: false,
    seed: SEED,
    log,
    outcome,
    startedAt: 0,
    endedAt: 7,
  };
}

describe("canonical", () => {
  test("sorts keys at every depth and drops undefined", () => {
    assert.equal(canonical({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[1,{"y":2,"z":1}]},"b":1}');
  });
  test("key order does not change the output", () => {
    assert.equal(canonical({ x: 1, y: 2 }), canonical({ y: 2, x: 1 }));
  });
  test("rejects non-finite numbers", () => {
    assert.throws(() => canonical({ n: NaN }));
  });
});

describe("hash", () => {
  test("sha256 hex matches the known vector", () => {
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("rng", () => {
  test("same seed gives the same sequence, different seeds differ", () => {
    const seq = (s: string) => Array.from({ length: 5 }, ((r) => () => r.int(1000))(createRng(s)));
    assert.deepEqual(seq("a"), seq("a"));
    assert.notDeepEqual(seq("a"), seq("b"));
  });
  test("int stays in range", () => {
    const r = createRng("range");
    for (let i = 0; i < 1000; i++) {
      const n = r.int(7);
      assert.ok(n >= 0 && n < 7 && Number.isInteger(n));
    }
  });
  test("entry rng depends on seed and index", () => {
    assert.equal(rngForEntry("s", 3).next(), rngForEntry("s", 3).next());
    assert.notEqual(rngForEntry("s", 3).next(), rngForEntry("s", 4).next());
  });
});

describe("replay", () => {
  test("replaying the same log is byte-identical", () => {
    const a = replay(firstToThree, SEED, LOG);
    const b = replay(firstToThree, SEED, structuredClone(LOG));
    assert.equal(canonical(a), canonical(b));
    assert.deepEqual(a.outcome, { winner: 0, draw: false, reason: "reached 3" });
  });

  test("step-by-step (server path) equals replay", () => {
    let cur = initial(firstToThree, SEED);
    LOG.forEach((e, i) => (cur = step(firstToThree, SEED, cur, e, i)));
    assert.equal(canonical(cur), canonical(replay(firstToThree, SEED, LOG)));
  });

  test("illegal moves are rejected by validate", () => {
    const s = firstToThree.setup({ seed: SEED });
    assert.equal(firstToThree.validate(s, 0, { type: "point" }), null);
    assert.equal(firstToThree.validate(s, 1, { type: "point" }), "not your turn");
    assert.match(firstToThree.validate(s, 0, { type: "cheat" } as never) ?? "", /move must be/);
    assert.match(firstToThree.validate(s, 0, null as never) ?? "", /move must be/);
  });

  test("replay throws on an illegal entry and names its index", () => {
    const bad = [mv(1, 0, "point"), mv(2, 0, "point")];
    assert.throws(() => replay(firstToThree, SEED, bad), (e: unknown) => e instanceof ReplayError && e.index === 1);
  });

  test("entries after the match ends are rejected", () => {
    assert.throws(() => replay(firstToThree, SEED, [...LOG, mv(8, 1, "point")]), /match is over/);
  });

  test("forfeit ends the match for the other seat", () => {
    const { outcome } = replay(firstToThree, SEED, [mv(1, 0, "point"), { t: 2, seat: "system", move: { type: "forfeit", seat: 1 } }]);
    assert.deepEqual(outcome, { winner: 0, draw: false, reason: "forfeit" });
  });

  test("checkEntry reports without throwing", () => {
    const cur = initial(firstToThree, SEED);
    assert.equal(checkEntry(firstToThree, cur, mv(1, 1, "pass")), "not your turn");
    assert.equal(checkEntry(firstToThree, cur, mv(1, 0, "pass")), null);
  });

  test("bot vs bot with timeouts is deterministic for a seed", () => {
    const play = (seed: string) => {
      const rng = createRng(`${seed}:bots`);
      let cur = initial(firstToThree, seed);
      const log: LogEntry[] = [];
      while (!cur.outcome) {
        const seat = firstToThree.activeSeats(cur.state)[0];
        const entry: LogEntry =
          rng.next() < 0.2
            ? { t: log.length, seat: "system", move: { type: "timeout" } }
            : { t: log.length, seat, move: firstToThree.bot(firstToThree.view(cur.state, seat), seat, rng) };
        cur = step(firstToThree, seed, cur, entry, log.length);
        log.push(entry);
      }
      return { log, cur };
    };
    const a = play("bots-1");
    assert.equal(canonical(replay(firstToThree, "bots-1", a.log)), canonical(a.cur));
    assert.equal(canonical(play("bots-1").log), canonical(a.log));
  });
});

describe("views", () => {
  test("a seat sees only its own secret; spectators see none", () => {
    const s = firstToThree.setup({ seed: SEED });
    const v0 = JSON.stringify(firstToThree.view(s, 0));
    const spec = JSON.stringify(firstToThree.view(s, "spectator"));
    assert.ok(v0.includes(s.secrets[0]) && !v0.includes(s.secrets[1]));
    assert.ok(!spec.includes(s.secrets[0]) && !spec.includes(s.secrets[1]));
  });
});

describe("resultHash", () => {
  const base = record(LOG);
  const h = resultHash(base);

  test("is a stable sha256 hex", () => {
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(resultHash(structuredClone(base)), h);
  });

  test("changing any log entry changes the hash", () => {
    LOG.forEach((_, i) => {
      for (const change of [{ t: 999 }, { seat: base.log[i].seat === 1 ? 0 : 1 }, { move: { type: "other" } }]) {
        const log = structuredClone(LOG);
        log[i] = { ...log[i], ...change } as LogEntry;
        assert.notEqual(resultHash({ ...base, log }), h, `entry ${i} ${JSON.stringify(change)}`);
      }
    });
    assert.notEqual(resultHash({ ...base, log: LOG.slice(0, -1) }), h, "dropping an entry");
  });

  test("changing any other field changes the hash", () => {
    const changes: Partial<MatchRecord>[] = [
      { matchId: "m2" },
      { gameId: "x" },
      { players: ["0xbbb", "0xaaa"] },
      { bot: true },
      { seed: "other" },
      { outcome: { winner: 1, draw: false, reason: "reached 3" } },
      { startedAt: 1 },
      { endedAt: 8 },
    ];
    for (const c of changes) assert.notEqual(resultHash({ ...base, ...c }), h, JSON.stringify(c));
  });
});

describe("registry", () => {
  test("unknown ids return undefined", () => {
    assert.equal(getGame("nope"), undefined);
  });
});
