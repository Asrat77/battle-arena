import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "./app";
import { Identity, SESSION_TTL_MS, USERNAME_CHECK_MAX, USERNAME_COOLDOWN_MS } from "./identity";
import { RateLimiter } from "./rateLimit";
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
    assert.deepEqual(await me.json(), { ...profile, hasPassword: false, usernameChangeAt: null });
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
    const renamedBody = await renamed.json();
    assert.ok(renamedBody.usernameChangeAt > Date.now());
    assert.deepEqual(renamedBody, { ...profile, name: "Hana B", username: "hana_b", hasPassword: false, usernameChangeAt: renamedBody.usernameChangeAt });
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

test("a username can be changed once a week; the first change is free", () => {
  let t = 1_000_000;
  const identity = new Identity(new MemoryStore(), () => t);
  const a = identity.signup("Abebe", { username: "abebe", password: "password1" });
  assert.equal(identity.account(a.profile.id).usernameChangeAt, null);

  assert.equal(identity.update(a.token, { username: "abe_one" }).username, "abe_one");
  const until = identity.account(a.profile.id).usernameChangeAt;
  assert.equal(until, t + USERNAME_COOLDOWN_MS);

  // Locked: a different handle is refused with 429 and says how long; a taken one is not probed.
  t += 2 * 86_400_000;
  assert.throws(() => identity.update(a.token, { username: "abe_two" }), (e: any) => e.status === 429 && /5 days/.test(e.message));
  // Name changes, and re-saving the same handle, still work while locked.
  assert.equal(identity.update(a.token, { name: "Abe" }).name, "Abe");
  assert.equal(identity.update(a.token, { username: "ABE_ONE" }).username, "abe_one");
  assert.equal(identity.byUsername("abe_two"), null);

  t = until!;
  assert.equal(identity.account(a.profile.id).usernameChangeAt, null);
  assert.equal(identity.update(a.token, { username: "abe_two" }).username, "abe_two");
  assert.equal(identity.account(a.profile.id).usernameChangeAt, t + USERNAME_COOLDOWN_MS);
});

test("rate limiter lets a window's worth through, then recovers", () => {
  let t = 0;
  const limit = new RateLimiter(3, 1000, () => t);
  assert.deepEqual([1, 2, 3, 4].map(() => limit.take("ip")), [true, true, true, false]);
  assert.equal(limit.take("other"), true);
  t = 1001;
  assert.equal(limit.take("ip"), true);
});

test("username availability checks are limited per IP", async () => {
  const { httpServer, io } = createApp({ store: new MemoryStore() });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const base = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  try {
    for (let i = 0; i < USERNAME_CHECK_MAX; i++) {
      assert.equal((await fetch(`${base}/api/usernames/name_${i}`)).status, 200);
    }
    const over = await fetch(`${base}/api/usernames/one_more`);
    assert.equal(over.status, 429);
    assert.match((await over.json()).error, /too many checks/);
  } finally {
    io.close();
    httpServer.close();
  }
});

// Audit H7: a stolen token must not work forever, and ending a session must reach open sockets.
test("session tokens expire after SESSION_TTL_MS; old bare-id sessions get a fresh 30 days", () => {
  let now = 1_000;
  const store = new MemoryStore();
  const identity = new Identity(store, () => now);
  const a = identity.signup("Abebe");
  now += SESSION_TTL_MS - 1;
  assert.equal(identity.byToken(a.token)?.id, a.profile.id);
  now += 1;
  assert.equal(identity.byToken(a.token), null);
  // A new sign-in prunes the expired session.
  identity.signup("Other");
  assert.equal(Object.keys(store.read<Record<string, unknown>>("sessions", {})).length, 1);

  // Sessions saved before expiry existed (hash -> id) keep working, for one more TTL.
  const legacy = new MemoryStore();
  const old = new Identity(legacy, () => 0).signup("Lily");
  const sessions = legacy.read<Record<string, { id: string }>>("sessions", {});
  legacy.write("sessions", Object.fromEntries(Object.entries(sessions).map(([h, s]) => [h, s.id])));
  now = 5_000_000;
  const reopened = new Identity(legacy, () => now);
  assert.equal(reopened.byToken(old.token)?.id, old.profile.id);
  now += SESSION_TTL_MS;
  assert.equal(reopened.byToken(old.token), null);
});

test("sign-out and password change report the ended sessions", () => {
  const ended: string[][] = [];
  const identity = new Identity(new MemoryStore(), Date.now, { onSessionsEnded: (h) => ended.push(h) });
  const here = identity.signup("Sara", { username: "sara", password: "first pass" });
  const there = identity.login("sara", "first pass");
  const third = identity.login("sara", "first pass");
  identity.logout(third.token);
  assert.equal(ended.length, 1);
  assert.equal(identity.sessionOwner(ended[0][0]), null);
  identity.changePassword(here.token, "first pass", "second pass");
  assert.equal(ended.length, 2);
  assert.equal(ended[1].length, 1);
  assert.equal(identity.byToken(there.token), null);
  identity.logout("not a token");
  assert.equal(ended.length, 2);
});

test("confirmPassword checks the password and locks after repeated misses", () => {
  const identity = new Identity(new MemoryStore());
  const sara = identity.signup("Sara", { username: "sara", password: "first pass" });
  const guest = identity.signup("Guest");
  assert.deepEqual(identity.confirmPassword(sara.profile.id, "first pass"), { ok: true });
  assert.equal(identity.confirmPassword(guest.profile.id, "anything").ok, false);
  for (let i = 0; i < 5; i++) assert.deepEqual(identity.confirmPassword(sara.profile.id, "nope"), { ok: false, reason: "wrong password" });
  assert.deepEqual(identity.confirmPassword(sara.profile.id, "first pass"), { ok: false, reason: "too many attempts, wait a minute and try again" });
});

test("signing out or changing the password drops that session's open sockets", async () => {
  const { httpServer, io } = createApp({ store: new MemoryStore() });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const base = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  const call = (path: string, token: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const { io: connect } = await import("socket.io-client");
  const open = async (token: string) => {
    const s = connect(base, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
    await new Promise<void>((resolve) => s.on("connect", () => resolve()));
    return s;
  };
  try {
    const signup = await fetch(`${base}/api/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hana", username: "hana", password: "password1" }),
    });
    const { token } = await signup.json();
    const login = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "hana", password: "password1" }),
    });
    const other = (await login.json()).token;

    const mine = await open(token);
    const theirs = await open(other);
    const theirsEnded = new Promise<void>((resolve) => theirs.on("session:ended", () => resolve()));
    const theirsGone = new Promise<string>((resolve) => theirs.on("disconnect", (r) => resolve(r)));
    assert.equal((await call("/api/me/password", token, { current: "password1", next: "password2" })).status, 200);
    await theirsEnded;
    assert.equal(await theirsGone, "io server disconnect");
    assert.ok(mine.connected);

    const mineGone = new Promise<string>((resolve) => mine.on("disconnect", (r) => resolve(r)));
    assert.equal((await call("/api/logout", token)).status, 204);
    assert.equal(await mineGone, "io server disconnect");

    // The ended token can't reconnect.
    const retry = connect(base, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
    const err = await new Promise<Error>((resolve) => retry.on("connect_error", resolve));
    assert.equal(err.message, "unauthorized");
    retry.close();
  } finally {
    io.close();
  }
});
