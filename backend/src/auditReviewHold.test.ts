// Audit fix review R5: the 24 h deposit hold can't be skipped by losing on purpose
// to another account, and a player losing to a ring of accounts is flagged.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FLOW_MIN_MATCHES, StakeLimits } from "./stakeLimits";
import { MemoryStore } from "./store";
import { BIRR, Wallet } from "./wallet";

const DAY = 24 * 60 * 60_000;
const T0 = Date.parse("2026-11-12T08:00:00Z");

describe("review R5: the deposit hold can't be skipped by losing on purpose", () => {
  function wallets() {
    let now = T0;
    const wallet = new Wallet(new MemoryStore(), { mode: "real", now: () => now, depositHoldMs: DAY });
    const play = (x: string, y: string, stake: number, winner: 0 | 1) => {
      const held = wallet.hold([x, y], stake);
      assert.ok(held.ok);
      return wallet.settle(held.escrow.id, { winner, draw: false })!;
    };
    return { wallet, play, tick: (ms: number) => (now += ms) };
  }

  test("winnings paid from an opponent's held deposit stay held until that deposit frees up", () => {
    const { wallet, play, tick } = wallets();
    wallet.deposit("old", 1_000 * BIRR, "d-old");
    tick(DAY + 1); // old's own money is free now
    assert.equal(wallet.withdrawable("old").amount, 1_000 * BIRR);
    wallet.deposit("fresh", 500 * BIRR, "d-fresh");
    play("fresh", "old", 500 * BIRR, 1); // fresh loses on purpose
    const w = wallet.withdrawable("old");
    assert.equal(w.amount, 1_000 * BIRR, "only old's own money is free");
    assert.equal(w.heldUntil, T0 + DAY + 1 + DAY);
    assert.match((wallet.withdraw("old", 1_400 * BIRR, "w1") as { reason: string }).reason, /winnings paid from someone's new deposit/);
    tick(DAY);
    assert.equal(wallet.withdrawable("old").amount, wallet.balanceOf("old"));
  });

  test("the hold follows the money down a chain of losses", () => {
    const { wallet, play, tick } = wallets();
    for (const p of ["b", "c"]) wallet.deposit(p, 100 * BIRR, `d-${p}`);
    tick(DAY + 1);
    wallet.deposit("a", 100 * BIRR, "d-a");
    play("a", "b", 100 * BIRR, 1); // a's fresh 100 -> b
    play("b", "c", 100 * BIRR, 1); // b passes held money on to c
    // 100 birr stakes, 10% fee: 80 of b's prize was a's held money, and those 80 pass on to c.
    assert.equal(wallet.withdrawable("b").held, 0);
    assert.equal(wallet.withdrawable("c").held, 80 * BIRR);
  });

  test("money staked from free funds passes on free", () => {
    const { wallet, play, tick } = wallets();
    for (const p of ["a", "b"]) wallet.deposit(p, 100 * BIRR, `d-${p}`);
    tick(DAY + 1);
    play("a", "b", 50 * BIRR, 1);
    assert.equal(wallet.withdrawable("b").held, 0);
  });

  test("a player losing every match to several accounts is flagged, once a day", () => {
    let now = T0;
    const wallet = new Wallet(new MemoryStore(), { mode: "real", now: () => now, depositHoldMs: 0 });
    for (const p of ["dump", "r1", "r2", "r3"]) wallet.deposit(p, 5_000 * BIRR, `d-${p}`);
    const alerts: string[] = [];
    const limits = new StakeLimits(wallet, { createdAt: () => 0, hasPassword: () => true, alert: (t) => alerts.push(t), now: () => now });
    const ring = ["r1", "r2", "r3"];
    for (let i = 0; i < FLOW_MIN_MATCHES; i++) {
      now += 60_000;
      const held = wallet.hold(["dump", ring[i % 3]], 50 * BIRR);
      assert.ok(held.ok);
      limits.afterSettle(wallet.settle(held.escrow.id, { winner: 1, draw: false })!);
    }
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /lost all 4 staked matches .* to 3 accounts/);
    const held = wallet.hold(["dump", "r1"], 50 * BIRR);
    assert.ok(held.ok);
    assert.equal(limits.afterSettle(wallet.settle(held.escrow.id, { winner: 1, draw: false })!), null, "flagged already today");
  });

  test("a player who won any of them isn't flagged", () => {
    let now = T0;
    const wallet = new Wallet(new MemoryStore(), { mode: "real", now: () => now, depositHoldMs: 0 });
    for (const p of ["p", "r1", "r2"]) wallet.deposit(p, 5_000 * BIRR, `d-${p}`);
    const alerts: string[] = [];
    const limits = new StakeLimits(wallet, { createdAt: () => 0, hasPassword: () => true, alert: (t) => alerts.push(t), now: () => now });
    const results: [string, 0 | 1][] = [["r1", 0], ["r2", 1], ["r1", 1], ["r2", 1], ["r1", 1]];
    for (const [opp, winner] of results) {
      now += 60_000;
      const held = wallet.hold(["p", opp], 50 * BIRR);
      assert.ok(held.ok);
      limits.afterSettle(wallet.settle(held.escrow.id, { winner, draw: false })!);
    }
    assert.equal(alerts.length, 0);
  });
});
