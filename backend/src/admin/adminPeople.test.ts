// HTTP bodies are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { ticTacToe } from "../../../engine/games/ticTacToe";
import type { MatchRecord } from "../../../engine/types";
import { createApp } from "../app";
import { FakeClock } from "../clock";
import { hashToken } from "../identity";
import type { StoredMatch } from "../recorder";
import { MemoryStore } from "../store";
import { emptyRounds } from "../tournaments";
import { BIRR } from "../wallet";

const TEST_TOKEN = "test-admin-token-" + "p".repeat(16);
const ADMIN = { "x-admin-token": TEST_TOKEN };
const CHAMP = "0x" + "c".repeat(40);
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1);

const store = new MemoryStore();
// A finished tournament, saved before the app starts (the tournament module reads it lazily).
store.write("tournaments", {
  done1: {
    id: "done1",
    name: "Old cup",
    gameId: "gebeta",
    host: null,
    size: 4,
    bestOf: 1,
    visibility: "link",
    state: "finished",
    entrants: [
      { id: CHAMP, name: "Champ", bot: false },
      { id: "bot", name: "Bot 1", bot: true },
      { id: "bot", name: "Bot 2", bot: true },
      { id: "bot", name: "Bot 3", bot: true },
    ],
    rounds: emptyRounds(4),
    champion: 0,
    createdAt: T0,
    startedAt: T0 + 1000,
    endedAt: T0 + 60_000,
  },
});
const clock = new FakeClock(T0 + 30 * DAY);
const app = createApp({ store, db: null, clock, admin: { token: () => TEST_TOKEN } });
let url = "";
const sockets: ClientSocket[] = [];

after(() => {
  sockets.forEach((s) => s.disconnect());
  app.io.close();
  app.httpServer.close();
});

async function get(path: string, headers: Record<string, string> = ADMIN): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(url + path, { headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

async function signup(body: Record<string, unknown>): Promise<{ id: string; token: string }> {
  const res = await fetch(url + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json: any = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  return { id: json.profile.id, token: json.token };
}

async function online(token: string) {
  const socket = connect(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function record(matchId: string, gameId: string, players: [string, string], winner: 0 | 1 | null, endedAt: number, moves = 4): StoredMatch {
  const rec: MatchRecord = {
    matchId,
    gameId,
    players,
    bot: players.includes("bot"),
    seed: `seed-${matchId}`,
    log: Array.from({ length: moves }, (_, i) => ({ seat: (i % 2) as 0 | 1, move: i, ts: endedAt - 1000 * (moves - i) })) as any,
    outcome: { winner, draw: winner === null, reason: winner === null ? "draw" : "win" },
    startedAt: endedAt - 60_000,
    endedAt,
  };
  return { record: rec, reveal: {}, commitments: {}, resultHash: `hash-${matchId}`, status: "recorded", commitIndex: 1, resultIndex: 2 };
}

let alice: { id: string; token: string };
let bob: { id: string; token: string };
let carol: { id: string; token: string };
let dave: { id: string; token: string };
let liveId = "";
let liveSeed = "";

before(async () => {
  await new Promise<void>((r) => app.httpServer.listen(0, r));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
  alice = await signup({ name: "Alice", username: "alice", password: "alice-password" });
  bob = await signup({ name: "Bob Builder", username: "bobby", password: "bob-password" });
  carol = await signup({ name: "Carol" });
  dave = await signup({ name: "Dave" });
  // A second sign-in for alice: two open sessions.
  const login = await fetch(url + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "alice", password: "alice-password" }),
  });
  assert.equal(login.status, 200);

  // Money: play balance for a staked match, real money for bob.
  const w = app.wallet;
  assert.ok(w.adjust("play", alice.id, 100 * BIRR, "test funding", "test").ok);
  assert.ok(w.adjust("play", bob.id, 100 * BIRR, "test funding", "test").ok);
  assert.ok(w.adjust("real", bob.id, 50 * BIRR, "test funding", "test").ok);
  const held = w.hold([alice.id, bob.id], 10 * BIRR);
  assert.ok(held.ok);
  w.bind(held.escrow.id, "mstaked");
  w.settle(held.escrow.id, { winner: 0, draw: false });

  store.write("matches", {
    m1: record("m1", "crack-the-code", [alice.id, "bot"], 0, T0 + 1 * DAY, 6),
    m2: record("m2", "tic-tac-toe", [alice.id, bob.id], 1, T0 + 2 * DAY, 5),
    mstaked: record("mstaked", "gebeta", [bob.id, alice.id], 1, T0 + 3 * DAY, 10),
    m4: record("m4", "tic-tac-toe", ["bot", carol.id], null, T0 + 4 * DAY, 9),
  });

  await online(alice.token);
  await online(bob.token);
  const live = app.matches.create({ game: ticTacToe, players: [alice.id, "bot"], botSeat: 1 });
  liveId = live.id;
  liveSeed = live.seed;
  app.tournaments.create(dave.id, { gameId: "tic-tac-toe", name: "Dave cup", size: 4 });
});

const ROUTES = [
  "/api/admin/users",
  "/api/admin/users/0x0000000000000000000000000000000000000000",
  "/api/admin/matches",
  "/api/admin/matches/live",
  "/api/admin/matches/m1",
  "/api/admin/tournaments",
];

describe("admin players and matches read API", () => {
  test("every new route needs admin credentials", async () => {
    for (const path of ROUTES) {
      const r = await get(path, {});
      assert.equal(r.status, 401, path);
      assert.equal((await get(path, { "x-admin-token": "w".repeat(32) })).status, 401, path);
    }
  });

  test("users: all, newest joined first, with balances, matches and sign-in", async () => {
    const { status, body } = await get("/api/admin/users");
    assert.equal(status, 200);
    assert.equal(body.total, 4);
    const joined = body.rows.map((r: any) => r.createdAt);
    assert.deepEqual(joined, [...joined].sort((x: number, y: number) => y - x));
    const a = body.rows.find((r: any) => r.id === alice.id);
    assert.equal(a.name, "Alice");
    assert.equal(a.hasPassword, true);
    assert.equal(a.status, "in-match");
    assert.deepEqual(a.balance, { real: 0, play: 100 * BIRR - 10 * BIRR + 18 * BIRR });
    assert.equal(a.matches, 3);
    assert.equal(a.lastMatchAt, T0 + 3 * DAY);
    assert.equal(typeof a.lastSignInAt, "number");
    const b = body.rows.find((r: any) => r.id === bob.id);
    assert.equal(b.status, "online");
    assert.equal(b.balance.real, 50 * BIRR);
    const c = body.rows.find((r: any) => r.id === carol.id);
    assert.equal(c.status, "offline");
    assert.equal(c.hasPassword, false);
    assert.equal(c.matches, 1);
    assert.equal(c.avatar, null);
    const d = body.rows.find((r: any) => r.id === dave.id);
    assert.equal(d.matches, 0);
    assert.equal(d.lastMatchAt, null);
  });

  test("users: search by name, @username and id prefix", async () => {
    const ids = async (q: string) => (await get(`/api/admin/users?q=${encodeURIComponent(q)}`)).body.rows.map((r: any) => r.id);
    assert.deepEqual(await ids("builder"), [bob.id]);
    assert.deepEqual(await ids("@BOBBY"), [bob.id]);
    assert.deepEqual(await ids("bobb"), [bob.id]);
    assert.deepEqual(await ids(carol.id.slice(0, 12).toUpperCase()), [carol.id]);
    assert.deepEqual(await ids("nobody-here"), []);
  });

  test("users: filters", async () => {
    const ids = async (f: string) => new Set((await get(`/api/admin/users?filter=${f}`)).body.rows.map((r: any) => r.id));
    assert.deepEqual(await ids("registered"), new Set([alice.id, bob.id]));
    assert.deepEqual(await ids("guest"), new Set([carol.id, dave.id]));
    assert.deepEqual(await ids("online"), new Set([alice.id, bob.id]));
    assert.deepEqual(await ids("funded"), new Set([bob.id]));
    assert.equal((await ids("bogus")).size, 4);
  });

  test("users: sort and paging", async () => {
    const order = async (qs: string) => (await get(`/api/admin/users?${qs}`)).body.rows.map((r: any) => r.id);
    assert.deepEqual(await order("sort=name"), [alice.id, bob.id, carol.id, dave.id]);
    assert.deepEqual(await order("sort=name&dir=desc"), [dave.id, carol.id, bob.id, alice.id]);
    assert.deepEqual((await order("sort=matches")).slice(0, 2), [alice.id, bob.id]);
    assert.deepEqual((await order("sort=balance&book=real"))[0], bob.id);
    assert.deepEqual((await order("sort=balance&book=play"))[0], alice.id);
    const lastMatch = await order("sort=lastMatch");
    assert.equal(lastMatch[0], carol.id);
    assert.equal(lastMatch[3], dave.id, "no matches sorts last");
    const p0 = await get("/api/admin/users?sort=name&limit=2&page=0");
    const p1 = await get("/api/admin/users?sort=name&limit=2&page=1");
    assert.equal(p0.body.total, 4);
    assert.deepEqual(p0.body.rows.map((r: any) => r.id), [alice.id, bob.id]);
    assert.deepEqual(p1.body.rows.map((r: any) => r.id), [carol.id, dave.id]);
  });

  test("user detail", async () => {
    const { status, body } = await get(`/api/admin/users/${alice.id.toUpperCase().replace("0X", "0x")}`);
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body.profile).sort(), ["createdAt", "id", "name", "username"]);
    assert.equal(body.account.hasPassword, true);
    assert.equal(body.status, "in-match");
    assert.equal(body.matchId, liveId);
    assert.deepEqual(body.balances, { real: 0, play: 108 * BIRR });
    assert.deepEqual(body.withdrawable, { amount: 0, held: 0, heldUntil: null });
    assert.equal(body.depositPayer, null);
    assert.equal(typeof body.rewards.points, "number");
    assert.equal(typeof body.rewards.overall.rating, "number");
    assert.ok(Array.isArray(body.rewards.badges));
    assert.deepEqual(
      body.perGame.find((g: any) => g.gameId === "tic-tac-toe"),
      { gameId: "tic-tac-toe", played: 1, wins: 0, losses: 1, draws: 0 },
    );
    assert.deepEqual(body.perGame.find((g: any) => g.gameId === "gebeta"), { gameId: "gebeta", played: 1, wins: 1, losses: 0, draws: 0 });
    assert.deepEqual(body.recentMatches.map((m: any) => m.matchId), ["mstaked", "m2", "m1"]);
    assert.equal(body.recentMatches[0].stake.amount, 10 * BIRR);
    assert.deepEqual(body.txns.real, []);
    assert.deepEqual(body.txns.play.map((t: any) => t.kind), ["win", "hold", "adjust"]);
    assert.deepEqual(body.deposits, []);
    assert.deepEqual(body.withdrawals, []);
    assert.equal(body.friendCount, 0);
    assert.equal(body.openSessions, 2);

    const b = (await get(`/api/admin/users/${bob.id}`)).body;
    assert.equal(b.balances.real, 50 * BIRR);
    assert.equal(b.withdrawable.amount, 50 * BIRR);
    assert.equal(b.openSessions, 1);
  });

  test("404s", async () => {
    assert.equal((await get("/api/admin/users/0x0000000000000000000000000000000000000000")).status, 404);
    assert.equal((await get("/api/admin/users/__proto__")).status, 404);
    assert.equal((await get("/api/admin/matches/nope")).status, 404);
    assert.equal((await get("/api/admin/matches/__proto__")).status, 404);
  });

  test("matches: newest first, names, bot flag, filters and paging", async () => {
    const all = await get("/api/admin/matches");
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 4);
    assert.deepEqual(all.body.rows.map((m: any) => m.matchId), ["m4", "mstaked", "m2", "m1"]);
    const m1 = all.body.rows.find((m: any) => m.matchId === "m1");
    assert.equal(m1.gameName, "Crack the Code");
    assert.equal(m1.bot, true);
    assert.deepEqual(m1.players, [
      { profileId: alice.id, name: "Alice", username: "alice", bot: false },
      { profileId: "bot", name: "Bot", username: null, bot: true },
    ]);
    assert.equal(m1.moves, 6);
    assert.equal(m1.durationMs, 60_000);
    assert.equal(m1.stake, null);
    assert.equal(m1.status, "recorded");
    assert.equal(m1.resultIndex, 2);

    const ids = async (qs: string) => (await get(`/api/admin/matches?${qs}`)).body.rows.map((m: any) => m.matchId);
    assert.deepEqual(await ids("game=tic-tac-toe"), ["m4", "m2"]);
    assert.deepEqual(await ids(`player=${bob.id}`), ["mstaked", "m2"]);
    assert.deepEqual(await ids("staked=1"), ["mstaked"]);
    assert.deepEqual(await ids("bot=1"), ["m4", "m1"]);
    assert.deepEqual(await ids("bot=0"), ["mstaked", "m2"]);
    assert.deepEqual(await ids(`player=${alice.id}&bot=0&game=gebeta`), ["mstaked"]);
    const p1 = await get("/api/admin/matches?limit=3&page=1");
    assert.deepEqual(p1.body.rows.map((m: any) => m.matchId), ["m1"]);
    assert.equal(p1.body.total, 4);
  });

  test("a staked match shows its stake and escrow", async () => {
    const row = (await get("/api/admin/matches?staked=1")).body.rows[0];
    assert.deepEqual(row.stake, { amount: 10 * BIRR, book: "play", status: "settled", prize: 18 * BIRR, fee: 2 * BIRR });
    const { status, body } = await get("/api/admin/matches/mstaked");
    assert.equal(status, 200);
    assert.deepEqual(body.stake, row.stake);
    assert.equal(body.escrow.book, "play");
    assert.equal(body.escrow.matchId, "mstaked");
    assert.equal(body.escrow.status, "settled");
    assert.equal(body.escrow.winner, 0);
    assert.deepEqual(body.escrow.players, [alice.id, bob.id]);
    assert.equal(body.commitIndex, 1);
    assert.equal(body.resultIndex, 2);
    assert.equal(body.resultHash, "hash-mstaked");
    assert.equal(body.replay, "/replay/mstaked");
    assert.equal(body.live, undefined);
  });

  test("live matches: listed with names and room, the seed never shown", async () => {
    const live = await get("/api/admin/matches/live");
    assert.equal(live.status, 200);
    assert.equal(live.body.rows.length, 1);
    const row = live.body.rows[0];
    assert.equal(row.matchId, liveId);
    assert.equal(row.gameId, "tic-tac-toe");
    assert.equal(row.bot, true);
    assert.deepEqual(row.players, [
      { profileId: alice.id, name: "Alice", username: "alice", bot: false },
      { profileId: "bot", name: "Bot", username: null, bot: true },
    ]);
    assert.equal(row.spectators, 0);
    assert.equal(row.room, null);
    assert.equal(row.stake, null);
    assert.ok(!live.text.includes(liveSeed));

    const one = await get(`/api/admin/matches/${liveId}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.live, true);
    assert.equal(one.body.matchId, liveId);
    assert.equal(one.body.seed, undefined);
    assert.ok(!one.text.includes(liveSeed));
    assert.ok(!/seed|reveal/i.test(one.text));
  });

  test("tournaments: every one, newest first, host and champion names", async () => {
    const { status, body } = await get("/api/admin/tournaments");
    assert.equal(status, 200);
    assert.equal(body.total, 2);
    const [open, done] = body.rows;
    assert.equal(open.name, "Dave cup");
    assert.equal(open.status, "open");
    assert.deepEqual(open.host, { id: dave.id, name: "Dave" });
    assert.equal(open.players, 1);
    assert.equal(open.champion, null);
    assert.equal(open.size, 4);
    assert.equal(open.bestOf, 1);
    assert.equal(done.id, "done1");
    assert.equal(done.visibility, "link", "link-only tournaments are listed too");
    assert.equal(done.status, "finished");
    assert.equal(done.host, null);
    assert.equal(done.players, 4);
    assert.equal(done.bots, 3);
    assert.deepEqual(done.champion, { id: CHAMP, name: "Champ", bot: false });
    assert.equal(done.gameName, "Gebeta");
    const p1 = await get("/api/admin/tournaments?limit=1&page=1");
    assert.deepEqual(p1.body.rows.map((t: any) => t.id), ["done1"]);
  });

  test("no response carries a private key, password hash or session token", async () => {
    const profiles = store.read<Record<string, any>>("profiles", {});
    const secrets: string[] = ["privateKey", "passwordHash"];
    for (const p of Object.values(profiles)) {
      secrets.push(p.privateKey);
      if (p.passwordHash) secrets.push(p.passwordHash, ...String(p.passwordHash).split(":"));
    }
    for (const t of [alice, bob, carol, dave].map((x) => x.token)) secrets.push(t, hashToken(t));
    for (const hash of Object.keys(store.read<Record<string, unknown>>("sessions", {}))) secrets.push(hash);
    assert.ok(secrets.length > 10);

    const paths = [
      "/api/admin/users",
      "/api/admin/users?filter=online&sort=balance",
      ...[alice, bob, carol, dave].map((x) => `/api/admin/users/${x.id}`),
      "/api/admin/matches",
      "/api/admin/matches?staked=1",
      "/api/admin/matches/live",
      "/api/admin/matches/m1",
      "/api/admin/matches/mstaked",
      `/api/admin/matches/${liveId}`,
      "/api/admin/tournaments",
    ];
    for (const path of paths) {
      const r = await get(path);
      assert.equal(r.status, 200, path);
      for (const s of secrets) assert.ok(!r.text.includes(s), `${path} leaks a secret`);
    }
  });
});
