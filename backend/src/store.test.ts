import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { FileStore } from "./store";
import { Wallet } from "./wallet";

function tmp() {
  return join(mkdtempSync(join(tmpdir(), "store-")), "db.json");
}

describe("FileStore (audit M2)", () => {
  test("a failed write rolls memory back to what is on disk and throws", () => {
    const path = tmp();
    let failing = false;
    const store = new FileStore(path, {
      writeFile: (p, text) => {
        if (failing) throw new Error("disk full");
        writeFileSync(p, text);
      },
    });
    const wallet = new Wallet(store, { mode: "play" });
    assert.ok(wallet.faucet("a").ok);
    const before = wallet.balanceOf("a");

    failing = true;
    assert.throws(() => wallet.faucet("b"), /disk full/);
    // The wallet changed its data in place before saving; none of that survives.
    assert.equal(wallet.balanceOf("b"), 0);
    assert.equal(wallet.history("b").length, 0);
    assert.equal(wallet.balanceOf("a"), before);

    failing = false;
    assert.ok(wallet.faucet("b").ok, "works again once the disk does");
    const reopened = new Wallet(new FileStore(path), { mode: "play" });
    assert.equal(reopened.balanceOf("a"), before);
    assert.equal(reopened.balanceOf("b"), before);
  });

  test("backs up on boot and then at most once per interval, keeping the newest copies", () => {
    const path = tmp();
    const dir = join(path, "..", "backups");
    let t = Date.UTC(2026, 10, 12);
    const opts = { now: () => t, backupEveryMs: 1000, keepBackups: 3 };
    const first = new FileStore(path, opts);
    first.write("x", 1);
    assert.equal(readdirSync(dir).length, 1, "first write backs up");
    first.write("x", 2);
    assert.equal(readdirSync(dir).length, 1, "not again within the interval");
    for (let i = 0; i < 5; i++) {
      t += 1000;
      first.write("x", 3 + i);
    }
    assert.equal(readdirSync(dir).length, 3, "only the newest 3 kept");
    t += 1;
    new FileStore(path, opts);
    assert.equal(readdirSync(dir).length, 3);
    assert.ok(readdirSync(dir).sort().at(-1)!.endsWith(".json"));
  });

  test("backupEveryMs 0 turns backups off", () => {
    const path = tmp();
    const store = new FileStore(path, { backupEveryMs: 0 });
    store.write("x", 1);
    assert.deepEqual(readdirSync(join(path, "..")), ["db.json"]);
  });
});
