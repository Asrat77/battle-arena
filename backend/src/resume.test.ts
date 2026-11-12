// A restart must not cancel staked matches (audit C2): they are saved after every move
// and resumed on boot, and only stakes for matches that can't be resumed go back.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { io as connect } from "socket.io-client";
import { firstToThree } from "../../engine/games/firstToThree";
import type { AnyGame } from "../../engine/types";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { DISCONNECT_FORFEIT_MS, RESUME_GRACE_MS } from "./matches";
import { MemoryStore } from "./store";
import { BIRR, DEFAULTS } from "./wallet";

const games: AnyGame[] = [firstToThree];
const lookup = { get: (id: string) => games.find((g) => g.id === id), list: () => games };
const STAKE = 100 * BIRR;

function boot(store: MemoryStore, clock = new FakeClock()) {
  return { ...createApp({ store, clock, games: lookup, ledger: { blockTimeMs: 1 } }), clock };
}

/** A staked first-to-three match between two new players, as the lobby starts one. */
function stakedMatch(app: ReturnType<typeof boot>) {
  const [alice, bob] = ["Alice", "Bob"].map((n) => app.identity.signup(n));
  app.wallet.faucet(alice.profile.id);
  app.wallet.faucet(bob.profile.id);
  const held = app.wallet.hold([alice.profile.id, bob.profile.id], STAKE);
  assert.ok(held.ok);
  const m = app.matches.create({ game: firstToThree, players: [alice.profile.id, bob.profile.id], durable: true });
  app.wallet.bind(held.escrow.id, m.id);
  return { alice, bob, m, escrowId: held.escrow.id };
}

describe("restart", () => {
  test("a staked match resumes where it was and still pays the winner", () => {
    const store = new MemoryStore();
    const first = boot(store);
    const { alice, bob, m, escrowId } = stakedMatch(first);
    const seat0 = m.players[0];
    assert.equal(first.matches.move(seat0, m.id, { type: "point" }), null);
    first.io.close();

    // The old process is gone; a new one boots from the same store.
    const second = boot(store);
    const back = second.matches.get(m.id);
    assert.ok(back, "match resumed");
    assert.equal(back.log.length, 1);
    assert.deepEqual((back.cur.state as any).scores, [1, 0]);
    assert.equal(second.wallet.escrow(escrowId)?.status, "held");

    // Play it out: seat 0 scores every turn, seat 1 passes.
    while (!back.cur.outcome) {
      const seat: 0 | 1 = (back.cur.state as { turn: 0 | 1 }).turn;
      assert.equal(second.matches.move(back.players[seat], back.id, { type: seat === 0 ? "point" : "pass" }), null);
    }
    assert.equal(back.cur.outcome.winner, 0);
    assert.equal(second.wallet.escrow(escrowId)?.status, "settled");
    const winner = seat0 === alice.profile.id ? alice : bob;
    assert.equal(second.wallet.balanceOf(winner.profile.id), DEFAULTS.faucetAmount + 80 * BIRR);
    // Finished matches are no longer kept for resuming.
    assert.deepEqual(store.read("liveMatches", {}), {});
    second.io.close();
  });

  test("players get a longer grace after a restart, and nobody showing up is a draw", () => {
    const store = new MemoryStore();
    const first = boot(store);
    const { alice, bob, m, escrowId } = stakedMatch(first);
    first.io.close();

    const second = boot(store);
    const back = second.matches.get(m.id)!;
    second.clock.advance(DISCONNECT_FORFEIT_MS);
    assert.equal(back.cur.outcome, null, "the normal 30 s does not apply right after a restart");
    second.clock.advance(RESUME_GRACE_MS - DISCONNECT_FORFEIT_MS);
    assert.deepEqual(back.cur.outcome, { winner: null, draw: true, reason: "abandoned" });
    assert.equal(second.wallet.escrow(escrowId)?.status, "refunded");
    assert.equal(second.wallet.balanceOf(alice.profile.id), DEFAULTS.faucetAmount);
    assert.equal(second.wallet.balanceOf(bob.profile.id), DEFAULTS.faucetAmount);
    second.io.close();
  });

  test("a stake whose match can't be resumed is refunded on boot", () => {
    const store = new MemoryStore();
    const first = boot(store);
    const { alice, escrowId } = stakedMatch(first);
    first.io.close();
    store.write("liveMatches", {}); // e.g. the save was lost

    const second = boot(store);
    assert.equal(second.wallet.escrow(escrowId)?.status, "refunded");
    assert.equal(second.wallet.balanceOf(alice.profile.id), DEFAULTS.faucetAmount);
    second.io.close();
  });

  test("a friendly match is not saved", () => {
    const store = new MemoryStore();
    const app = boot(store);
    const [a, b] = ["A", "B"].map((n) => app.identity.signup(n).profile.id);
    app.matches.create({ game: firstToThree, players: [a, b] });
    assert.deepEqual(store.read("liveMatches", {}), {});
    app.io.close();
  });

  test("the player who stays connected wins when the other drops out", async () => {
    const store = new MemoryStore();
    const app = boot(store);
    const { alice, bob, m, escrowId } = stakedMatch(app);
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    const url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
    const socket = connect(url, { auth: { token: alice.token }, transports: ["websocket"], forceNew: true, reconnection: false });
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    app.clock.advance(DISCONNECT_FORFEIT_MS);
    const aliceSeat = m.players.indexOf(alice.profile.id);
    assert.deepEqual(m.cur.outcome, { winner: aliceSeat, draw: false, reason: "forfeit" });
    assert.equal(app.wallet.escrow(escrowId)?.status, "settled");
    assert.equal(app.wallet.balanceOf(alice.profile.id), DEFAULTS.faucetAmount + 80 * BIRR);
    assert.equal(app.wallet.balanceOf(bob.profile.id), DEFAULTS.faucetAmount - STAKE);
    socket.disconnect();
    app.io.close();
  });

  test("a throwing end listener can't stop the stake from being paid (M7)", () => {
    const app = boot(new MemoryStore());
    const { m, escrowId } = stakedMatch(app);
    // Put a broken listener first, ahead of the wallet's.
    app.matches.prependListener("end", () => {
      throw new Error("recorder blew up");
    });
    const original = console.error;
    console.error = () => {};
    try {
      while (!m.cur.outcome) {
        const seat: 0 | 1 = (m.cur.state as { turn: 0 | 1 }).turn;
        assert.equal(app.matches.move(m.players[seat], m.id, { type: seat === 0 ? "point" : "pass" }), null);
      }
    } finally {
      console.error = original;
    }
    assert.equal(app.wallet.escrow(escrowId)?.status, "settled");
    app.io.close();
  });

  test("the first to leave forfeits even if the other drops later (review R1)", async () => {
    const app = boot(new MemoryStore());
    const { alice, bob, m, escrowId } = stakedMatch(app);
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    const url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
    const join = async (token: string) => {
      const s = connect(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
      await new Promise<void>((resolve) => s.once("connect", resolve));
      return s;
    };
    const wait = () => new Promise((r) => setTimeout(r, 50));
    const a = await join(alice.token);
    const b = await join(bob.token);
    await wait();
    assert.deepEqual(m.away, [null, null]);
    // Alice (losing) leaves; Bob drops 27 s later, before Alice's 30 s are up.
    a.disconnect();
    await wait();
    app.clock.advance(27_000);
    b.disconnect();
    await wait();
    app.clock.advance(3_000);
    const aliceSeat = m.players.indexOf(alice.profile.id);
    assert.deepEqual(m.cur.outcome, { winner: aliceSeat === 0 ? 1 : 0, draw: false, reason: "forfeit" });
    assert.equal(app.wallet.escrow(escrowId)?.status, "settled");
    assert.equal(app.wallet.balanceOf(bob.profile.id), DEFAULTS.faucetAmount + 80 * BIRR);
    app.io.close();
  });
});
