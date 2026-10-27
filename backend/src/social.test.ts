// Socket payloads are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, test } from "node:test";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { firstToThree } from "../../engine/games/firstToThree";
import type { AnyGame } from "../../engine/types";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { BOT_OFFER_MS } from "./lobby";
import { DISCONNECT_FORFEIT_MS } from "./matches";
import { MemoryStore } from "./store";

interface Client {
  socket: ClientSocket;
  events: { name: string; data: any }[];
}

const games: AnyGame[] = [firstToThree];
const clock = new FakeClock();
const { httpServer, io, matches, identity, social } = createApp({
  store: new MemoryStore(),
  ledger: { blockTimeMs: 1 },
  clock,
  games: { get: (id) => games.find((g) => g.id === id), list: () => games },
});
const [alice, bob, carol] = ["Alice", "Bob", "Carol"].map((name) => identity.signup(name));
const [A, B, C] = [alice, bob, carol].map((x) => x.profile.id);
const G = firstToThree.id;
let url = "";
const clients: Client[] = [];

before(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

// Every test starts with nobody connected, no live match, and no friends.
afterEach(async () => {
  const live = clients.splice(0).filter((c) => c.socket.connected);
  live.forEach((c) => c.socket.disconnect());
  if (live.length) await new Promise((r) => setTimeout(r, 50));
  clock.advance(DISCONNECT_FORFEIT_MS);
  assert.equal(matches.live().length, 0);
  for (const a of [A, B, C]) for (const b of [A, B, C]) social.remove(a, b);
});

after(() => {
  io.close();
});

async function client(token: string): Promise<Client> {
  const socket = connect(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
  const c: Client = { socket, events: [] };
  socket.onAny((name, data) => c.events.push({ name, data }));
  clients.push(c);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return c;
}

function waitFor(c: Client, name: string, pred: (d: any) => boolean = () => true, ms = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = c.events.find((e) => e.name === name && pred(e.data));
      if (hit) return resolve(hit.data);
      if (Date.now() - started > ms) return reject(new Error(`timed out waiting for ${name}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

function send(c: Client, event: string, msg?: unknown): Promise<any> {
  return new Promise((resolve) => (msg === undefined ? c.socket.emit(event, resolve) : c.socket.emit(event, msg, resolve)));
}

const settle = () => new Promise((r) => setTimeout(r, 50));
const notes = (c: Client, kind: string) => c.events.filter((e) => e.name === "notify" && e.data.kind === kind);

describe("friends", () => {
  test("add by profile ID is one-way and validated", async () => {
    const a = await client(alice.token);
    assert.deepEqual(await send(a, "friend:add", { profileId: "0xnobody" }), { ok: false, reason: "no profile with that ID" });
    assert.deepEqual(await send(a, "friend:add", { profileId: A }), { ok: false, reason: "cannot add yourself" });

    // IDs are matched case-insensitively, like the addresses they are.
    const res = await send(a, "friend:add", { profileId: B.toUpperCase().replace("0X", "0x") });
    assert.equal(res.ok, true);
    assert.deepEqual(res.friend, { profileId: B, name: "Bob", status: "offline", matchId: null });
    const pushed = await waitFor(a, "friends", (d) => d.friends.length === 1);
    assert.equal(pushed.friends[0].profileId, B);

    // Adding twice keeps one entry; Bob does not get Alice back.
    await send(a, "friend:add", { profileId: B });
    assert.equal(social.friends(A).length, 1);
    assert.deepEqual(social.friends(B), []);

    const rest = await fetch(`${url}/api/friends`, { headers: { authorization: `Bearer ${alice.token}` } });
    assert.deepEqual((await rest.json()).friends.map((f: any) => f.profileId), [B]);
    assert.equal((await fetch(`${url}/api/friends`)).status, 401);

    await send(a, "friend:remove", { profileId: B });
    assert.deepEqual((await send(a, "friend:list")).friends, []);
  });
});

describe("presence", () => {
  test("friends see online, in-match and offline, plus a friend-online toast", async () => {
    social.add(A, B);
    const a = await client(alice.token);
    assert.deepEqual((await waitFor(a, "friends")).friends[0].status, "offline");

    const b = await client(bob.token);
    const online = await waitFor(a, "presence", (d) => d.profileId === B && d.status === "online");
    assert.equal(online.name, "Bob");
    const toast = await waitFor(a, "notify", (d) => d.kind === "friendOnline");
    assert.deepEqual(toast, { kind: "friendOnline", profileId: B, name: "Bob" });

    // A second tab for Bob is not a new "online".
    const b2 = await client(bob.token);
    await settle();
    assert.equal(notes(a, "friendOnline").length, 1);

    // Bob plays a bot: Alice sees him in that match, then back online.
    await send(b, "queue:join", { gameId: G });
    clock.advance(BOT_OFFER_MS);
    const { matchId } = await send(b, "queue:acceptBot");
    const inMatch = await waitFor(a, "presence", (d) => d.status === "in-match");
    assert.equal(inMatch.matchId, matchId);
    const viaRest = await (await fetch(`${url}/api/profiles/${B}/presence`)).json();
    assert.equal(viaRest.status, "in-match");

    await send(b, "match:leave", { matchId });
    const lastPresence = () => a.events.filter((e) => e.name === "presence").at(-1)!.data;
    await waitFor(a, "presence", (d) => d === lastPresence() && d.status === "online");

    // Offline only once his last socket closes.
    b.socket.disconnect();
    await settle();
    assert.equal(lastPresence().status, "online");
    b2.socket.disconnect();
    await waitFor(a, "presence", (d) => d.status === "offline");

    // Carol does not follow Bob and heard nothing.
    const c = await client(carol.token);
    await settle();
    assert.ok(!c.events.some((e) => e.name === "presence"));
  });
});

describe("invites", () => {
  test("inviting a friend to a room sends a toast they can join from", async () => {
    social.add(A, B);
    const a = await client(alice.token);
    const b = await client(bob.token);
    const { room } = await send(a, "room:create", { gameId: G });

    assert.deepEqual(await send(a, "friend:invite", { profileId: C, code: room.code }), {
      ok: false,
      reason: "not on your friend list",
    });
    assert.deepEqual(await send(a, "friend:invite", { profileId: B, code: "ZZZZZ" }), {
      ok: false,
      reason: "you are not in that room",
    });
    assert.deepEqual(await send(a, "friend:invite", { profileId: B, code: room.code }), { ok: true });

    const invite = await waitFor(b, "notify", (d) => d.kind === "invite");
    assert.deepEqual(invite, {
      kind: "invite",
      from: { profileId: A, name: "Alice" },
      code: room.code,
      link: `/r/${room.code}`,
      gameId: G,
      gameName: firstToThree.name,
    });

    // "Join" on the toast is a room:join with that code.
    const joined = await send(b, "room:join", { code: invite.code });
    assert.equal(joined.room.members.length, 2);
    assert.deepEqual(await send(a, "friend:invite", { profileId: B, code: room.code }), {
      ok: false,
      reason: "already in the room",
    });
  });

  test("cannot invite a friend who is offline", async () => {
    social.add(A, C);
    const a = await client(alice.token);
    const { room } = await send(a, "room:create", { gameId: G });
    assert.deepEqual(await send(a, "friend:invite", { profileId: C, code: room.code }), {
      ok: false,
      reason: "friend is offline",
    });
  });
});

describe("toasts", () => {
  test("match found and match recorded", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    await send(a, "queue:join", { gameId: G });
    const { matchId } = await send(b, "queue:join", { gameId: G });

    const found = await waitFor(a, "notify", (d) => d.kind === "matchFound");
    assert.deepEqual(found, {
      kind: "matchFound",
      matchId,
      gameId: G,
      gameName: firstToThree.name,
      bot: false,
      opponent: { profileId: B, name: "Bob" },
    });
    assert.equal((await waitFor(b, "notify", (d) => d.kind === "matchFound")).opponent.profileId, A);

    await send(a, "match:leave", { matchId });
    for (const c of [a, b]) {
      const rec = await waitFor(c, "notify", (d) => d.kind === "matchRecorded");
      assert.equal(rec.matchId, matchId);
      assert.equal(typeof rec.ledgerIndex, "number");
    }
  });
});
