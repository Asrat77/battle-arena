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

    const me = await fetch(`${base}/api/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.deepEqual(await me.json(), { ...profile, username: null });
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

test("claim a guest profile, then sign in from another device", () => {
  const store = new MemoryStore();
  const identity = new Identity(store);
  const guest = identity.signup("Abebe");
  identity.claim(guest.token, "Abebe_1", "correct horse");
  const again = identity.login(" ABEBE_1 ", "correct horse");
  assert.equal(again.profile.id, guest.profile.id);
  assert.notEqual(again.token, guest.token);
  assert.equal(identity.byToken(guest.token)?.id, guest.profile.id);
  assert.equal(identity.account(guest.profile.id).username, "abebe_1");
  assert.ok(!JSON.stringify(store.read("profiles", {})).includes("correct horse"));
  assert.throws(() => identity.claim(guest.token, "other", "another pass"), /already has a password/);
});

test("login rejects bad credentials and locks out guessing", () => {
  let now = 1000;
  const identity = new Identity(new MemoryStore(), () => now);
  identity.signup("Sara", { username: "sara", password: "hunter2hunter2" });
  assert.throws(() => identity.login("nobody", "hunter2hunter2"), /wrong username or password/);
  for (let i = 0; i < 4; i++) assert.throws(() => identity.login("sara", "nope nope"), /wrong username or password/);
  assert.throws(() => identity.login("sara", "nope nope"), /wrong username or password/);
  assert.throws(() => identity.login("sara", "hunter2hunter2"), /too many attempts/);
  now += 61_000;
  assert.equal(identity.login("sara", "hunter2hunter2").profile.name, "Sara");
});

test("usernames are unique and validated; logout revokes the token", () => {
  const identity = new Identity(new MemoryStore());
  const a = identity.signup("A", { username: "taken", password: "password1" });
  assert.throws(() => identity.signup("B", { username: "TAKEN", password: "password1" }), /taken/);
  assert.throws(() => identity.signup("B", { username: "x", password: "password1" }), /username/);
  assert.throws(() => identity.signup("B", { username: "okname", password: "short" }), /password/);
  identity.logout(a.token);
  assert.equal(identity.byToken(a.token), null);
});
