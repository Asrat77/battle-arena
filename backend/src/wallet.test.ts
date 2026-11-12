// HTTP bodies are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { io as connect } from "socket.io-client";
import { ticTacToe } from "../../engine/games/ticTacToe";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { DISCONNECT_FORFEIT_MS } from "./matches";
import { MemoryStore } from "./store";
import { BIRR, DEFAULTS, PLATFORM_ACCOUNT, Wallet, walletModeFromEnv } from "./wallet";

const DAY = 24 * 60 * 60 * 1000;

function setup(opts: ConstructorParameters<typeof Wallet>[1] = {}) {
  let t = 1_000_000;
  const store = new MemoryStore();
  const changes: [string, number][] = [];
  const wallet = new Wallet(store, { now: () => t, onChange: (id, b) => changes.push([id, b]), ...opts });
  return { store, wallet, changes, advance: (ms: number) => (t += ms) };
}

/** Two players topped up from the faucet. */
function funded() {
  const s = setup();
  assert.ok(s.wallet.faucet("a").ok);
  assert.ok(s.wallet.faucet("b").ok);
  return s;
}

describe("faucet", () => {
  test("gives play money once per window", () => {
    const { wallet, advance } = setup();
    const r = wallet.faucet("a");
    assert.deepEqual(r, { ok: true, balance: DEFAULTS.faucetAmount });
    assert.deepEqual(wallet.faucet("a"), { ok: false, reason: "already topped up today" });
    advance(DAY);
    assert.ok(wallet.faucet("a").ok);
    assert.equal(wallet.balanceOf("a"), DEFAULTS.faucetAmount * 2);
  });

  test("is off in real mode", () => {
    const { wallet } = setup({ mode: "real" });
    assert.deepEqual(wallet.faucet("a"), { ok: false, reason: "play money is off" });
    assert.equal(wallet.balanceOf("a"), 0);
  });
});

describe("escrow", () => {
  test("holds both stakes, pays the winner the pot minus 10%", () => {
    const { wallet } = funded();
    const stake = 100 * BIRR;
    const r = wallet.hold(["a", "b"], stake);
    assert.ok(r.ok);
    assert.equal(wallet.balanceOf("a"), DEFAULTS.faucetAmount - stake);
    assert.equal(wallet.balanceOf("b"), DEFAULTS.faucetAmount - stake);

    const e = wallet.settle(r.escrow.id, { winner: 1, draw: false });
    assert.equal(e?.status, "settled");
    assert.equal(e?.winner, 1);
    assert.equal(wallet.balanceOf("a"), DEFAULTS.faucetAmount - stake);
    assert.equal(wallet.balanceOf("b"), DEFAULTS.faucetAmount - stake + 180 * BIRR);
    assert.equal(wallet.balanceOf(PLATFORM_ACCOUNT), 20 * BIRR);
  });

  test("a draw refunds both stakes with no fee", () => {
    const { wallet } = funded();
    const r = wallet.hold(["a", "b"], 50 * BIRR);
    assert.ok(r.ok);
    assert.equal(wallet.settle(r.escrow.id, { winner: null, draw: true })?.status, "refunded");
    assert.equal(wallet.balanceOf("a"), DEFAULTS.faucetAmount);
    assert.equal(wallet.balanceOf("b"), DEFAULTS.faucetAmount);
    assert.equal(wallet.balanceOf(PLATFORM_ACCOUNT), 0);
  });

  test("settles only once", () => {
    const { wallet } = funded();
    const r = wallet.hold(["a", "b"], 50 * BIRR);
    assert.ok(r.ok);
    wallet.settle(r.escrow.id, { winner: 0, draw: false });
    const before = wallet.balanceOf("a");
    assert.equal(wallet.settle(r.escrow.id, { winner: 0, draw: false }), null);
    assert.equal(wallet.refund(r.escrow.id), null);
    assert.equal(wallet.balanceOf("a"), before);
  });

  test("holds nothing when either player is short", () => {
    const { wallet } = setup();
    wallet.faucet("a");
    assert.deepEqual(wallet.hold(["a", "b"], 50 * BIRR), { ok: false, reason: "opponent has insufficient balance" });
    assert.deepEqual(wallet.hold(["b", "a"], 50 * BIRR), { ok: false, reason: "insufficient balance" });
    assert.equal(wallet.balanceOf("a"), DEFAULTS.faucetAmount);
  });

  test("rejects stakes outside the limits", () => {
    const { wallet } = funded();
    assert.equal(wallet.hold(["a", "b"], 5 * BIRR).ok, false);
    assert.equal(wallet.hold(["a", "b"], 501 * BIRR).ok, false);
    assert.equal(wallet.hold(["a", "b"], 10.5).ok, false);
    assert.equal(wallet.hold(["a", "a"], 50 * BIRR).ok, false);
  });

  test("the fee rounds down to whole santim", () => {
    const { wallet } = setup({ feeBps: 333 });
    assert.deepEqual(wallet.payout(1_001), { prize: 2_002 - 66, fee: 66 });
  });

  test("refundAllHeld returns stakes left over from a restart", () => {
    const { wallet, store } = funded();
    const r = wallet.hold(["a", "b"], 50 * BIRR);
    assert.ok(r.ok);
    const reborn = new Wallet(store);
    assert.equal(reborn.refundAllHeld().length, 1);
    assert.equal(reborn.balanceOf("a"), DEFAULTS.faucetAmount);
    assert.equal(reborn.escrow(r.escrow.id)?.status, "refunded");
  });

  test("history is newest first and pushes balance changes", () => {
    const { wallet, changes } = funded();
    const r = wallet.hold(["a", "b"], 50 * BIRR);
    assert.ok(r.ok);
    assert.deepEqual(
      wallet.history("a").map((t) => [t.kind, t.amount, t.balance]),
      [
        ["hold", -5_000, 45_000],
        ["faucet", 50_000, 50_000],
      ],
    );
    assert.deepEqual(changes.at(-1), ["b", 45_000]);
  });
});

test("WALLET_MODE only turns real money on when set to real", () => {
  assert.equal(walletModeFromEnv(undefined), "play");
  assert.equal(walletModeFromEnv("yes"), "play");
  assert.equal(walletModeFromEnv("real"), "real");
});

describe("app", () => {
  test("a staked match nobody turns up for is abandoned and both stakes go back", () => {
    const clock = new FakeClock();
    const { io, matches, identity, wallet } = createApp({ store: new MemoryStore(), clock });
    const [alice, bob] = ["Alice", "Bob"].map((n) => identity.signup(n).profile);
    wallet.faucet(alice.id);
    wallet.faucet(bob.id);
    const held = wallet.hold([alice.id, bob.id], 100 * BIRR);
    assert.ok(held.ok);
    const m = matches.create({ game: ticTacToe, players: [alice.id, bob.id] });
    wallet.bind(held.escrow.id, m.id);

    // Neither is connected, so both forfeit clocks run. Both gone is a draw, not a
    // loss for whoever dropped first (audit M6).
    clock.advance(DISCONNECT_FORFEIT_MS);
    assert.deepEqual(m.cur.outcome, { winner: null, draw: true, reason: "abandoned" });
    assert.equal(wallet.escrow(held.escrow.id)?.status, "refunded");
    assert.equal(wallet.balanceOf(alice.id), DEFAULTS.faucetAmount);
    assert.equal(wallet.balanceOf(bob.id), DEFAULTS.faucetAmount);
    io.close();
  });

  test("routes: config, wallet and faucet", async () => {
    const { httpServer, io, identity } = createApp({ store: new MemoryStore() });
    const { token } = identity.signup("Carol");
    await new Promise<void>((r) => httpServer.listen(0, r));
    const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
    const auth = { authorization: `Bearer ${token}` };
    try {
      const config: any = await (await fetch(`${url}/api/wallet/config`)).json();
      assert.equal(config.mode, "play");
      assert.equal(config.minStake, 10 * BIRR);

      assert.equal((await fetch(`${url}/api/wallet`)).status, 401);
      const empty: any = await (await fetch(`${url}/api/wallet`, { headers: auth })).json();
      assert.equal(empty.balance, 0);
      assert.equal(empty.faucetReadyAt, null);

      const topped: any = await (await fetch(`${url}/api/wallet/faucet`, { method: "POST", headers: auth })).json();
      assert.equal(topped.balance, DEFAULTS.faucetAmount);
      const again = await fetch(`${url}/api/wallet/faucet`, { method: "POST", headers: auth });
      assert.equal(again.status, 400);

      const after: any = await (await fetch(`${url}/api/wallet`, { headers: auth })).json();
      assert.equal(after.history.length, 1);
      assert.ok(after.faucetReadyAt > Date.now());
    } finally {
      io.close();
      httpServer.close();
    }
  });

  test("socket: wallet:get and wallet:faucet", async () => {
    const { httpServer, io, identity } = createApp({ store: new MemoryStore() });
    const { token } = identity.signup("Dana");
    await new Promise<void>((r) => httpServer.listen(0, r));
    const socket = connect(`http://localhost:${(httpServer.address() as AddressInfo).port}`, {
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    const call = (event: string): Promise<any> => new Promise((r) => socket.emit(event, r));
    const pushed = new Promise<any>((r) => socket.once("wallet:balance", r));
    try {
      assert.equal((await call("wallet:get")).wallet.balance, 0);
      const topped = await call("wallet:faucet");
      assert.equal(topped.ok, true);
      assert.equal(topped.wallet.balance, DEFAULTS.faucetAmount);
      assert.deepEqual(await pushed, { balance: DEFAULTS.faucetAmount });
      assert.deepEqual(await call("wallet:faucet"), { ok: false, reason: "already topped up today" });
    } finally {
      socket.disconnect();
      io.close();
      httpServer.close();
    }
  });
});
