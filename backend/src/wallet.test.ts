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
import { BIRR, DEFAULTS, depositHoldFromEnv, LEGACY_REPORT, PLATFORM_ACCOUNT, Wallet, walletModeFromEnv } from "./wallet";

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

test("real money needs WALLET_MODE=real and REAL_MONEY_LEGAL_OK=1 (audit C3)", () => {
  assert.equal(walletModeFromEnv(undefined, undefined), "play");
  assert.equal(walletModeFromEnv("yes", "1"), "play");
  assert.equal(walletModeFromEnv("real", undefined), "play");
  assert.equal(walletModeFromEnv("real", "0"), "play");
  assert.equal(walletModeFromEnv("real", "yes"), "play");
  assert.equal(walletModeFromEnv("real", "1"), "real");
});

describe("play and real books (audit H6)", () => {
  test("faucet birr never shows up, or can be withdrawn, after a switch to real mode", () => {
    const store = new MemoryStore();
    const play = new Wallet(store, { mode: "play" });
    assert.ok(play.faucet("a").ok);
    assert.equal(play.balanceOf("a"), DEFAULTS.faucetAmount);

    const real = new Wallet(store, { mode: "real" });
    assert.equal(real.balanceOf("a"), 0);
    assert.deepEqual(real.withdraw("a", 100 * BIRR, "w1"), { ok: false, reason: "insufficient balance" });
    assert.ok(real.deposit("a", 70 * BIRR, "d1").ok);
    assert.equal(real.balanceOf("a"), 70 * BIRR);

    // And back: the real deposit is not play money either.
    const again = new Wallet(store, { mode: "play" });
    assert.equal(again.balanceOf("a"), DEFAULTS.faucetAmount);
  });

  test("a stake held in one book still settles in it after the mode changes", () => {
    const store = new MemoryStore();
    const play = new Wallet(store, { mode: "play" });
    play.faucet("a");
    play.faucet("b");
    const held = play.hold(["a", "b"], 100 * BIRR);
    assert.ok(held.ok);
    play.bind(held.escrow.id, "m1");

    const real = new Wallet(store, { mode: "real" });
    assert.equal(real.escrowForMatch("m1")?.id, held.escrow.id);
    real.settle(held.escrow.id, { winner: 0, draw: false });
    assert.equal(real.balanceOf("a"), 0, "the prize is play money, not real");
    assert.equal(new Wallet(store, { mode: "play" }).balanceOf("a"), DEFAULTS.faucetAmount - 100 * BIRR + 180 * BIRR);
  });

  test("withdrawal refunds go to the real book even in play mode", () => {
    const store = new MemoryStore();
    const real = new Wallet(store, { mode: "real", depositHoldMs: 0 });
    real.deposit("a", 100 * BIRR, "d1");
    real.withdraw("a", 100 * BIRR, "w1");
    const play = new Wallet(store, { mode: "play" });
    play.refundWithdrawal("a", 100 * BIRR, "w1");
    assert.equal(play.balanceOf("a"), 0);
    assert.equal(play.txnFor("withdrawal-refund", "w1")?.amount, 100 * BIRR);
    assert.equal(new Wallet(store, { mode: "real" }).balanceOf("a"), 100 * BIRR);
  });

  test("the old shared book becomes play money and its real deposits are reported", () => {
    const store = new MemoryStore();
    const ts = 1;
    store.write("wallet", {
      balances: { a: 150 * BIRR, b: 500 * BIRR },
      txns: [
        { id: "1", profileId: "a", kind: "deposit", amount: 200 * BIRR, balance: 200 * BIRR, ref: "dep1", ts },
        { id: "2", profileId: "a", kind: "withdrawal", amount: -50 * BIRR, balance: 150 * BIRR, ref: "w1", ts },
        { id: "3", profileId: "b", kind: "faucet", amount: 500 * BIRR, balance: 500 * BIRR, ref: null, ts },
      ],
      escrows: {},
      lastFaucet: { b: ts },
    });
    const real = new Wallet(store, { mode: "real" });
    assert.equal(store.read("wallet", null), null, "old key removed");
    assert.equal(real.balanceOf("a"), 0, "mixed money is not withdrawable");
    assert.equal(new Wallet(store, { mode: "play" }).balanceOf("a"), 150 * BIRR);
    assert.deepEqual(store.read<any>(LEGACY_REPORT, null).profiles, {
      a: { deposited: 200 * BIRR, withdrawn: 50 * BIRR, refunded: 0, balance: 150 * BIRR },
    });
    // Restart recovery still finds money moved before the split.
    assert.equal(real.depositTxn("dep1")?.amount, 200 * BIRR);
    assert.equal(real.txnFor("withdrawal", "w1")?.amount, -50 * BIRR);
  });
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

describe("deposit hold (audit M5)", () => {
  test("a deposit can be staked at once but withdrawn only after the hold", () => {
    const { wallet, advance } = setup({ mode: "real" });
    assert.ok(wallet.deposit("a", 300 * BIRR, "d1").ok);
    assert.deepEqual(wallet.withdrawable("a"), { amount: 0, held: 300 * BIRR, heldUntil: 1_000_000 + DAY });
    const r = wallet.withdraw("a", 100 * BIRR, "w1");
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /24 hours after they arrive; you can withdraw 0 birr now/);
    assert.equal(wallet.balanceOf("a"), 300 * BIRR, "nothing taken");

    // Staking is allowed straight away.
    assert.ok(wallet.deposit("b", 300 * BIRR, "d2").ok);
    const held = wallet.hold(["a", "b"], 100 * BIRR);
    assert.ok(held.ok);
    wallet.settle(held.escrow.id, { winner: 0, draw: false });
    // b staked their own fresh deposit, so a's winnings wait as long as it would have (review R5).
    assert.equal(wallet.withdrawable("a").amount, 0);

    advance(DAY);
    assert.equal(wallet.withdrawable("a").amount, 380 * BIRR);
    assert.ok(wallet.withdraw("a", 380 * BIRR, "w2").ok);
  });

  test("losing a fresh deposit leaves nothing held beyond the balance", () => {
    const { wallet } = setup({ mode: "real" });
    wallet.deposit("a", 100 * BIRR, "d1");
    wallet.deposit("b", 100 * BIRR, "d2");
    const h = wallet.hold(["a", "b"], 100 * BIRR);
    assert.ok(h.ok);
    wallet.settle(h.escrow.id, { winner: 1, draw: false });
    assert.deepEqual(wallet.withdrawable("a"), { amount: 0, held: 0, heldUntil: 1_000_000 + DAY });
  });

  test("DEPOSIT_HOLD_HOURS", () => {
    assert.equal(depositHoldFromEnv(undefined), DAY);
    assert.equal(depositHoldFromEnv(""), DAY);
    assert.equal(depositHoldFromEnv("abc"), DAY);
    assert.equal(depositHoldFromEnv("-1"), DAY);
    assert.equal(depositHoldFromEnv("0"), 0);
    assert.equal(depositHoldFromEnv("48"), 2 * DAY);
  });
});
