/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { io as connect, type Socket } from "socket.io-client";
import { crackTheCode } from "../../engine/games/crackTheCode";
import { emptyCells, PAUSE_MS, ticTacToe, TURN_MS, type TicTacToeState } from "../../engine/games/ticTacToe";
import { verifyMatch } from "../../engine/verify";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { BOT_DELAY_MS, DISCONNECT_FORFEIT_MS, type Match } from "./matches";
import { MemoryStore } from "./store";

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const state = (m: Match) => m.cur.state as TicTacToeState;
const win = [0, 3, 1, 4, 2];
const draw = [0, 1, 2, 4, 3, 5, 7, 6, 8];
async function fixture(t: TestContext) {
  const clock = new FakeClock();
  const app = createApp({ store: new MemoryStore(), clock, ledger: { blockTimeMs: 5 } });
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  const url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
  const sockets: Socket[] = [];
  t.after(() => { sockets.forEach((socket) => socket.disconnect()); app.ledger.flush(); app.io.close(); });
  async function player(name: string) {
    const { profile, token } = app.identity.signup(name);
    const socket = connect(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
    return { profile, token, socket };
  }
  const a = await player("Alice");
  const b = await player("Bob");
  const script = (m: Match, cells = win) => cells.forEach((cell) => {
    assert.equal(app.matches.move(m.players[state(m).turn], m.id, { cell }), null);
  });
  return { ...app, clock, url, a, b, player, script };
}
const send = (socket: Socket, event: string, payload: object): Promise<any> => new Promise((resolve, reject) =>
  socket.timeout(2000).emit(event, payload, (err: Error | null, res: any) => err ? reject(err) : resolve(res)));

test("tic-tac-toe: queue, three-board draw, one recorded reward, verification and rematch", async (t) => {
  const f = await fixture(t);
  const games = await fetch(`${f.url}/api/games`).then((r) => r.json()) as any[];
  assert.ok(games.some((g) => g.id === ticTacToe.id));
  assert.equal((await send(f.a.socket, "queue:join", { gameId: ticTacToe.id })).ok, true);
  const paired = await send(f.b.socket, "queue:join", { gameId: ticTacToe.id });
  const m = f.matches.get(paired.matchId)!;
  const seats = m.players.map((id) => id === f.a.profile.id ? f.a.socket : f.b.socket);
  assert.equal((await send(seats[0], "match:move", { matchId: m.id, move: { cell: 0 } })).ok, true);
  assert.equal((await send(seats[0], "match:move", { matchId: m.id, move: { cell: 1 } })).ok, false);
  for (const cell of draw.slice(1)) assert.equal(f.matches.move(m.players[state(m).turn], m.id, { cell }), null);
  assert.equal(f.recorder.get(m.id), null, "a board does not record or pay rewards");
  assert.equal(f.rewards.player(f.a.profile.id).points, 0);
  f.clock.advance(PAUSE_MS);
  f.script(m, draw);
  f.clock.advance(PAUSE_MS);
  f.script(m, draw);
  await wait(60);
  const stored = await fetch(`${f.url}/api/matches/${m.id}`).then((r) => r.json());
  assert.equal(stored.status, "recorded");
  assert.equal(stored.commitIndex, null);
  const report = verifyMatch({ record: stored.record, reveal: stored.reveal, blocks: f.ledger.blocks(), publicKey: f.ledger.publicKey });
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  const bad = structuredClone(stored.record);
  bad.log[0].t++;
  assert.equal(verifyMatch({ record: bad, blocks: f.ledger.blocks(), publicKey: f.ledger.publicKey }).ok, false);
  assert.equal(f.rewards.player(f.a.profile.id).history.filter((h) => h.matchId === m.id).length, 1);
  assert.equal(f.rewards.player(f.a.profile.id).games[ticTacToe.id].draws, 1);
  const board = await fetch(`${f.url}/api/leaderboard?game=tic-tac-toe`).then((r) => r.json());
  assert.equal(board.rows.length, 2);
  assert.equal(f.lobby.requestRematch(f.a.profile.id, m.id).ok, true);
  const rematch = f.lobby.requestRematch(f.b.profile.id, m.id);
  assert.equal(rematch.ok, true);
  if (rematch.ok && "matchId" in rematch) assert.deepEqual(f.matches.get(rematch.matchId!)?.players, [...m.players].reverse());
});

test("tic-tac-toe: pause gets a fresh deadline, spectators and reconnects see the same series", async (t) => {
  const f = await fixture(t);
  const m = f.matches.create({ game: ticTacToe, players: [f.a.profile.id, f.b.profile.id] });
  f.clock.advance(24_000);
  f.script(m);
  assert.equal(m.deadline, f.clock.now() + PAUSE_MS);
  const spectator = await f.player("Watcher");
  const viewEvent = new Promise<any>((resolve) => spectator.socket.once("match:view", resolve));
  assert.equal((await send(spectator.socket, "match:watch", { matchId: m.id })).ok, true);
  const view = await viewEvent;
  assert.equal(view.view.phase, "pause");
  assert.deepEqual(view.view.scores, [1, 0]);
  assert.equal(view.deadline, m.deadline);
  assert.equal((await send(spectator.socket, "match:move", { matchId: m.id, move: { cell: 8 } })).ok, false);
  assert.equal((await send(spectator.socket, "chat:send", { roomId: m.id, text: "Nice board!" })).ok, true);
  f.a.socket.disconnect();
  await wait(60);
  assert.ok(m.away[0]);
  const reconnect = new Promise<void>((resolve) => f.a.socket.once("connect", resolve));
  f.a.socket.connect();
  await reconnect;
  const restored = new Promise<any>((resolve) => f.a.socket.once("match:view", resolve));
  await send(f.a.socket, "match:watch", { matchId: m.id });
  assert.equal((await restored).view.phase, "pause");
  assert.equal(m.away[0], null);
  f.clock.advance(PAUSE_MS - 1);
  assert.equal(state(m).phase, "pause");
  f.clock.advance(1);
  assert.equal(state(m).turn, 1);
  assert.equal(m.deadline, f.clock.now() + TURN_MS);
  f.clock.advance(TURN_MS);
  assert.equal(state(m).board[0], 1, "turn timeout auto-plays the first empty cell");
  assert.equal(state(m).round, 2);
});

test("tic-tac-toe: private room ready countdown and series forfeit", async (t) => {
  const f = await fixture(t);
  const created = await send(f.a.socket, "room:create", { gameId: ticTacToe.id });
  const code = created.room.code;
  assert.equal((await send(f.b.socket, "room:join", { code })).ok, true);
  await send(f.a.socket, "room:ready", { ready: true });
  await send(f.b.socket, "room:ready", { ready: true });
  f.clock.advance(3000);
  const room = f.lobby.room(code)!;
  const m = f.matches.get(room.matchId!)!;
  f.script(m);
  const quitting = m.players[0] === f.a.profile.id ? f.a.socket : f.b.socket;
  await send(quitting, "match:leave", { matchId: m.id });
  assert.deepEqual(m.cur.outcome, { winner: 1, draw: false, reason: "forfeit" });
});

test("tic-tac-toe: disconnect forfeits the whole series", async (t) => {
  const f = await fixture(t);
  const m = f.matches.create({ game: ticTacToe, players: [f.a.profile.id, f.b.profile.id] });
  f.script(m);
  f.a.socket.disconnect();
  await wait(60);
  f.clock.advance(DISCONNECT_FORFEIT_MS);
  assert.equal(m.cur.outcome?.reason, "forfeit");
  assert.equal(m.cur.outcome?.winner, 1);
});

test("tic-tac-toe: bot offer plays a complete verifiable series and bot rematch", async (t) => {
  const f = await fixture(t);
  f.lobby.joinQueue(f.a.profile.id, ticTacToe.id);
  f.clock.advance(10_000);
  const accepted = f.lobby.acceptBot(f.a.profile.id);
  assert.equal(accepted.ok, true);
  if (!accepted.ok || !("matchId" in accepted)) throw new Error("no bot match");
  const m = f.matches.get(accepted.matchId!)!;
  for (let i = 0; !m.cur.outcome; i++) {
    assert.ok(i < 80);
    const s = state(m);
    if (s.phase === "playing" && !m.bots.includes(s.turn)) assert.equal(f.matches.move(f.a.profile.id, m.id, { cell: emptyCells(s.board)[0] }), null);
    else f.clock.advance(s.phase === "pause" ? PAUSE_MS : BOT_DELAY_MS[1]);
  }
  await wait(60);
  const stored = f.recorder.get(m.id)!;
  assert.equal(verifyMatch({ record: stored.record, blocks: f.ledger.blocks(), publicKey: f.ledger.publicKey }).ok, true);
  assert.equal(f.rewards.player(f.a.profile.id).history.length, 1);
  assert.equal(f.rewards.leaderboard(ticTacToe.id).length, 0);
  assert.equal(f.lobby.requestRematch(f.a.profile.id, m.id).ok, true);
});

test("tic-tac-toe: a four-bot tournament completes with recorded series", async (t) => {
  const f = await fixture(t);
  const created = f.tournaments.create(null, ticTacToe.id, true);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("no tournament");
  let tournament = f.tournaments.get(created.tournament.id)!;
  for (let i = 0; tournament.state !== "finished"; i++) {
    assert.ok(i < 300, "tournament must finish even after drawn series");
    f.clock.advance(5_000);
    tournament = f.tournaments.get(tournament.id)!;
  }
  await wait(60);
  assert.ok(tournament.champion?.bot);
  for (const round of tournament.rounds) for (const match of round.matches) {
    assert.equal(match.state, "done");
    for (const id of match.matchIds) assert.equal(f.recorder.get(id)?.status, "recorded");
  }
});

test("simultaneous Crack the Code submissions preserve the running deadline", async (t) => {
  const f = await fixture(t);
  const m = f.matches.create({ game: crackTheCode, players: [f.a.profile.id, f.b.profile.id] });
  const deadline = m.deadline;
  f.clock.advance(5000);
  assert.equal(f.matches.move(f.a.profile.id, m.id, { type: "secret", code: "1234" }), null);
  assert.equal(m.deadline, deadline);
  f.matches.move(f.b.profile.id, m.id, { type: "secret", code: "5678" });
  const roundDeadline = m.deadline;
  f.clock.advance(5000);
  f.matches.move(f.a.profile.id, m.id, { type: "guess", code: "9876" });
  assert.equal(m.deadline, roundDeadline);
});
