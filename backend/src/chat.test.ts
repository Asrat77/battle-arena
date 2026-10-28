// Socket payloads are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, test } from "node:test";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { crackTheCode } from "../../engine/games/crackTheCode";
import { firstToThree } from "../../engine/games/firstToThree";
import { listGames } from "../../engine/registry";
import type { AnyGame } from "../../engine/types";
import { createApp } from "./app";
import { MAX_CHAT_CHARS, RATE_LIMIT, REACTIONS } from "./chat";
import { FakeClock } from "./clock";
import { ROOM_COUNTDOWN_MS } from "./lobby";
import { DISCONNECT_FORFEIT_MS, type Match } from "./matches";
import { MemoryStore } from "./store";

interface Client {
  socket: ClientSocket;
  events: { name: string; data: any }[];
}

const games: AnyGame[] = [...listGames(), firstToThree];
const clock = new FakeClock();
const { httpServer, io, matches, identity, rewards } = createApp({
  store: new MemoryStore(),
  clock,
  games: { get: (id) => games.find((g) => g.id === id), list: () => games },
});
const [alice, bob, carol, dave] = ["Alice", "Bob", "Carol", "Dave"].map((name) => {
  const { profile, token } = identity.signup(name);
  return { id: profile.id, token };
});
let url = "";
const clients: Client[] = [];
const spectated: { matchId: string; ids: string[] }[] = [];
matches.on("spectated", (m: Match, ids: string[]) => spectated.push({ matchId: m.id, ids }));

before(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

// Every test starts with nobody connected or in a live match, and with the
// chat rate-limit window long past.
afterEach(async () => {
  const live = clients.splice(0).filter((c) => c.socket.connected);
  live.forEach((c) => c.socket.disconnect());
  if (live.length) await new Promise((r) => setTimeout(r, 50));
  clock.advance(DISCONNECT_FORFEIT_MS);
  assert.equal(matches.live().length, 0);
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
const chats = (c: Client) => c.events.filter((e) => e.name === "chat:message").map((e) => e.data);

describe("spectating", () => {
  test("a spectator never sees a secret before the end, and gets the reveal after", async () => {
    const [a, b, c] = await Promise.all([alice, bob, carol].map((p) => client(p.token)));
    const m = matches.create({ game: crackTheCode, players: [alice.id, bob.id] });
    assert.deepEqual(await send(c, "match:watch", { matchId: m.id }), { ok: true });
    const start = await waitFor(c, "match:start", (d) => d.matchId === m.id);
    assert.equal(start.seat, "spectator");

    assert.deepEqual(await send(a, "match:move", { matchId: m.id, move: { type: "secret", code: "1234" } }), { ok: true });
    assert.deepEqual(await send(b, "match:move", { matchId: m.id, move: { type: "secret", code: "5678" } }), { ok: true });
    await send(a, "match:move", { matchId: m.id, move: { type: "guess", code: "5679" } });
    await send(b, "match:move", { matchId: m.id, move: { type: "guess", code: "1243" } });
    await settle();

    const seen = JSON.stringify(c.events);
    assert.ok(c.events.some((e) => e.name === "match:view" && e.data.seq >= 4), "spectator follows the match");
    assert.ok(!seen.includes('"1234"') && !seen.includes('"5678"'), "spectator saw a secret");

    await send(a, "match:leave", { matchId: m.id });
    const end = await waitFor(c, "match:end", (d) => d.matchId === m.id);
    assert.deepEqual(end.reveal.secrets, ["1234", "5678"]);
  });

  test("players see the spectator count; leaving and disconnecting lower it", async () => {
    const [a, b, c, d] = await Promise.all([alice, bob, carol, dave].map((p) => client(p.token)));
    const m = matches.create({ game: firstToThree, players: [alice.id, bob.id] });
    await send(c, "match:watch", { matchId: m.id });
    await waitFor(a, "match:spectators", (x) => x.matchId === m.id && x.count === 1);
    await send(d, "match:watch", { matchId: m.id });
    await waitFor(b, "match:spectators", (x) => x.count === 2);
    // A second tab of the same spectator is still one spectator.
    const c2 = await client(carol.token);
    await send(c2, "match:watch", { matchId: m.id });
    await settle();
    assert.equal(matches.spectators(m).length, 2);

    assert.deepEqual(await send(d, "match:leave", { matchId: m.id }), { ok: true });
    await waitFor(a, "match:spectators", (x) => x.count === 1);
    assert.equal(matches.live().length, 1, "a spectator leaving does not forfeit anything");

    c.socket.disconnect();
    c2.socket.disconnect();
    await waitFor(a, "match:spectators", (x) => x.count === 0);
  });

  test("the lobby lists live matches with a watch link and spectator count", async () => {
    const [, , c] = await Promise.all([alice, bob, carol].map((p) => client(p.token)));
    const m = matches.create({ game: firstToThree, players: [alice.id, bob.id] });
    await send(c, "match:watch", { matchId: m.id });
    await settle();

    const all = await (await fetch(`${url}/api/live`)).json();
    const row = all.find((r: any) => r.matchId === m.id);
    assert.deepEqual(row.players, [
      { profileId: alice.id, name: "Alice" },
      { profileId: bob.id, name: "Bob" },
    ]);
    assert.equal(row.spectators, 1);
    assert.equal(row.link, `/watch/${m.id}`);
    assert.equal(row.room, null);
    const other = await (await fetch(`${url}/api/live?game=${crackTheCode.id}`)).json();
    assert.ok(!other.some((r: any) => r.matchId === m.id));
  });

  test("spectators still watching at the end are reported for the Watcher badge", async () => {
    const [a, , c, d] = await Promise.all([alice, bob, carol, dave].map((p) => client(p.token)));
    const m = matches.create({ game: firstToThree, players: [alice.id, bob.id] });
    await send(c, "match:watch", { matchId: m.id });
    await send(d, "match:watch", { matchId: m.id });
    await send(d, "match:leave", { matchId: m.id });
    await send(a, "match:leave", { matchId: m.id });
    await waitFor(c, "match:end");
    assert.deepEqual(
      spectated.filter((s) => s.matchId === m.id),
      [{ matchId: m.id, ids: [carol.id] }],
    );
  });

  test("watching three matches to the end earns the Watcher badge", async () => {
    const [a, , c] = await Promise.all([alice, bob, dave].map((p) => client(p.token)));
    for (let i = 0; i < 3; i++) {
      assert.ok(!rewards.player(dave.id).badges.some((b) => b.id === "watcher"));
      const m = matches.create({ game: firstToThree, players: [alice.id, bob.id] });
      await send(c, "match:watch", { matchId: m.id });
      await send(a, "match:leave", { matchId: m.id });
      await waitFor(c, "match:end", (d) => d.matchId === m.id);
    }
    assert.ok(rewards.player(dave.id).badges.some((b) => b.id === "watcher"));
  });
});

describe("chat", () => {
  test("a quick match chat reaches both players and spectators; outsiders are refused", async () => {
    const [a, b, c, d] = await Promise.all([alice, bob, carol, dave].map((p) => client(p.token)));
    const m = matches.create({ game: firstToThree, players: [alice.id, bob.id] });
    await send(c, "match:watch", { matchId: m.id });

    const sent = await send(a, "chat:send", { roomId: m.id, text: "  good luck  " });
    assert.equal(sent.ok, true);
    const fromSpectator = await send(c, "chat:send", { roomId: m.id, text: "go Bob" });
    assert.equal(fromSpectator.message.spectator, true);
    await settle();

    for (const x of [a, b, c]) {
      assert.deepEqual(
        chats(x).map((msg) => [msg.from.name, msg.text, msg.spectator]),
        [
          ["Alice", "good luck", false],
          ["Carol", "go Bob", true],
        ],
      );
    }
    assert.deepEqual(await send(d, "chat:send", { roomId: m.id, text: "hi" }), {
      ok: false,
      reason: "you are not in this match",
    });
    assert.equal(chats(d).length, 0);

    const history = await send(b, "chat:history", { roomId: m.id });
    assert.equal(history.messages.length, 2);
    assert.deepEqual(history.reactions, [...REACTIONS]);
  });

  test("a room has one chat: members by code, its match's spectators by match ID", async () => {
    const [a, b, c] = await Promise.all([alice, bob, carol].map((p) => client(p.token)));
    const { room } = await send(a, "room:create", { gameId: firstToThree.id });
    await send(b, "room:join", { code: room.code });
    assert.equal((await send(a, "chat:send", { roomId: room.code, text: "ready?" })).ok, true);
    assert.deepEqual(await send(c, "chat:send", { roomId: room.code, text: "let me in" }), {
      ok: false,
      reason: "you are not in this room",
    });

    await send(a, "room:ready");
    await send(b, "room:ready");
    clock.advance(ROOM_COUNTDOWN_MS);
    const { matchId } = await waitFor(a, "room:update", (u) => u.state === "playing");
    await send(c, "match:watch", { matchId });
    const res = await send(c, "chat:send", { roomId: matchId, text: "watching!" });
    assert.equal(res.message.roomId, room.code);
    await settle();

    assert.deepEqual(chats(b).map((x) => x.text), ["ready?", "watching!"]);
    assert.deepEqual(chats(c).map((x) => x.text), ["watching!"]);
    assert.equal((await send(c, "chat:history", { roomId: matchId })).messages.length, 2);

    await send(a, "room:leave");
    await send(b, "room:leave");
  });

  test(`messages are capped at ${MAX_CHAT_CHARS} characters and must not be empty`, async () => {
    const [a] = await Promise.all([alice, bob].map((p) => client(p.token)));
    const m = matches.create({ game: firstToThree, players: [alice.id, bob.id] });
    assert.equal((await send(a, "chat:send", { roomId: m.id, text: "é".repeat(MAX_CHAT_CHARS) })).ok, true);
    assert.deepEqual(await send(a, "chat:send", { roomId: m.id, text: "x".repeat(MAX_CHAT_CHARS + 1) }), {
      ok: false,
      reason: `message is over ${MAX_CHAT_CHARS} characters`,
    });
    assert.deepEqual(await send(a, "chat:send", { roomId: m.id, text: "   " }), { ok: false, reason: "message is empty" });
    assert.deepEqual(await send(a, "chat:send", { roomId: m.id, text: 42 }), { ok: false, reason: "message is empty" });
    await settle();
    assert.equal(chats(a).length, 1);
  });

  test(`at most ${RATE_LIMIT.messages} messages per ${RATE_LIMIT.windowMs / 1000} s, reactions included`, async () => {
    const [a] = await Promise.all([alice, bob].map((p) => client(p.token)));
    const m = matches.create({ game: firstToThree, players: [alice.id, bob.id] });
    for (let i = 0; i < RATE_LIMIT.messages - 1; i++) {
      assert.equal((await send(a, "chat:send", { roomId: m.id, text: `msg ${i}` })).ok, true);
    }
    assert.equal((await send(a, "chat:react", { roomId: m.id, emoji: "🔥" })).ok, true);
    const blocked = await send(a, "chat:send", { roomId: m.id, text: "one too many" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "slow down");
    assert.equal(blocked.retryAt, clock.now() + RATE_LIMIT.windowMs);
    assert.equal((await send(a, "chat:react", { roomId: m.id, emoji: "👍" })).ok, false);

    clock.advance(RATE_LIMIT.windowMs);
    assert.equal((await send(a, "chat:send", { roomId: m.id, text: "back" })).ok, true);
  });

  test("quick reactions go out as reaction messages; unknown ones are refused", async () => {
    const [a, b] = await Promise.all([alice, bob].map((p) => client(p.token)));
    const m = matches.create({ game: firstToThree, players: [alice.id, bob.id] });
    assert.equal((await send(a, "chat:react", { roomId: m.id, emoji: "GG" })).ok, true);
    assert.deepEqual(await send(a, "chat:react", { roomId: m.id, emoji: "💩" }), { ok: false, reason: "unknown reaction" });
    const msg = await waitFor(b, "chat:message");
    assert.equal(msg.kind, "reaction");
    assert.equal(msg.text, "GG");
  });
});
