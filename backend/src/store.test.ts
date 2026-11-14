import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { PgStore, storeKindFromEnv } from "./pgStore";
import { createPool } from "./db";
import { importJson } from "./importJson";
import { FileStore, MemoryStore, type Store } from "./store";
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

// ---------------------------------------------------------------------------
// Contract: every Store behaves the same. PgStore needs a database: set
// DATABASE_URL_TEST (a Neon branch, never production). Each run uses a throwaway schema.

interface Handle {
  store: Store;
  /** A new store over the same persisted data (undefined for MemoryStore). */
  reopen?: () => Promise<Store>;
  done?: () => Promise<void>;
}

const testUrl = process.env.DATABASE_URL_TEST;

async function pgHandle(): Promise<Handle> {
  const schema = `t_${Math.random().toString(36).slice(2, 10)}`;
  const pool = createPool(testUrl!);
  await pool.query(`create schema ${schema}`);
  await pool.query(
    `create table ${schema}.kv (key text primary key, value jsonb not null, version bigint not null default 1, updated_at timestamptz not null default now())`,
  );
  const open = () => PgStore.open(pool, { table: `${schema}.kv` });
  const first = await open();
  let latest = first;
  return {
    store: first,
    reopen: async () => {
      await latest.flush();
      latest = await open();
      return latest;
    },
    done: async () => {
      await latest.flush();
      await pool.query(`drop schema ${schema} cascade`);
      await pool.end();
    },
  };
}

const impls: Array<{ name: string; make: () => Promise<Handle>; skip?: string | false }> = [
  { name: "MemoryStore", make: async () => ({ store: new MemoryStore() }) },
  {
    name: "FileStore",
    make: async () => {
      const path = tmp();
      return { store: new FileStore(path, { backupEveryMs: 0 }), reopen: async () => new FileStore(path, { backupEveryMs: 0 }) };
    },
  },
  { name: "PgStore", make: pgHandle, skip: !testUrl && "set DATABASE_URL_TEST to run" },
];

for (const impl of impls) {
  describe(`Store contract: ${impl.name}`, { skip: impl.skip }, () => {
    async function withStore(fn: (h: Handle) => Promise<void>) {
      const h = await impl.make();
      try {
        await fn(h);
      } finally {
        await h.done?.();
      }
    }

    test("read returns the fallback for a missing key, then what was written", () =>
      withStore(async ({ store }) => {
        assert.deepEqual(store.read("a", { n: 0 }), { n: 0 });
        store.write("a", { n: 1, list: [1, "two", { three: 3 }], nested: null });
        assert.deepEqual(store.read("a", null), { n: 1, list: [1, "two", { three: 3 }], nested: null });
        store.write("a", { n: 2 });
        assert.deepEqual(store.read("a", null), { n: 2 });
      }));

    test("remove deletes the key", () =>
      withStore(async ({ store }) => {
        store.write("a", 1);
        store.remove("a");
        assert.equal(store.read("a", "gone"), "gone");
        store.remove("never-existed");
      }));

    test("an object edited in place and written again keeps the edit", () =>
      withStore(async ({ store }) => {
        const doc = store.read<{ items: number[] }>("doc", { items: [] });
        doc.items.push(1);
        store.write("doc", doc);
        doc.items.push(2);
        store.write("doc", doc);
        assert.deepEqual(store.read("doc", null), { items: [1, 2] });
      }));

    test("data survives a reopen", async (t) => {
      const h = await impl.make();
      try {
        if (!h.reopen) return t.skip("not persistent");
        h.store.write("keep", { a: [1, 2, 3] });
        h.store.write("drop", 1);
        h.store.remove("drop");
        h.store.write("keep2", "x");
        const again = await h.reopen();
        assert.deepEqual(again.read("keep", null), { a: [1, 2, 3] });
        assert.equal(again.read("keep2", null), "x");
        assert.equal(again.read("drop", "gone"), "gone");
      } finally {
        await h.done?.();
      }
    });

    test("a Wallet on this store keeps its balances across a reopen", async (t) => {
      const h = await impl.make();
      try {
        if (!h.reopen) return t.skip("not persistent");
        const wallet = new Wallet(h.store, { mode: "play" });
        assert.ok(wallet.faucet("a").ok);
        const bal = wallet.balanceOf("a");
        assert.ok(bal > 0);
        const again = new Wallet(await h.reopen(), { mode: "play" });
        assert.equal(again.balanceOf("a"), bal);
      } finally {
        await h.done?.();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// PgStore behaviour that does not need a real database: a fake pool records statements.

function fakeDb(opts: { failTimes?: number } = {}) {
  const calls: Array<{ keys: string[]; values: string[]; removed: string[] }> = [];
  let failLeft = opts.failTimes ?? 0;
  const db = {
    async query(sql: string, params?: unknown[]) {
      if (/select key, value/.test(sql)) return { rows: [] };
      if (failLeft > 0) {
        failLeft--;
        throw new Error("connection lost");
      }
      const [keys, values, removed] = params as [string[], string[], string[]];
      calls.push({ keys, values, removed });
      return { rows: [] };
    },
    async end() {},
  };
  return { db: db as never, calls };
}

describe("store selection", () => {
  test("DATABASE_URL alone keeps the file store; Postgres needs STORE=postgres", () => {
    assert.equal(storeKindFromEnv({}), "file");
    assert.equal(storeKindFromEnv({ DATABASE_URL: "postgres://x" }), "file");
    assert.equal(storeKindFromEnv({ STORE: "file", DATABASE_URL: "postgres://x" }), "file");
    assert.equal(storeKindFromEnv({ STORE: "postgres", DATABASE_URL: "postgres://x" }), "postgres");
    assert.equal(storeKindFromEnv({ STORE: " Postgres ", DATABASE_URL: "postgres://x" }), "postgres");
  });
  test("STORE=postgres without DATABASE_URL, or an unknown value, refuses to start", () => {
    assert.throws(() => storeKindFromEnv({ STORE: "postgres" }), /needs DATABASE_URL/);
    assert.throws(() => storeKindFromEnv({ STORE: "pg", DATABASE_URL: "postgres://x" }), /must be/);
  });
});

describe("PgStore queue", () => {
  const quiet = { log: () => {}, backoffMs: 1, maxBackoffMs: 4 };

  test("writes serialise a snapshot at call time, in order, and coalesce per key", async () => {
    const { db, calls } = fakeDb();
    const store = await PgStore.open(db, quiet);
    const doc = { n: 1 };
    store.write("a", doc);
    doc.n = 2; // edited after write(): the queued snapshot was already taken, but this write re-snapshots
    store.write("a", doc);
    store.write("b", [1]);
    store.remove("c");
    assert.ok(await store.flush());
    const all = calls.flatMap((c) => c.keys.map((k, i) => [k, c.values[i]]));
    assert.deepEqual(Object.fromEntries(all), { a: '{"n":2}', b: "[1]" });
    assert.ok(calls.some((c) => c.removed.includes("c")));
    assert.equal(store.status().pendingWrites, 0);
  });

  test("writes made in the same tick go to the database in one statement", async () => {
    const { db, calls } = fakeDb();
    const store = await PgStore.open(db, quiet);
    store.write("profiles", { a: 1 });
    store.write("sessions", { t: "a" });
    assert.ok(await store.flush());
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].keys.sort(), ["profiles", "sessions"]);
  });

  test("a failing database keeps the writes queued, reports it, and retries until saved", async () => {
    const { db, calls } = fakeDb({ failTimes: 3 });
    const store = await PgStore.open(db, quiet);
    store.write("a", 1);
    await new Promise((r) => setTimeout(r, 2));
    assert.ok(store.status().lastError, "failure is visible");
    assert.ok(store.status().pendingWrites > 0);
    assert.equal(store.read("a", 0), 1, "memory already has it");
    assert.ok(await store.flush(2000));
    assert.equal(store.status().lastError, null);
    assert.equal(store.status().pendingWrites, 0);
    assert.deepEqual(calls.at(-1)!.keys, ["a"]);
  });

  test("flush(timeout) gives up with false while the database stays down", async () => {
    const { db } = fakeDb({ failTimes: 1_000_000 });
    const store = await PgStore.open(db, { ...quiet, backoffMs: 5, maxBackoffMs: 5 });
    store.write("a", 1);
    assert.equal(await store.flush(50), false);
    assert.equal(store.status().pendingWrites, 1);
  });

  test("rejects a table name that is not a plain identifier", async () => {
    const { db } = fakeDb();
    await assert.rejects(PgStore.open(db, { table: "kv; drop table x" }), /invalid table name/);
  });
});

describe("importJson", { skip: !testUrl && "set DATABASE_URL_TEST to run" }, () => {
  test("imports, verifies, is idempotent, and dry run saves nothing", async () => {
    const h = await pgHandle();
    const pool = createPool(testUrl!);
    const schemaTable = (h.store as unknown as { table: string }).table;
    try {
      const data = { profiles: { a: { n: 1.5, s: "é" } }, ledger: [1, 2, 3], empty: {} };
      const client = await pool.connect();
      try {
        const dry = await importJson(client, data, { dryRun: true, table: schemaTable });
        assert.deepEqual(dry, { keys: 3, mismatches: [], rolledBack: true });
        assert.equal((await pool.query(`select count(*)::int n from ${schemaTable}`)).rows[0].n, 0);
        assert.deepEqual((await importJson(client, data, { table: schemaTable })).mismatches, []);
        assert.deepEqual((await importJson(client, data, { table: schemaTable })).mismatches, [], "idempotent");
        assert.equal((await pool.query(`select version::int v from ${schemaTable} where key='ledger'`)).rows[0].v, 2);
        // A table holding a key the file lacks is a mismatch, and rolls back.
        await pool.query(`insert into ${schemaTable} (key, value) values ('extra', '1')`);
        const bad = await importJson(client, data, { table: schemaTable });
        assert.ok(bad.mismatches.some((m) => m.includes("extra")));
        assert.equal(bad.rolledBack, true);
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
      await h.done!();
    }
  });
});
