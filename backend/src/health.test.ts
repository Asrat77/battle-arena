import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "./app";
import { MemoryStore } from "./store";

test("GET /health answers ok", async () => {
  const { httpServer, io } = createApp({ store: new MemoryStore(), db: null });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    io.close();
  }
});

test("GET /health reports the database when one is configured", async () => {
  for (const [db, expected] of [
    [{ query: async () => ({}), end: async () => {} }, "ok"],
    [{ query: async () => { throw new Error("down"); }, end: async () => {} }, "error"],
  ] as const) {
    const { httpServer, io } = createApp({ store: new MemoryStore(), db: db as never });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, database: expected });
    } finally {
      io.close();
    }
  }
});
