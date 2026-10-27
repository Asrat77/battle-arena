import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyChain } from "../../engine/ledger";
import { createApp } from "./app";
import { Ledger } from "./ledger";
import { FileStore, MemoryStore } from "./store";

test("appends are pending until the block time passes, then recorded", async () => {
  const ledger = new Ledger(new MemoryStore(), { blockTimeMs: 50 });
  const started = Date.now();
  const first = ledger.append("commit", { matchId: "a" });
  const second = ledger.append("result", { matchId: "a", winner: 0 });
  assert.equal(ledger.pendingCount(), 2);
  assert.equal(ledger.blocks().length, 0);

  const [a, b] = await Promise.all([first, second]);
  assert.ok(Date.now() - started >= 45);
  assert.equal(ledger.pendingCount(), 0);
  assert.deepEqual([a.index, b.index], [0, 1]);
  assert.equal(b.prevHash, a.hash);
  assert.deepEqual(verifyChain(ledger.blocks(), ledger.publicKey), { ok: true });
});

test("default block time is about two seconds", async () => {
  const ledger = new Ledger(new MemoryStore());
  const started = Date.now();
  await ledger.append("mint", { to: "0xabc", amount: 10 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1900 && elapsed < 3000, `took ${elapsed} ms`);
});

test("chain and signing key survive a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-"));
  try {
    const path = join(dir, "db.json");
    const before = new Ledger(new FileStore(path), { blockTimeMs: 1 });
    await before.append("commit", { matchId: "x" });

    const after = new Ledger(new FileStore(path), { blockTimeMs: 1 });
    assert.equal(after.publicKey, before.publicKey);
    const next = await after.append("result", { matchId: "x", winner: 1 });
    assert.equal(next.index, 1);
    assert.deepEqual(verifyChain(after.blocks(), after.publicKey), { ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ledger endpoints serve the chain and its public key", async () => {
  const { httpServer, io, ledger } = createApp({ store: new MemoryStore(), ledger: { blockTimeMs: 1 } });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const base = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  try {
    await ledger.append("badge", { profileId: "0xabc", badge: "First Blood" });
    const body = await (await fetch(`${base}/api/ledger`)).json();
    assert.deepEqual(verifyChain(body.blocks, body.publicKey), { ok: true });
    assert.deepEqual(await (await fetch(`${base}/api/ledger/0`)).json(), body.blocks[0]);
    assert.equal((await fetch(`${base}/api/ledger/5`)).status, 404);
  } finally {
    io.close();
  }
});
