// Socket payloads are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, test } from "node:test";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { firstToThree } from "../../engine/games/firstToThree";
import { listGames } from "../../engine/registry";
import type { AnyGame } from "../../engine/types";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { BOT_OFFER_MS, BOT_PLAYER, REMATCH_WINDOW_MS, ROOM_COUNTDOWN_MS } from "./lobby";
import { DISCONNECT_FORFEIT_MS } from "./matches";
import { MemoryStore } from "./store";

interface Client {
  socket: ClientSocket;
  events: { name: string; data: any }[];
}

const games: AnyGame[] = [...listGames(), firstToThree];
const clock = new FakeClock();
const { httpServer, io, matches, identity } = createApp({
  store: new MemoryStore(),
  clock,
  games: { get: (id) => games.find((g) => g.id === id), list: () => games },
});
const [alice, bob, carol] = ["Alice", "Bob", "Carol"].map((name) => identity.signup(name));
const G = firstToThree.id;
let url = "";
const clients: Client[] = [];

before(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

// Every test starts with nobody connected, queued, or in a live match.
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
const has = (c: Client, name: string) => c.events.some((e) => e.name === name);

/** Plays a first-to-three match to the end, seat to move scoring each turn. */
function finish(matchId: string) {
  const m = matches.get(matchId)!;
  while (!m.cur.outcome) {
    const seat = (m.cur.state as { turn: 0 | 1 }).turn;
    if (m.players[seat] === BOT_PLAYER) clock.advance(10_000);
    else assert.equal(matches.move(m.players[seat], m.id, { type: "point" }), null);
  }
}

async function getJson(path: string) {
  const res = await fetch(url + path);
  return { status: res.status, body: await res.json() };
}

describe("quick match", () => {
  test("two players in the same queue are paired right away", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);

    const t0 = Date.now();
    assert.deepEqual(await send(a, "queue:join", { gameId: G }), { ok: true, state: "waiting" });
    const waiting = await waitFor(a, "queue:status", (d) => d.state === "waiting");
    assert.equal(waiting.botOfferAt, waiting.since + BOT_OFFER_MS);

    const res = await send(b, "queue:join", { gameId: G });
    assert.equal(res.state, "matched");
    const startA = await waitFor(a, "match:start", (d) => d.matchId === res.matchId);
    const startB = await waitFor(b, "match:start", (d) => d.matchId === res.matchId);
    assert.ok(Date.now() - t0 < 3000, "paired in under 3 s");
    assert.deepEqual([startA.seat, startB.seat].sort(), [0, 1]);
    assert.deepEqual([...startA.players].sort(), [alice.profile.id, bob.profile.id].sort());
    assert.equal(startA.bot, false);
    await waitFor(a, "queue:status", (d) => d.state === "matched" && d.matchId === res.matchId);

    // Matched players are out of the queue and cannot queue again mid-match.
    assert.equal((await getJson("/api/games")).body.find((g: any) => g.id === G).queue, 0);
    assert.deepEqual(await send(a, "queue:join", { gameId: G }), { ok: false, reason: "already in a match" });

    // Nobody got a bot offer.
    clock.advance(BOT_OFFER_MS);
    await settle();
    assert.ok(!has(a, "queue:botOffer") && !has(b, "queue:botOffer"));
  });

  test("players in different game queues are not paired", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    await send(a, "queue:join", { gameId: G });
    assert.equal((await send(b, "queue:join", { gameId: "gebeta" })).state, "waiting");
    await settle();
    assert.ok(!has(a, "match:start") && !has(b, "match:start"));
    const list = (await getJson("/api/games")).body;
    assert.equal(list.find((g: any) => g.id === G).queue, 1);
    assert.equal(list.find((g: any) => g.id === "gebeta").queue, 1);
  });

  test("bot offer arrives after exactly 10 s and accepting starts a bot match", async () => {
    const a = await client(alice.token);
    await send(a, "queue:join", { gameId: G });
    assert.deepEqual(await send(a, "queue:acceptBot"), { ok: false, reason: "no bot offer yet" });

    clock.advance(BOT_OFFER_MS - 1);
    await settle();
    assert.ok(!has(a, "queue:botOffer"), "no offer before 10 s");
    clock.advance(1);
    assert.deepEqual(await waitFor(a, "queue:botOffer"), { gameId: G });

    const res = await send(a, "queue:acceptBot");
    assert.equal(res.state, "matched");
    const start = await waitFor(a, "match:start", (d) => d.matchId === res.matchId);
    assert.equal(start.bot, true);
    assert.equal(start.players[start.botSeat], BOT_PLAYER);
    assert.equal(start.players[start.seat], alice.profile.id);
    assert.equal((await getJson("/api/games")).body.find((g: any) => g.id === G).live, 1);
  });

  test("a human can still pair after the bot offer was shown", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    await send(a, "queue:join", { gameId: G });
    clock.advance(BOT_OFFER_MS);
    await waitFor(a, "queue:botOffer");
    assert.equal((await send(b, "queue:join", { gameId: G })).state, "matched");
    assert.deepEqual(await send(a, "queue:acceptBot"), { ok: false, reason: "not in a queue" });
  });

  test("leaving the queue removes you immediately and cancels the bot offer", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    await send(a, "queue:join", { gameId: G });
    assert.equal((await getJson("/api/games")).body.find((g: any) => g.id === G).queue, 1);

    assert.deepEqual(await send(a, "queue:leave"), { ok: true });
    await waitFor(a, "queue:status", (d) => d.state === "idle");
    assert.equal((await getJson("/api/games")).body.find((g: any) => g.id === G).queue, 0);

    // Bob is not paired with the departed Alice, and Alice gets no offer.
    assert.equal((await send(b, "queue:join", { gameId: G })).state, "waiting");
    clock.advance(BOT_OFFER_MS - 1);
    await settle();
    assert.ok(!has(a, "queue:botOffer"));
    assert.ok(!has(a, "match:start") && !has(b, "match:start"));
  });

  test("closing the tab leaves the queue", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    await send(a, "queue:join", { gameId: G });
    a.socket.disconnect();
    await settle();
    assert.equal((await send(b, "queue:join", { gameId: G })).state, "waiting");
  });

  test("unknown games are rejected", async () => {
    const a = await client(alice.token);
    assert.deepEqual(await send(a, "queue:join", { gameId: "chess" }), { ok: false, reason: "unknown game" });
    assert.deepEqual(await send(a, "room:create", { gameId: "chess" }), { ok: false, reason: "unknown game" });
  });
});

describe("GET /api/games", () => {
  test("lists every registered game with queue and live counts", async () => {
    const { status, body } = await getJson("/api/games");
    assert.equal(status, 200);
    assert.deepEqual(
      body.map((g: any) => g.id),
      games.map((g) => g.id),
    );
    for (const g of body) {
      assert.equal(typeof g.name, "string");
      assert.equal(g.queue, 0);
      assert.equal(g.live, 0);
    }
  });
});

describe("private rooms", () => {
  test("join by code, ready up, and the match starts when both are ready", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);

    const created = await send(a, "room:create", { gameId: G });
    assert.equal(created.ok, true);
    const { code, link } = created.room;
    assert.match(code, /^[A-Z2-9]{5}$/);
    assert.equal(link, `/r/${code}`);
    assert.equal(created.room.state, "waiting");

    // The /r/<code> page can look the room up first.
    const looked = await getJson(`/api/rooms/${code.toLowerCase()}`);
    assert.equal(looked.status, 200);
    assert.equal(looked.body.gameId, G);
    assert.equal((await getJson("/api/rooms/ZZZZZ")).status, 404);

    const joined = await send(b, "room:join", { code: ` ${code.toLowerCase()} ` });
    assert.equal(joined.ok, true);
    assert.deepEqual(
      joined.room.members.map((x: any) => [x.name, x.ready]),
      [
        ["Alice", false],
        ["Bob", false],
      ],
    );
    await waitFor(a, "room:update", (d) => d.members.length === 2);

    assert.equal((await send(a, "room:ready")).room.state, "ready-check");
    await settle();
    assert.ok(!has(a, "match:start"), "one ready player does not start the match");

    // Both ready: a 3-2-1 first, then the match.
    const counting = await send(b, "room:ready", { ready: true });
    assert.equal(counting.room.state, "countdown");
    assert.equal(counting.room.countdownMs, ROOM_COUNTDOWN_MS);
    assert.equal(counting.room.matchId, null);
    await waitFor(a, "room:update", (d) => d.state === "countdown");
    clock.advance(ROOM_COUNTDOWN_MS - 1);
    await settle();
    assert.ok(!has(a, "match:start"), "the match waits for the countdown");

    clock.advance(1);
    const started = await waitFor(a, "room:update", (d) => d.state === "playing");
    assert.equal(started.countdownMs, null);
    const matchId = started.matchId;
    await waitFor(a, "match:start", (d) => d.matchId === matchId);
    await waitFor(b, "match:start", (d) => d.matchId === matchId);
    await waitFor(a, "room:update", (d) => d.matchId === matchId);

    // When the match ends the room goes back to waiting for a rematch.
    const m = matches.get(matchId)!;
    while (!m.cur.outcome) {
      const seat = (m.cur.state as { turn: 0 | 1 }).turn;
      assert.equal(matches.move(m.players[seat], m.id, { type: "point" }), null);
    }
    const back = await waitFor(a, "room:update", (d) => d.state === "ready-check" && d.matchId === null);
    assert.ok(back.members.every((x: any) => !x.ready));
  });

  test("un-ready, leaving, or closing the tab stops the countdown", async () => {
    const a = await client(alice.token);
    let b = await client(bob.token);
    const { room } = await send(a, "room:create", { gameId: G });
    await send(b, "room:join", { code: room.code });

    // Un-ready halfway through: back to ready-check, and the old timer never fires.
    await send(a, "room:ready");
    assert.equal((await send(b, "room:ready")).room.state, "countdown");
    clock.advance(ROOM_COUNTDOWN_MS / 2);
    const stopped = await send(b, "room:ready", { ready: false });
    assert.equal(stopped.room.state, "ready-check");
    assert.equal(stopped.room.countdownMs, null);
    clock.advance(ROOM_COUNTDOWN_MS);
    await settle();
    assert.ok(!has(a, "match:start"));

    // Readying again restarts the full 3 s, and the refresh payload reports what's left.
    await send(b, "room:ready");
    clock.advance(1000);
    const c = await client(alice.token);
    const refreshed = await waitFor(c, "room:update", (d) => d.code === room.code);
    assert.equal(refreshed.state, "countdown");
    assert.equal(refreshed.countdownMs, ROOM_COUNTDOWN_MS - 1000);

    // Bob closes the tab: he is no longer ready, so it stops.
    b.socket.disconnect();
    await waitFor(a, "room:update", (d) => d.state === "ready-check");
    b = await client(bob.token);
    await send(b, "room:ready");

    // Leaving mid-countdown stops it too.
    await waitFor(a, "room:update", (d) => d.state === "countdown");
    await send(b, "room:leave");
    const left = await waitFor(a, "room:update", (d) => d.members.length === 1);
    assert.equal(left.state, "waiting");
    clock.advance(ROOM_COUNTDOWN_MS);
    await settle();
    assert.ok(!has(a, "match:start"));
    assert.equal(matches.live().length, 0);
  });

  test("a third player cannot join and bad codes are rejected", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    const c = await client(carol.token);
    const { room } = await send(a, "room:create", { gameId: G });
    await send(b, "room:join", { code: room.code });
    assert.deepEqual(await send(c, "room:join", { code: room.code }), { ok: false, reason: "room is full" });
    assert.deepEqual(await send(c, "room:join", { code: "ZZZZZ" }), { ok: false, reason: "no room with that code" });
    assert.deepEqual(await send(c, "room:ready"), { ok: false, reason: "not in a room" });
  });

  test("unready, leave, and refresh keep the room consistent", async () => {
    const a = await client(alice.token);
    let b = await client(bob.token);
    const { room } = await send(a, "room:create", { gameId: G });
    await send(b, "room:join", { code: room.code });
    await send(a, "room:ready");
    assert.equal((await send(a, "room:ready", { ready: false })).room.members[0].ready, false);

    // Bob refreshes: he keeps his seat and gets the room state back, unready.
    await send(b, "room:ready");
    b.socket.disconnect();
    await settle();
    b = await client(bob.token);
    const restored = await waitFor(b, "room:update", (d) => d.code === room.code);
    assert.deepEqual(
      restored.members.map((x: any) => x.ready),
      [false, false],
    );

    // Alice (host) leaves: Bob becomes host, and the room is gone once he leaves too.
    await send(a, "room:leave");
    const solo = await waitFor(b, "room:update", (d) => d.members.length === 1);
    assert.equal(solo.host, bob.profile.id);
    await send(b, "room:leave");
    assert.equal((await getJson(`/api/rooms/${room.code}`)).status, 404);
  });

  test("joining quick match takes you out of your room", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    const { room } = await send(a, "room:create", { gameId: G });
    await send(b, "room:join", { code: room.code });
    await send(a, "queue:join", { gameId: G });
    const left = await waitFor(b, "room:update", (d) => d.members.length === 1);
    assert.equal(left.members[0].profileId, bob.profile.id);
  });
});

describe("rematch", () => {
  async function paired() {
    const a = await client(alice.token);
    const b = await client(bob.token);
    await send(a, "queue:join", { gameId: G });
    const { matchId } = await send(b, "queue:join", { gameId: G });
    return { a, b, matchId, players: [...matches.get(matchId)!.players] };
  }

  test("both players asking starts a new match with the seats swapped", async () => {
    const { a, b, matchId, players } = await paired();
    assert.deepEqual(await send(a, "rematch:request", { matchId }), { ok: false, reason: "match is still live" });
    finish(matchId);

    const status = await send(b, "rematch:status", { matchId });
    assert.deepEqual(status, { ok: true, available: true, matchId, state: "open", bot: false, wants: [], next: null });
    assert.deepEqual(await send(a, "rematch:request", { matchId }), { ok: true, state: "offered" });
    const offer = await waitFor(b, "rematch:update", (d) => d.state === "offered");
    assert.deepEqual(offer.wants, [alice.profile.id]);
    await settle();
    assert.equal(matches.live().length, 0, "one ask does not start a match");

    const res = await send(b, "rematch:request", { matchId });
    assert.equal(res.state, "matched");
    const next = matches.get(res.matchId)!;
    assert.deepEqual(next.players, [players[1], players[0]]);
    await waitFor(a, "rematch:update", (d) => d.state === "matched" && d.next === res.matchId);
    await waitFor(a, "match:start", (d) => d.matchId === res.matchId);

    // Asking again on the old card just points at the new match.
    assert.deepEqual(await send(a, "rematch:request", { matchId }), { ok: true, state: "matched", matchId: res.matchId });
    finish(res.matchId);
  });

  test("taking back an offer reopens it; turning one down closes it", async () => {
    const { a, b, matchId } = await paired();
    finish(matchId);
    await send(a, "rematch:request", { matchId });
    assert.deepEqual(await send(a, "rematch:cancel", { matchId }), { ok: true, state: "open" });
    await send(a, "rematch:request", { matchId });
    assert.deepEqual(await send(b, "rematch:cancel", { matchId }), { ok: true, state: "declined" });
    await waitFor(a, "rematch:update", (d) => d.state === "declined");
    assert.deepEqual(await send(a, "rematch:request", { matchId }), { ok: false, reason: "rematch declined" });
  });

  test("play again against the bot starts at once", async () => {
    const a = await client(alice.token);
    await send(a, "queue:join", { gameId: G });
    clock.advance(BOT_OFFER_MS);
    await waitFor(a, "queue:botOffer");
    const { matchId } = await send(a, "queue:acceptBot");
    const first = matches.get(matchId)!;
    finish(matchId);

    assert.equal((await send(a, "rematch:status", { matchId })).bot, true);
    const res = await send(a, "rematch:request", { matchId });
    assert.equal(res.state, "matched");
    const next = matches.get(res.matchId)!;
    assert.equal(next.botSeat, first.botSeat === 0 ? 1 : 0);
    assert.equal(next.players[next.botSeat!], BOT_PLAYER);
    await waitFor(a, "match:start", (d) => d.matchId === res.matchId && d.bot === true);
    finish(res.matchId);
  });

  test("spectators and late cards get no rematch", async () => {
    const { matchId } = await paired();
    const c = await client(carol.token);
    finish(matchId);
    assert.deepEqual(await send(c, "rematch:status", { matchId }), { ok: true, available: false });
    assert.deepEqual(await send(c, "rematch:request", { matchId }), { ok: false, reason: "no rematch for this match" });

    const a = clients[0];
    await send(a, "rematch:request", { matchId });
    clock.advance(REMATCH_WINDOW_MS);
    await waitFor(a, "rematch:update", (d) => d.state === "closed");
    assert.deepEqual(await send(a, "rematch:status", { matchId }), { ok: true, available: false });
  });

  test("a room rematch keeps the room in step", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    const { room } = await send(a, "room:create", { gameId: G });
    await send(b, "room:join", { code: room.code });
    await send(a, "room:ready");
    await send(b, "room:ready");
    clock.advance(ROOM_COUNTDOWN_MS);
    const { matchId } = await waitFor(a, "room:update", (d) => d.state === "playing");
    finish(matchId);
    await waitFor(a, "room:update", (d) => d.state === "ready-check");

    await send(a, "rematch:request", { matchId });
    const res = await send(b, "rematch:request", { matchId });
    const back = await waitFor(a, "room:update", (d) => d.matchId === res.matchId);
    assert.equal(back.state, "playing");
    finish(res.matchId);
    await waitFor(a, "room:update", (d) => d.state === "ready-check" && d.matchId === null);
  });
});
