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
    assert.deepEqual(await me.json(), { ...profile, hasPassword: false });
    assert.equal(profile.username, "hana");
    assert.equal((await fetch(`${base}/api/me`)).status, 401);

    const pub = await (await fetch(`${base}/api/profiles/${profile.id}`)).json();
    assert.deepEqual(Object.keys(pub).sort(), ["createdAt", "id", "name", "username"]);
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
  assert.equal(identity.get(guest.profile.id)?.username, "abebe_1");
  assert.equal(identity.account(guest.profile.id).hasPassword, true);
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

test("avatar can be chosen at signup and changed later, only to known pictures", () => {
  const identity = new Identity(new MemoryStore());
  const plain = identity.signup("Abebe");
  assert.equal(plain.profile.avatar, undefined);
  assert.throws(() => identity.signup("Sara", undefined, "dragon"));

  const { profile, token } = identity.signup("Sara", undefined, "owl");
  assert.equal(profile.avatar, "owl");
  assert.equal(identity.get(profile.id)?.avatar, "owl");

  assert.equal(identity.setAvatar(token, "zebra").avatar, "zebra");
  assert.equal(identity.byToken(token)?.avatar, "zebra");
  assert.throws(() => identity.setAvatar(token, "robot"));
  assert.throws(() => identity.setAvatar("bad-token", "lion"));
});

test("every profile gets a unique handle; guests get one from their name", () => {
  const identity = new Identity(new MemoryStore());
  assert.equal(identity.signup("Abebe").profile.username, "abebe");
  assert.equal(identity.signup("abebe").profile.username, "abebe_2");
  assert.equal(identity.signup("Abebe K.").profile.username, "abebe_k");
  assert.equal(identity.signup("Zoë").profile.username, "zoe");
  assert.equal(identity.signup("አበበ").profile.username, "player");
  assert.equal(identity.signup("Bo").profile.username, "player_2");
  // A guest may pick a handle without a password; the name then defaults to it.
  const picked = identity.signup(undefined, { username: "@Lion_King" });
  assert.equal(picked.profile.username, "lion_king");
  assert.equal(picked.profile.name, "lion_king");
  assert.equal(identity.account(picked.profile.id).hasPassword, false);
  assert.throws(() => identity.signup("X", { username: "LION_KING" }), /taken/);
  assert.throws(() => identity.signup("X", { username: "bot" }), /taken/);
  assert.throws(() => identity.signup("X", { password: "password1" }), /username/);
  assert.throws(() => identity.signup(undefined), /name/);
});

test("old profiles without a handle are backfilled once, in signup order", () => {
  const store = new MemoryStore();
  const legacy = (id: string, name: string, createdAt: number, username?: string) => ({
    id,
    name,
    createdAt,
    publicKey: "",
    privateKey: "",
    ...(username && { username }),
  });
  store.write("profiles", {
    "0xb": legacy("0xb", "Sara", 2),
    "0xa": legacy("0xa", "Sara", 1),
    "0xc": legacy("0xc", "Someone", 3, "sara"),
  });
  const identity = new Identity(store);
  assert.equal(identity.get("0xc")?.username, "sara");
  assert.equal(identity.get("0xa")?.username, "sara_2");
  assert.equal(identity.get("0xb")?.username, "sara_3");
  const snapshot = JSON.stringify(store.read("profiles", {}));
  new Identity(store);
  assert.equal(JSON.stringify(store.read("profiles", {})), snapshot);
});

test("rename display name and username; the old handle is freed", () => {
  const changes: string[] = [];
  const identity = new Identity(new MemoryStore(), Date.now, { onChange: (p) => changes.push(`${p.name}@${p.username}`) });
  const a = identity.signup("Abebe", { username: "abebe", password: "password1" });
  const b = identity.signup("Sara");

  assert.equal(identity.update(a.token, { name: "  Abe  " }).name, "Abe");
  assert.equal(identity.update(a.token, { username: "Abe_The_Great" }).username, "abe_the_great");
  assert.deepEqual(changes, ["Abe@abebe", "Abe@abe_the_great"]);
  assert.equal(identity.byUsername("abebe"), null);
  assert.equal(identity.login("abe_the_great", "password1").profile.id, a.profile.id);
  assert.throws(() => identity.login("abebe", "password1"), /wrong username/);

  // abebe is free again, for someone else.
  assert.equal(identity.update(b.token, { username: "abebe" }).username, "abebe");
  assert.throws(() => identity.update(a.token, { username: "abebe" }), /taken/);
  assert.throws(() => identity.update(a.token, { username: "no spaces" }), /username/);
  assert.throws(() => identity.update(a.token, { name: "x".repeat(25) }), /name/);
  // Keeping your own handle (any case) is fine; an empty name resets to the handle.
  assert.equal(identity.update(a.token, { username: "ABE_THE_GREAT", name: "" }).name, "abe_the_great");
  assert.throws(() => identity.update("nope", { name: "Z" }), /session/);
  assert.equal(identity.usernameStatus("abebe").available, false);
  assert.equal(identity.usernameStatus("abebe", b.profile.id).available, true);
  assert.equal(identity.usernameStatus("fresh_one").available, true);
  assert.equal(identity.usernameStatus("x").available, false);
});

test("a guest keeps their handle when adding a password", () => {
  const identity = new Identity(new MemoryStore());
  const guest = identity.signup("Hana");
  assert.equal(identity.claim(guest.token, undefined, "password1").username, "hana");
  assert.equal(identity.login("hana", "password1").profile.id, guest.profile.id);
  const other = identity.signup("Lily");
  assert.throws(() => identity.claim(other.token, "hana", "password1"), /taken/);
});

test("change password checks the old one and signs out other devices", () => {
  const identity = new Identity(new MemoryStore());
  const here = identity.signup("Sara", { username: "sara", password: "first pass" });
  const there = identity.login("sara", "first pass");
  const guest = identity.signup("Guest");

  assert.throws(() => identity.changePassword(here.token, "wrong pass", "second pass"), /current password/);
  assert.throws(() => identity.changePassword(here.token, "first pass", "short"), /new password/);
  assert.throws(() => identity.changePassword(guest.token, "", "second pass"), /no password/);
  identity.changePassword(here.token, "first pass", "second pass");

  assert.equal(identity.byToken(here.token)?.id, here.profile.id);
  assert.equal(identity.byToken(there.token), null);
  assert.equal(identity.byToken(guest.token)?.id, guest.profile.id);
  assert.throws(() => identity.login("sara", "first pass"), /wrong/);
  assert.equal(identity.login("sara", "second pass").profile.id, here.profile.id);
});

test("rename, password and username check over HTTP; open tabs hear profile:update", async () => {
  const { httpServer, io } = createApp({ store: new MemoryStore() });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const base = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  const call = (path: string, method: string, token?: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const { io: connect } = await import("socket.io-client");
  try {
    const { profile, token } = await (await call("/api/signup", "POST", undefined, { name: "Hana" })).json();
    const socket = connect(base, { auth: { token }, transports: ["websocket"] });
    await new Promise<void>((resolve) => socket.on("connect", () => resolve()));
    const heard = new Promise<{ name: string; username: string }>((resolve) => socket.on("profile:update", resolve));

    assert.deepEqual(await (await call("/api/usernames/HANA", "GET")).json(), {
      username: "hana",
      available: false,
      reason: "that username is taken",
    });
    assert.equal((await (await call("/api/usernames/hana", "GET", token)).json()).available, true);

    const renamed = await call("/api/me", "PATCH", token, { name: "Hana B", username: "hana_b" });
    assert.equal(renamed.status, 200);
    assert.deepEqual(await renamed.json(), { ...profile, name: "Hana B", username: "hana_b", hasPassword: false });
    assert.deepEqual(await heard, { ...profile, name: "Hana B", username: "hana_b" });
    socket.close();

    assert.equal((await call("/api/me", "PATCH", undefined, { name: "X" })).status, 401);
    assert.equal((await call("/api/me/password", "POST", token, { current: "", next: "password1" })).status, 409);
    assert.equal((await call("/api/me/credentials", "POST", token, { password: "password1" })).status, 200);
    assert.equal((await call("/api/me/password", "POST", token, { current: "nope", next: "password2" })).status, 403);
    const changed = await call("/api/me/password", "POST", token, { current: "password1", next: "password2" });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).hasPassword, true);
    assert.equal((await call("/api/login", "POST", undefined, { username: "hana_b", password: "password2" })).status, 200);
  } finally {
    io.close();
  }
});
