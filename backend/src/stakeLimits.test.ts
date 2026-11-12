// Audit H8 (anti-collusion limits) and M8 (bingo can't be staked).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AddressInfo } from "node:net";
import { io as connect } from "socket.io-client";
import { firstToThree } from "../../engine/games/firstToThree";
import { listGames } from "../../engine/registry";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { UNSTAKED_GAMES } from "./lobby";
import { FLOW_MIN_MATCHES, STAKE_LIMITS, StakeLimits, stakeLimitsFromEnv } from "./stakeLimits";
import { MemoryStore } from "./store";
import { BIRR, Wallet } from "./wallet";

const DAY = 24 * 60 * 60_000;
const T0 = 1_700_000_000_000;

function setup(opts: { mode?: "play" | "real"; created?: Record<string, number>; guests?: string[] } = {}) {
  let now = T0;
  const wallet = new Wallet(new MemoryStore(), { mode: opts.mode ?? "real", now: () => now, depositHoldMs: 0 });
  const alerts: string[] = [];
  const limits = new StakeLimits(wallet, {
    createdAt: (id) => opts.created?.[id] ?? T0 - 30 * DAY,
    hasPassword: (id) => !opts.guests?.includes(id),
    alert: (t) => alerts.push(t),
    now: () => now,
  });
  if (wallet.mode === "real") for (const p of ["a", "b", "c"]) wallet.deposit(p, 5_000 * BIRR, `d-${p}`);
  const play = (x: string, y: string, stake: number, winner: 0 | 1 | null = 0) => {
    const held = wallet.hold([x, y], stake);
    assert.ok(held.ok);
    return wallet.settle(held.escrow.id, { winner, draw: winner === null })!;
  };
  return { wallet, limits, alerts, play, tick: (ms: number) => (now += ms) };
}

describe("stake limits", () => {
  test("off for play money", () => {
    const { limits } = setup({ mode: "play", guests: ["a"], created: { a: T0 } });
    assert.equal(limits.check(["a", "b"], 100_000 * BIRR), null);
  });

  test("guests and new accounts can't stake real money, on either side", () => {
    const { limits } = setup({ guests: ["g"], created: { n: T0 - 60 * 60_000 } });
    assert.match(limits.check(["g"], 10 * BIRR)!, /add a password/);
    assert.match(limits.check(["a", "g"], 10 * BIRR)!, /opponent needs a password/);
    assert.match(limits.check(["n"], 10 * BIRR)!, /24 hours after signing up/);
    assert.match(limits.check(["a", "n"], 10 * BIRR)!, /opponent's account is too new/);
    assert.equal(limits.check(["a", "b"], 10 * BIRR), null);
  });

  test("the same pair can start only pairPerDay staked matches in 24 hours; draws don't count", () => {
    const { limits, play, tick } = setup();
    play("a", "b", 10 * BIRR, null); // refunded draw: moved nothing
    for (let i = 0; i < STAKE_LIMITS.pairPerDay; i++) {
      assert.equal(limits.check(["a", "b"], 10 * BIRR), null);
      play(i % 2 ? "a" : "b", i % 2 ? "b" : "a", 10 * BIRR);
    }
    assert.match(limits.check(["b", "a"], 10 * BIRR)!, /3 staked matches with this player today/);
    assert.equal(limits.check(["a", "c"], 10 * BIRR), null, "another opponent is fine");
    tick(DAY);
    assert.equal(limits.check(["a", "b"], 10 * BIRR), null);
  });

  test("one player's stakes are capped per 24 hours", () => {
    const { limits, play } = setup();
    play("a", "b", 500 * BIRR);
    play("a", "c", 400 * BIRR);
    assert.match(limits.check(["a"], 200 * BIRR)!, /up to 1,000 birr a day; 100 birr left/);
    assert.equal(limits.check(["a"], 100 * BIRR), null);
    assert.match(limits.check(["c", "a"], 200 * BIRR)!, /opponent has reached their daily stake limit/);
  });

  test("a pair whose stakes all flow one way is flagged once a day", () => {
    const { limits, play, alerts, tick } = setup();
    let last;
    for (let i = 0; i < FLOW_MIN_MATCHES; i++) {
      if (i) tick(DAY);
      last = play(i % 2 ? "a" : "b", i % 2 ? "b" : "a", 10 * BIRR, i % 2 ? 1 : 0); // b wins every time
      assert.equal(limits.afterSettle(last), i === FLOW_MIN_MATCHES - 1 ? alerts[0] : null);
    }
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /b won all 4 staked matches against a/);
    // Not again the same day.
    assert.equal(limits.afterSettle(last!), null);
  });

  test("a pair that trades wins isn't flagged", () => {
    const { limits, play, alerts } = setup();
    for (let i = 0; i < FLOW_MIN_MATCHES + 2; i++) limits.afterSettle(play("a", "b", 10 * BIRR, (i % 2) as 0 | 1));
    assert.equal(alerts.length, 0);
  });

  test("env settings", () => {
    assert.deepEqual(stakeLimitsFromEnv({}), {});
    assert.deepEqual(stakeLimitsFromEnv({ STAKE_PAIR_DAILY_MAX: "5", STAKE_DAILY_MAX_BIRR: "250", STAKE_MIN_ACCOUNT_AGE_HOURS: "0" }), {
      pairPerDay: 5,
      perDay: 250 * BIRR,
      minAccountAgeMs: 0,
    });
    assert.deepEqual(stakeLimitsFromEnv({ STAKE_PAIR_DAILY_MAX: "zero", STAKE_DAILY_MAX_BIRR: "-1" }), {});
  });

  test("tic-tac-toe and bingo can't be staked (M8)", () => {
    assert.ok(UNSTAKED_GAMES.has("tic-tac-toe"));
    assert.ok(UNSTAKED_GAMES.has("bingo"));
  });

  test("wired into staked rooms in real-money mode", async () => {
    const games = [...listGames(), firstToThree];
    const { httpServer, io, identity, wallet } = createApp({
      store: new MemoryStore(),
      clock: new FakeClock(),
      games: { get: (id) => games.find((g) => g.id === id), list: () => games },
      wallet: { mode: "real", depositHoldMs: 0 },
    });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
    const send = async (token: string, event: string, msg: unknown) => {
      const s = connect(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
      try {
        return await new Promise<{ ok: boolean; reason?: string }>((resolve) => s.emit(event, msg, resolve));
      } finally {
        s.close();
      }
    };
    try {
      const guest = identity.signup("Guest");
      const fresh = identity.signup("Fresh", { username: "fresh", password: "password1" });
      for (const p of [guest, fresh]) wallet.deposit(p.profile.id, 500 * BIRR, `d-${p.profile.id}`);
      const stake = { gameId: firstToThree.id, stake: 50 * BIRR };
      assert.match((await send(guest.token, "room:create", stake)).reason!, /add a password/);
      assert.match((await send(fresh.token, "room:create", stake)).reason!, /24 hours after signing up/);
      assert.equal((await send(fresh.token, "room:create", { gameId: "bingo", stake: 50 * BIRR })).reason, "BINGO can't be staked");
    } finally {
      io.close();
    }
  });
});
