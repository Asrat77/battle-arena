// Socket and HTTP payloads are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, test } from "node:test";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { firstToThree } from "../../engine/games/firstToThree";
import { listGames } from "../../engine/registry";
import { createRng } from "../../engine/rng";
import type { AnyGame, GameDef } from "../../engine/types";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { BOT_DELAY_MS, DISCONNECT_FORFEIT_MS } from "./matches";
import { MemoryStore } from "./store";
import { MAX_REMATCHES, ROUND_BREAK_MS } from "./tournaments";

interface Client {
  socket: ClientSocket;
  events: { name: string; data: any }[];
}

// Every match is a draw after one move each, to exercise rematches.
const alwaysDraw: GameDef<{ moves: number }, { type: "go" }, { moves: number }> = {
  id: "always-draw",
  name: "Always Draw",
  setup: () => ({ moves: 0 }),
  validate: () => null,
  apply: (s) => ({ moves: s.moves + 1 }),
  onTimeout: (s) => ({ moves: s.moves + 1 }),
  deadlineMs: () => 10_000,
  activeSeats: (s) => [s.moves % 2 === 0 ? 0 : 1],
  outcome: (s) => (s.moves >= 2 ? { winner: null, draw: true, reason: "always" } : null),
  view: (s) => s,
  bot: () => ({ type: "go" }),
};

const games: AnyGame[] = [...listGames(), firstToThree, alwaysDraw];
const clock = new FakeClock();
const { httpServer, io, matches, identity, rewards, tournaments } = createApp({
  store: new MemoryStore(),
  ledger: { blockTimeMs: 1 },
  clock,
  games: { get: (id) => games.find((g) => g.id === id), list: () => games },
});
const people = ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Gina", "Hank"].map((name) => {
  const { profile, token } = identity.signup(name);
  return { id: profile.id, token };
});
const ids = new Set(people.map((p) => p.id));
let url = "";
const clients: Client[] = [];

before(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

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

function send(c: Client, event: string, msg?: unknown): Promise<any> {
  return new Promise((resolve) => c.socket.emit(event, msg, resolve));
}

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const json = async (path: string) => (await fetch(url + path)).json() as Promise<any>;

/**
 * Run a tournament to the end: profiles in its matches play the game's bot
 * move on their turn (simulated players), the server's bots play themselves.
 */
function playOut(id: string) {
  for (let i = 0; i < 500; i++) {
    const t = tournaments.get(id)!;
    if (t.state === "finished") return t;
    let moved = false;
    for (const m of matches.live()) {
      for (const seat of m.active) {
        const player = m.players[seat];
        if (!ids.has(player)) continue;
        const move = m.game.bot(m.game.view(m.cur.state, seat), seat, createRng(`${m.id}:${m.log.length}:${seat}`));
        assert.equal(matches.move(player, m.id, move), null);
        moved = true;
      }
    }
    if (!moved) clock.advance(Math.max(BOT_DELAY_MS[1], ROUND_BREAK_MS));
  }
  throw new Error("tournament did not finish");
}

describe("tournament", () => {
  test("a simulated 4-bot tournament runs every round and crowns a champion", async () => {
    const res = tournaments.create(null, firstToThree.id, true);
    assert.ok(res.ok);
    const id = res.tournament.id;
    assert.equal(res.tournament.state, "running");
    assert.equal(matches.live().length, 2, "both semifinals start at once");

    const t = playOut(id);
    assert.equal(t.state, "finished");
    const [semis, final] = t.rounds;
    assert.equal(semis.matches.length, 2);
    assert.equal(final.matches.length, 1);
    for (const bm of [...semis.matches, ...final.matches]) {
      assert.equal(bm.state, "done");
      assert.equal(bm.decidedBy, "match");
      const m = matches.get(bm.matchId!)!;
      assert.ok(m.cur.outcome, "each bracket match is a real, finished match");
      assert.deepEqual(m.bots, [0, 1]);
    }
    // The final is between the two semifinal winners, and its winner is champion.
    assert.deepEqual(final.matches[0].players.map((p: any) => p.seed).sort(), semis.matches.map((bm: any) => bm.winner.seed).sort());
    assert.deepEqual(t.champion, final.matches[0].winner);

    // The bracket stays viewable after the end.
    await settle();
    const viewed = await json(`/api/tournaments/${id}`);
    assert.equal(viewed.state, "finished");
    assert.equal(viewed.champion.seed, t.champion!.seed);
    assert.ok((await json("/api/tournaments")).some((x: any) => x.id === id));
  });

  test("four simulated players: the champion gets 30 points and the Champion badge", async () => {
    const [a, b, c, d] = people.slice(0, 4);
    const res = tournaments.create(a.id, firstToThree.id);
    assert.ok(res.ok);
    const id = res.tournament.id;
    for (const p of [b, c, d]) assert.ok(tournaments.join(p.id, id).ok);

    const t = playOut(id);
    const champ = t.champion!;
    assert.equal(champ.bot, false);
    assert.ok(ids.has(champ.id));

    await settle(100); // ledger blocks seal
    const r = rewards.player(champ.id);
    assert.ok(r.badges.some((x) => x.id === "champion" && x.source === id));
    const bonus = r.history.find((h) => h.source === id);
    assert.equal(bonus?.points, 30);
    for (const p of [a, b, c, d].filter((p) => p.id !== champ.id)) {
      assert.ok(!rewards.player(p.id).badges.some((x) => x.id === "champion"));
    }
  });

  test("a drawn bracket match is replayed, then settled by a coin flip", () => {
    const res = tournaments.create(null, alwaysDraw.id, true);
    assert.ok(res.ok);
    const t = playOut(res.tournament.id);
    for (const bm of [...t.rounds[0].matches, ...t.rounds[1].matches]) {
      assert.equal(bm.matchIds.length, MAX_REMATCHES + 1);
      assert.equal(bm.decidedBy, "coin flip");
      assert.ok(bm.winner);
    }
    assert.ok(t.champion);
  });

  test("players join over sockets, it starts when full, and the bracket updates live", async () => {
    const [e, f, g, h] = people.slice(4);
    const [ce, cf, cg, ch] = await Promise.all([e, f, g, h].map((p) => client(p.token)));

    const created = await send(ce, "tournament:create", { gameId: firstToThree.id });
    assert.ok(created.ok);
    const id = created.tournament.id;
    assert.equal(created.tournament.state, "open");
    assert.equal((await send(ce, "tournament:create", { gameId: firstToThree.id })).reason, "already in a tournament");
    assert.equal((await send(cf, "tournament:addBots", { id })).reason, "only the host can add bots");

    for (const c of [cf, cg]) assert.ok((await send(c, "tournament:join", { id })).ok);
    await settle();
    assert.equal(ce.events.filter((x) => x.name === "tournament:update").at(-1)!.data.entrants.length, 3);

    assert.ok((await send(ch, "tournament:join", { id })).ok);
    await settle();
    for (const c of [ce, cf, cg, ch]) {
      const update = c.events.filter((x) => x.name === "tournament:update").at(-1)!.data;
      assert.equal(update.state, "running");
      assert.equal(update.rounds[0].matches.filter((m: any) => m.state === "playing").length, 2);
      assert.ok(c.events.some((x) => x.name === "match:start"), "every entrant is seated in a semifinal");
    }
    assert.equal((await send(cf, "tournament:leave", { id })).reason, "tournament already started");

    // A spectator follows the bracket too.
    const watcher = await client(people[0].token);
    const watched = await send(watcher, "tournament:watch", { id });
    assert.equal(watched.tournament.id, id);

    playOut(id);
    await settle();
    const last = watcher.events.filter((x) => x.name === "tournament:update").at(-1)!.data;
    assert.equal(last.state, "finished");
    assert.ok(last.champion);
  });

  test("the host can fill the empty seats with bots", async () => {
    const host = await client(people[0].token);
    const created = await send(host, "tournament:create", { gameId: firstToThree.id });
    const id = created.tournament.id;
    assert.ok((await send(host, "tournament:addBots", { id })).ok);
    const t = tournaments.get(id)!;
    assert.equal(t.state, "running");
    assert.deepEqual(t.entrants.map((x) => x.bot).sort(), [false, true, true, true]);
    playOut(id);
  });

  test("unknown game and unknown tournament are rejected", async () => {
    const c = await client(people[1].token);
    assert.equal((await send(c, "tournament:create", { gameId: "nope" })).reason, "unknown game");
    assert.equal((await send(c, "tournament:join", { id: "nope" })).reason, "no such tournament");
    assert.equal((await fetch(`${url}/api/tournaments/nope`)).status, 404);
  });
});
