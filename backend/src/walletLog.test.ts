// HTTP bodies are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { createApp } from "./app";
import { FileStore, MemoryStore } from "./store";
import { BIRR, DEFAULTS, PLATFORM_ACCOUNT, Wallet } from "./wallet";
import { FileTxnLog, MemoryTxnLog, verifyChain } from "./walletLog";

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);

function busy(opts: ConstructorParameters<typeof Wallet>[1] = {}) {
  const store = new MemoryStore();
  const log = new MemoryTxnLog();
  let t = Date.UTC(2026, 10, 12, 12);
  const now = () => t;
  const play = new Wallet(store, { mode: "play", log, now, ...opts });
  play.faucet(A);
  play.faucet(B);
  const h = play.hold([A, B], 100 * BIRR);
  assert.ok(h.ok);
  play.settle(h.escrow.id, { winner: 0, draw: false });
  const real = new Wallet(store, { mode: "real", log, now, ...opts });
  real.deposit(A, 300 * BIRR, "dep1");
  real.withdraw(A, 100 * BIRR, "w1");
  real.refundWithdrawal(A, 100 * BIRR, "w1");
  return { store, log, play, real, advance: (ms: number) => (t += ms) };
}

describe("wallet log and reconcile (audit M1)", () => {
  test("every change is logged and the log replays to the stored balances", () => {
    const { log, real } = busy();
    const r = real.reconcile();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.chain, "intact");
    assert.equal(log.entries().filter((e) => e.type === "txn").length, 2 + 2 + 2 + 3);
    assert.deepEqual(
      r.books.map((b) => [b.book, b.txns]),
      [
        ["play", 6],
        ["real", 3],
      ],
    );
  });

  test("a balance edited outside the wallet shows up", () => {
    const { store, real } = busy();
    store.read<any>("wallet:real", null).balances[A] += 1000 * BIRR;
    const r = real.reconcile();
    assert.equal(r.ok, false);
    assert.deepEqual(r.books.find((b) => b.book === "real")!.mismatches, [{ profileId: A, stored: 1300 * BIRR, logged: 300 * BIRR }]);
  });

  test("an escrow whose money doesn't add up shows up", () => {
    const { store, real, play } = busy();
    const h = play.hold([A, B], 50 * BIRR);
    assert.ok(h.ok);
    assert.equal(real.reconcile().ok, true);
    store.read<any>("wallet:play", null).escrows[h.escrow.id].stake = 500 * BIRR;
    const book = real.reconcile().books.find((b) => b.book === "play")!;
    assert.equal(book.escrows.length, 1);
  });

  test("changing a past log entry breaks the chain", () => {
    const { log, real } = busy();
    const e = log.entries()[4] as any;
    e.txn.amount += 1;
    assert.match(String((real.reconcile().chain as any).reason), /changed after it was written/);
    assert.equal(verifyChain(log.entries())?.at, 4);
  });

  test("a failed store write logs nothing", () => {
    const path = join(mkdtempSync(join(tmpdir(), "wlog-")), "db.json");
    let failing = false;
    const store = new FileStore(path, {
      backupEveryMs: 0,
      writeFile: (p, text) => {
        if (failing) throw new Error("disk full");
        writeFileSync(p, text);
      },
    });
    const log = new MemoryTxnLog();
    const w = new Wallet(store, { mode: "play", log });
    w.faucet(A);
    const n = log.entries().length;
    failing = true;
    assert.throws(() => w.faucet(B));
    assert.equal(log.entries().length, n);
    failing = false;
    assert.equal(w.reconcile().ok, true);
  });

  test("the file log carries on across restarts and spots a cut-short line", () => {
    const dir = mkdtempSync(join(tmpdir(), "wlog-"));
    const store = new FileStore(join(dir, "db.json"), { backupEveryMs: 0 });
    const path = join(dir, "wallet-log.jsonl");
    new Wallet(store, { mode: "play", log: new FileTxnLog(path) }).faucet(A);
    const again = new Wallet(store, { mode: "play", log: new FileTxnLog(path) });
    again.faucet(B);
    assert.equal(readFileSync(path, "utf8").trim().split("\n").length, 4, "2 opening entries, 2 txns, no second opening");
    assert.equal(again.reconcile().ok, true);
    appendFileSync(path, '{"seq":4,"ts"');
    assert.notEqual(new Wallet(store, { mode: "play", log: new FileTxnLog(path) }).reconcile().chain, "intact");
  });
});

describe("history kept in the store (audit L2)", () => {
  test("only the newest game transactions stay in the store; money in and out always stays", () => {
    const { store, real, play, advance, log } = busy({ hotTxns: 4, faucetWindowMs: 1 });
    for (let i = 0; i < 6; i++) {
      advance(1);
      play.faucet(A);
    }
    const stored = store.read<any>("wallet:play", null).txns.filter((t: any) => t.profileId === A);
    assert.equal(stored.length, 4);
    assert.ok(stored.every((t: any) => t.kind === "faucet"), "the newest four");
    const realTxns = store.read<any>("wallet:real", null).txns;
    assert.deepEqual(realTxns.map((t: any) => t.kind), ["deposit", "withdrawal", "withdrawal-refund"]);
    assert.equal(log.entries().filter((e) => e.type === "txn" && e.book === "play" && e.txn.profileId === A).length, 3 + 6);
    assert.equal(real.reconcile().ok, true, "the log still has everything");
  });
});

describe("fees and adjustments (audit L1)", () => {
  test("fee report and taking fees out with a reason", () => {
    const { play } = busy();
    const fee = 20 * BIRR;
    let r = play.feeReport("play");
    assert.equal(r.balance, fee);
    assert.equal(r.collected, fee);
    assert.deepEqual(r.byDay, { "2026-11-12": { fees: fee, matches: 1 } });

    assert.deepEqual(play.adjust("play", PLATFORM_ACCOUNT, -fee, "", "admin"), { ok: false, reason: "give a reason" });
    assert.deepEqual(play.adjust("play", PLATFORM_ACCOUNT, -fee - 1, "move to bank", "admin"), { ok: false, reason: "balance would go negative" });
    assert.deepEqual(play.adjust("play", "__proto__", 1, "nope", "admin"), { ok: false, reason: "bad profile id" });
    assert.ok(play.adjust("play", PLATFORM_ACCOUNT, -fee, "moved to bank", "admin").ok);
    r = play.feeReport("play");
    assert.equal(r.balance, 0);
    assert.equal(r.adjustments[0].amount, -fee);
    assert.equal(r.adjustments[0].note, "moved to bank");
    assert.equal(play.reconcile().ok, true);
  });
});

describe("admin routes", () => {
  test("are hidden without ADMIN_TOKEN and need the token", async () => {
    const { httpServer, io, identity, wallet } = createApp({ store: new MemoryStore(), wallet: { mode: "play" } });
    await new Promise<void>((r) => httpServer.listen(0, r));
    const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
    const prev = process.env.ADMIN_TOKEN;
    try {
      delete process.env.ADMIN_TOKEN;
      assert.equal((await fetch(`${url}/api/admin/wallet/reconcile`)).status, 404);
      process.env.ADMIN_TOKEN = "short";
      assert.equal((await fetch(`${url}/api/admin/wallet/reconcile`, { headers: { "x-admin-token": "short" } })).status, 404);
      const token = "t".repeat(32);
      process.env.ADMIN_TOKEN = token;
      assert.equal((await fetch(`${url}/api/admin/wallet/reconcile`, { headers: { "x-admin-token": "nope" } })).status, 401);
      const me = identity.signup("Alice").profile;
      wallet.faucet(me.id);
      const ok = await fetch(`${url}/api/admin/wallet/reconcile`, { headers: { "x-admin-token": token } });
      assert.equal(ok.status, 200);
      assert.equal(((await ok.json()) as any).ok, true);
      const adj = await fetch(`${url}/api/admin/wallet/adjust`, {
        method: "POST",
        headers: { "x-admin-token": token, "content-type": "application/json" },
        body: JSON.stringify({ book: "play", profileId: me.id, amount: 5 * BIRR, reason: "bug refund", by: "asrat" }),
      });
      assert.equal(adj.status, 200);
      assert.equal(((await adj.json()) as any).txn.by, "admin:asrat");
      assert.equal(wallet.balanceOf(me.id), DEFAULTS.faucetAmount + 5 * BIRR);
      const fees = await fetch(`${url}/api/admin/wallet/fees?book=play`, { headers: { "x-admin-token": token } });
      assert.equal(((await fees.json()) as any).book, "play");
    } finally {
      if (prev === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = prev;
      io.close();
      httpServer.close();
    }
  });
});
