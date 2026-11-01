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
import { emptyRounds, MAX_REMATCHES, parseCreate, ROUND_BREAK_MS, roundName, seedOrder, SERIES_BREAK_MS } from "./tournaments";

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
  for (let i = 0; i < 5000; i++) {
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
    if (!moved) clock.advance(Math.max(BOT_DELAY_MS[1], ROUND_BREAK_MS, SERIES_BREAK_MS));
  }
  throw new Error("tournament did not finish");
}

describe("tournament", () => {
  test("a simulated 4-bot tournament runs every round and crowns a champion", async () => {
    const res = tournaments.create(null, { gameId: firstToThree.id, fillWithBots: true });
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
    const res = tournaments.create(a.id, { gameId: firstToThree.id });
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
    const res = tournaments.create(null, { gameId: alwaysDraw.id, fillWithBots: true });
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
    assert.equal((await send(cf, "tournament:addBots", { id })).reason, "only the host can start it");

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

  test("an 8-player tournament runs quarterfinals, semifinals and a final", async () => {
    const host = people[0];
    const res = tournaments.create(host.id, { gameId: firstToThree.id, size: 8, name: "  Friday   cup " });
    assert.ok(res.ok);
    const id = res.tournament.id;
    assert.equal(res.tournament.name, "Friday cup");
    assert.equal(res.tournament.size, 8);
    assert.deepEqual(res.tournament.rounds.map((r: any) => r.name), ["Quarterfinal", "Semifinal", "Final"]);
    for (const p of people.slice(1, 7)) assert.ok(tournaments.join(p.id, id).ok);
    assert.equal(tournaments.get(id)!.state, "open", "waits for the eighth player");
    assert.ok(tournaments.join(people[7].id, id).ok);
    assert.equal(tournaments.get(id)!.state, "running");
    assert.equal(matches.live().length, 4, "all four quarterfinals start at once");

    const t = playOut(id);
    assert.deepEqual(t.rounds.map((r) => r.matches.length), [4, 2, 1]);
    // First round follows the standard seed order: 1v8, 4v5, 2v7, 3v6.
    assert.deepEqual(t.rounds[0].matches.map((m) => m.players.map((p) => p!.seed)), [[1, 8], [4, 5], [2, 7], [3, 6]]);
    // Each later pairing is the winners of the two matches feeding it.
    for (let r = 1; r < t.rounds.length; r++) {
      t.rounds[r].matches.forEach((m, i) => {
        const feeders = t.rounds[r - 1].matches.slice(i * 2, i * 2 + 2).map((f) => f.winner!.seed);
        assert.deepEqual(m.players.map((p) => p!.seed), feeders);
      });
    }
    assert.ok(t.champion && !t.champion.bot);
    assert.deepEqual(t.champion, t.rounds[2].matches[0].winner);
    await settle(100);
    assert.ok(rewards.player(t.champion.id).badges.some((x) => x.id === "champion" && x.source === id));
  });

  test("a 16-bot tournament runs four rounds to a champion", () => {
    const res = tournaments.create(null, { gameId: firstToThree.id, size: 16, fillWithBots: true });
    assert.ok(res.ok);
    assert.equal(res.tournament.entrants.length, 16);
    assert.equal(matches.live().length, 8);
    const t = playOut(res.tournament.id);
    assert.deepEqual(t.rounds.map((r) => r.name), ["Round of 16", "Quarterfinal", "Semifinal", "Final"]);
    assert.deepEqual(t.rounds.map((r) => r.matches.length), [8, 4, 2, 1]);
    assert.deepEqual(t.rounds[0].matches.flatMap((m) => m.players.map((p) => p!.seed)), seedOrder(16).map((s) => s + 1));
    for (const r of t.rounds) for (const m of r.matches) assert.equal(m.state, "done");
    assert.ok(t.champion);
  });

  test("best-of-3: a pairing ends at two wins, players swap seats each game", () => {
    const res = tournaments.create(null, { gameId: firstToThree.id, size: 8, bestOf: 3, fillWithBots: true });
    assert.ok(res.ok);
    assert.equal(res.tournament.bestOf, 3);
    const t = playOut(res.tournament.id);
    for (const r of t.rounds) {
      for (const bm of r.matches) {
        const winnerAt = bm.players.findIndex((p) => p!.seed === bm.winner!.seed);
        assert.equal(bm.score[winnerAt], 2);
        assert.ok(bm.score[1 - winnerAt] <= 1);
        assert.equal(bm.games.length, bm.score[0] + bm.score[1]);
        assert.deepEqual(bm.games.map((g) => g.matchId), bm.matchIds);
        assert.equal(bm.games.at(-1)!.winner, winnerAt, "the last game decides it");
        for (let i = 1; i < bm.matchIds.length; i++) {
          const [prev, cur] = [matches.get(bm.matchIds[i - 1])!, matches.get(bm.matchIds[i])!];
          assert.deepEqual(cur.players, [...prev.players].reverse());
        }
      }
    }
    assert.ok(t.champion);
  });

  test("best-of-3: the next game waits for the series break", () => {
    const res = tournaments.create(null, { gameId: firstToThree.id, bestOf: 3, fillWithBots: true });
    assert.ok(res.ok);
    const id = res.tournament.id;
    // Let the bots finish game one of both semifinals.
    for (let i = 0; i < 200 && tournaments.get(id)!.rounds[0].matches.some((m) => m.games[0].state !== "done"); i++) {
      clock.advance(BOT_DELAY_MS[1]);
    }
    const semis = tournaments.get(id)!.rounds[0].matches;
    assert.ok(semis.every((m) => m.games.length >= 1 && m.games[0].state === "done"));
    playOut(id);
  });

  test("best-of-3 of endless draws: replayed twice, then a coin flip", () => {
    const res = tournaments.create(null, { gameId: alwaysDraw.id, bestOf: 3, fillWithBots: true });
    assert.ok(res.ok);
    const t = playOut(res.tournament.id);
    for (const r of t.rounds) {
      for (const bm of r.matches) {
        assert.equal(bm.matchIds.length, MAX_REMATCHES + 1);
        assert.deepEqual(bm.score, [0, 0]);
        assert.equal(bm.decidedBy, "coin flip");
      }
    }
  });

  test("the host starts an 8-player tournament early and bots fill the seats", async () => {
    const [host, guest] = await Promise.all([client(people[2].token), client(people[3].token)]);
    const created = await send(host, "tournament:create", { gameId: firstToThree.id, size: 8, bestOf: 3 });
    assert.ok(created.ok);
    const id = created.tournament.id;
    assert.ok((await send(guest, "tournament:join", { id })).ok);
    assert.equal((await send(guest, "tournament:start", { id })).reason, "only the host can start it");
    assert.ok((await send(host, "tournament:start", { id })).ok);
    const t = tournaments.get(id)!;
    assert.equal(t.state, "running");
    assert.equal(t.entrants.filter((e) => e.bot).length, 6);
    assert.equal((await send(host, "tournament:start", { id })).reason, "tournament already started");
    playOut(id);
  });

  test("link-only tournaments are left out of the list but open by id", async () => {
    const res = tournaments.create(people[5].id, { gameId: firstToThree.id, visibility: "link" });
    assert.ok(res.ok);
    const id = res.tournament.id;
    assert.equal(res.tournament.visibility, "link");
    assert.ok(!(await json("/api/tournaments")).some((x: any) => x.id === id));
    assert.ok(!(await json(`/api/tournaments?game=${firstToThree.id}`)).some((x: any) => x.id === id));
    assert.equal((await json(`/api/tournaments/${id}`)).id, id);
    assert.ok(tournaments.join(people[6].id, id).ok, "joining by id works");
    for (const p of [people[5], people[6]]) assert.ok(tournaments.leave(p.id, id).ok);
    assert.equal(tournaments.get(id), null, "everyone leaving drops it");
  });

  test("create rejects bad options and defaults the rest", async () => {
    const c = await client(people[1].token);
    for (const [msg, reason] of [
      [{ size: 6 }, "size must be 4, 8 or 16"],
      [{ size: "8" }, "size must be 4, 8 or 16"],
      [{ bestOf: 2 }, "best of must be 1 or 3"],
      [{ visibility: "secret" }, "visibility must be open or link"],
      [{ name: 5 }, "name must be text"],
      [{ name: "x".repeat(41) }, "name must be at most 40 characters"],
    ] as const) {
      assert.equal((await send(c, "tournament:create", { gameId: firstToThree.id, ...msg })).reason, reason);
    }
    const ok = await send(c, "tournament:create", { gameId: firstToThree.id });
    assert.equal(ok.tournament.size, 4);
    assert.equal(ok.tournament.bestOf, 1);
    assert.equal(ok.tournament.visibility, "open");
    assert.equal(ok.tournament.name, `${firstToThree.name} tournament`);
    assert.deepEqual(ok.tournament.rounds.map((r: any) => r.name), ["Semifinal", "Final"]);
    assert.ok((await send(c, "tournament:leave", { id: ok.tournament.id })).ok);
  });

  test("unknown game and unknown tournament are rejected", async () => {
    const c = await client(people[1].token);
    assert.equal((await send(c, "tournament:create", { gameId: "nope" })).reason, "unknown game");
    assert.equal((await send(c, "tournament:join", { id: "nope" })).reason, "no such tournament");
    assert.equal((await fetch(`${url}/api/tournaments/nope`)).status, 404);
  });
});

describe("bracket helpers", () => {
  test("seed order keeps the top two seeds apart until the final", () => {
    assert.deepEqual(seedOrder(4), [0, 3, 1, 2]);
    assert.deepEqual(seedOrder(8), [0, 7, 3, 4, 1, 6, 2, 5]);
    for (const n of [4, 8, 16]) assert.deepEqual([...seedOrder(n)].sort((a, b) => a - b), [...Array(n).keys()]);
    const s16 = seedOrder(16);
    assert.ok(s16.indexOf(0) < 8 && s16.indexOf(1) >= 8);
  });

  test("round names and bracket shape follow the size", () => {
    assert.deepEqual([0, 1, 2, 3].map((r) => roundName(r, 4)), ["Round of 16", "Quarterfinal", "Semifinal", "Final"]);
    assert.deepEqual(emptyRounds(16).map((r) => r.length), [8, 4, 2, 1]);
    assert.deepEqual(emptyRounds(4).map((r) => r.length), [2, 1]);
  });

  test("parseCreate defaults", () => {
    assert.deepEqual(parseCreate({}, "Gebeta"), { ok: true, name: "Gebeta tournament", size: 4, bestOf: 1, visibility: "open" });
  });
});
