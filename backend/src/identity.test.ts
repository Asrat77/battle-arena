import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "./app";
import { Identity } from "./identity";
import { FileStore, MemoryStore } from "./store";

test("signup twice gives distinct addresses and tokens", () => {
  const identity = new Identity(new MemoryStore());
  const a = identity.signup("Abebe");
  const b = identity.signup("Abebe");
  assert.match(a.profile.id, /^0x[0-9a-f]{40}$/);
  assert.match(b.profile.id, /^0x[0-9a-f]{40}$/);
  assert.notEqual(a.profile.id, b.profile.id);
  assert.notEqual(a.token, b.token);
  assert.equal(identity.byToken(a.token)?.id, a.profile.id);
  assert.equal(identity.byToken(b.token)?.id, b.profile.id);
  assert.equal(identity.byToken("nope"), null);
});

test("signup rejects empty and overlong names", () => {
  const identity = new Identity(new MemoryStore());
  assert.throws(() => identity.signup("   "));
  assert.throws(() => identity.signup("x".repeat(25)));
  assert.throws(() => identity.signup(42));
  assert.equal(identity.signup("  Sara ").profile.name, "Sara");
});

test("restart keeps profiles and sessions", () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-"));
  try {
    const path = join(dir, "db.json");
    const { profile, token } = new Identity(new FileStore(path)).signup("Lily");
    const reopened = new Identity(new FileStore(path));
    assert.deepEqual(reopened.get(profile.id), profile);
    assert.deepEqual(reopened.byToken(token), profile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("profile endpoints never expose keys", async () => {
  const { httpServer, io } = createApp({ store: new MemoryStore() });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const base = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  try {
    const signup = await fetch(`${base}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hana" }),
    });
    assert.equal(signup.status, 201);
    const { profile, token } = await signup.json();

    const me = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } });
    assert.deepEqual(await me.json(), profile);
    assert.equal((await fetch(`${base}/api/me`)).status, 401);

    const pub = await (await fetch(`${base}/api/profiles/${profile.id}`)).json();
    assert.deepEqual(Object.keys(pub).sort(), ["createdAt", "id", "name"]);
    assert.equal((await fetch(`${base}/api/profiles/0x${"0".repeat(40)}`)).status, 404);

    const bad = await fetch(`${base}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    assert.equal(bad.status, 400);
  } finally {
    io.close();
  }
});
