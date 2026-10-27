// Socket payloads are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, test } from "node:test";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { firstToThree, TURN_MS, type FirstToThreeState } from "../../engine/games/firstToThree";
import { crackTheCode, type CtcState } from "../../engine/games/crackTheCode";
import { replay } from "../../engine/replay";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { MemoryStore } from "./store";
import { BOT_DELAY_MS, DISCONNECT_FORFEIT_MS, type Match } from "./matches";

const state = (m: Match) => m.cur.state as FirstToThreeState;
const noTimer = { ...firstToThree, id: "first-to-three-no-timer", deadlineMs: () => null };

interface Client {
  socket: ClientSocket;
  events: { name: string; data: any }[];
}

const clock = new FakeClock();
const { httpServer, io, matches, identity } = createApp({ store: new MemoryStore(), clock });
const [alice, bob, carol] = ["Alice", "Bob", "Carol"].map((name) => identity.signup(name));
let url = "";
const clients: Client[] = [];

before(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

// Every test starts with nobody connected.
afterEach(async () => {
  const live = clients.splice(0).filter((c) => c.socket.connected);
  live.forEach((c) => c.socket.disconnect());
  if (live.length) await new Promise((r) => setTimeout(r, 50));
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

/** Resolve with the first recorded event matching, waiting for it if needed. */
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

const viewAt = (c: Client, matchId: string, seq: number) =>
  waitFor(c, "match:view", (d) => d.matchId === matchId && d.seq === seq);

function move(c: Client, matchId: string, m: unknown): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => c.socket.emit("match:move", { matchId, move: m }, resolve));
}

async function disconnect(c: Client) {
  c.socket.disconnect();
  await new Promise((r) => setTimeout(r, 50)); // let the server see it
}

describe("match runtime over sockets", () => {
  test("refuses a socket without a valid token", async () => {
    await assert.rejects(client("nope"), /unauthorized/);
  });

  test("two clients play a full game; the server log replays to the same outcome", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    const m = matches.create({ game: firstToThree, players: [alice.profile.id, bob.profile.id] });

    const startA = await waitFor(a, "match:start", (d) => d.matchId === m.id);
    const startB = await waitFor(b, "match:start", (d) => d.matchId === m.id);
    assert.equal(startA.seat, 0);
    assert.equal(startB.seat, 1);
    const v0 = await viewAt(b, m.id, 0);
    assert.equal(v0.deadline, clock.now() + TURN_MS);

    const script: [Client, string][] = [
      [a, "point"],
      [b, "pass"],
      [a, "point"],
      [b, "point"],
      [a, "point"],
    ];
    for (const [i, [c, type]] of script.entries()) {
      assert.deepEqual(await move(c, m.id, { type }), { ok: true });
      await viewAt(a, m.id, i + 1);
      await viewAt(b, m.id, i + 1);
    }

    const endA = await waitFor(a, "match:end", (d) => d.matchId === m.id);
    const endB = await waitFor(b, "match:end", (d) => d.matchId === m.id);
    assert.deepEqual(endA.outcome, { winner: 0, draw: false, reason: "reached 3" });
    assert.deepEqual(endB, endA);
    assert.equal(endA.reveal.secrets.length, 2);

    const record = matches.record(m)!;
    assert.equal(record.log.length, 5);
    assert.deepEqual(replay(firstToThree, record.seed, record.log).outcome, record.outcome);
    assert.deepEqual(await move(a, m.id, { type: "point" }), { ok: false, reason: "match is over" });
  });

  test("an illegal move returns a reason and changes nothing", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    const m = matches.create({ game: firstToThree, players: [alice.profile.id, bob.profile.id] });
    await viewAt(b, m.id, 0);
    const deadline = m.deadline;

    assert.deepEqual(await move(b, m.id, { type: "point" }), { ok: false, reason: "not your turn" });
    assert.deepEqual(await move(a, m.id, { type: "steal" }), {
      ok: false,
      reason: "move must be {type: 'point' | 'pass'}",
    });
    assert.deepEqual(await move(a, m.id, "x".repeat(5000)), { ok: false, reason: "move too large" });
    assert.deepEqual(await move(a, "missing", { type: "point" }), { ok: false, reason: "no such match" });
    const err = await waitFor(b, "match:error", (d) => d.matchId === m.id);
    assert.equal(err.reason, "not your turn");

    assert.equal(m.log.length, 0);
    assert.equal(m.deadline, deadline);
    assert.deepEqual(state(m).scores, [0, 0]);
    assert.ok(!a.events.some((e) => e.name === "match:view" && e.data.matchId === m.id && e.data.seq > 0));
  });

  test("no payload reveals hidden info before the end, to players or spectators", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    const c = await client(carol.token);
    const m = matches.create({ game: firstToThree, players: [alice.profile.id, bob.profile.id] });
    c.socket.emit("match:watch", { matchId: m.id });
    await viewAt(c, m.id, 0);
    const [secretA, secretB] = state(m).secrets;

    for (const [i, [p, type]] of ([[a, "point"], [b, "pass"], [a, "point"], [b, "point"]] as const).entries()) {
      await move(p, m.id, { type });
      await viewAt(c, m.id, i + 1);
    }
    clock.advance(TURN_MS); // a system timeout entry, too
    await viewAt(c, m.id, 5);
    // Let any match:end from the timeout arrive before we look.
    await new Promise((r) => setTimeout(r, 50));

    const before = (x: Client) => {
      const end = x.events.findIndex((e) => e.name === "match:end" && e.data.matchId === m.id);
      return JSON.stringify(x.events.slice(0, end === -1 ? undefined : end));
    };
    assert.ok(!before(a).includes(`"${secretB}"`), "alice saw bob's secret");
    assert.ok(!before(b).includes(`"${secretA}"`), "bob saw alice's secret");
    assert.ok(!before(c).includes(`"${secretA}"`) && !before(c).includes(`"${secretB}"`), "spectator saw a secret");
    assert.ok(before(a).includes(`"${secretA}"`), "alice should see her own secret");

    while (!m.cur.outcome) {
      const turn = state(m).turn;
      assert.equal(matches.move(m.players[turn], m.id, { type: "point" }), null);
    }
    const end = await waitFor(c, "match:end", (d) => d.matchId === m.id);
    assert.deepEqual(end.reveal, { secrets: [secretA, secretB] });
  });

  test("a turn timer appends a system timeout entry", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    const m = matches.create({ game: firstToThree, players: [alice.profile.id, bob.profile.id] });
    await viewAt(a, m.id, 0);
    clock.advance(TURN_MS - 1);
    assert.equal(m.log.length, 0);
    clock.advance(1);
    assert.deepEqual(m.log[0], { t: clock.now(), seat: "system", move: { type: "timeout" } });
    const v = await viewAt(b, m.id, 1);
    assert.equal(v.view.turn, 1);
    assert.equal(v.deadline, clock.now() + TURN_MS);
    matches.move(alice.profile.id, m.id, null); // ignored, not alice's turn
    assert.equal(m.log.length, 1);
  });

  test("reconnecting restores the match start and current view", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    const m = matches.create({ game: noTimer, players: [alice.profile.id, bob.profile.id] });
    await move(a, m.id, { type: "point" });
    await move(b, m.id, { type: "point" });
    await viewAt(a, m.id, 2);

    await disconnect(a);
    clock.advance(DISCONNECT_FORFEIT_MS - 1_000);
    const a2 = await client(alice.token);
    const start = await waitFor(a2, "match:start", (d) => d.matchId === m.id);
    assert.equal(start.seat, 0);
    const v = await viewAt(a2, m.id, 2);
    assert.deepEqual(v.view.scores, [1, 1]);
    assert.equal(v.view.mySecret, state(m).secrets[0]);

    clock.advance(5_000); // past the original 30 s: the forfeit was cancelled
    assert.equal(m.cur.outcome, null);
    assert.deepEqual(await move(a2, m.id, { type: "point" }), { ok: true });
    await viewAt(a2, m.id, 3);
  });

  test("a player gone for 30 s forfeits", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    const m = matches.create({ game: noTimer, players: [alice.profile.id, bob.profile.id] });
    await viewAt(a, m.id, 0);

    await disconnect(b);
    clock.advance(DISCONNECT_FORFEIT_MS - 1);
    assert.equal(m.cur.outcome, null);
    clock.advance(1);
    assert.deepEqual(m.cur.outcome, { winner: 0, draw: false, reason: "forfeit" });
    assert.deepEqual(m.log.at(-1), { t: clock.now(), seat: "system", move: { type: "forfeit", seat: 1 } });
    const end = await waitFor(a, "match:end", (d) => d.matchId === m.id);
    assert.equal(end.outcome.winner, 0);
  });

  test("match:leave forfeits immediately", async () => {
    const a = await client(alice.token);
    const b = await client(bob.token);
    const m = matches.create({ game: firstToThree, players: [alice.profile.id, bob.profile.id] });
    await viewAt(b, m.id, 0);
    a.socket.emit("match:leave", { matchId: m.id });
    const end = await waitFor(b, "match:end", (d) => d.matchId === m.id);
    assert.deepEqual(end.outcome, { winner: 1, draw: false, reason: "forfeit" });
  });

  test("the bot answers with a human-like delay and finishes the game", async () => {
    const a = await client(alice.token);
    const m = matches.create({ game: firstToThree, players: [alice.profile.id, "bot"], botSeat: 1 });
    const start = await waitFor(a, "match:start", (d) => d.matchId === m.id);
    assert.equal(start.bot, true);

    let seq = 0;
    while (!m.cur.outcome) {
      if (state(m).turn === 0) {
        assert.deepEqual(await move(a, m.id, { type: "point" }), { ok: true });
      } else {
        const before = m.log.length;
        clock.advance(BOT_DELAY_MS[0] - 1);
        assert.equal(m.log.length, before, "bot moved too fast");
        clock.advance(BOT_DELAY_MS[1] - BOT_DELAY_MS[0] + 1);
        assert.equal(m.log.length, before + 1, "bot did not move in time");
        assert.equal(m.log.at(-1)!.seat, 1);
      }
      seq += 1;
      await viewAt(a, m.id, seq);
    }
    assert.ok(m.log.every((e) => e.seat !== "system"));
    const end = await waitFor(a, "match:end", (d) => d.matchId === m.id);
    assert.equal(end.outcome.reason, "reached 3");
    assert.equal(matches.record(m)!.bot, true);
  });

  test("Crack the Code against the bot: hidden secret, shared round deadline, replayable", async () => {
    const a = await client(alice.token);
    const m = matches.create({ game: crackTheCode, players: [alice.profile.id, "bot"], botSeat: 1 });
    const ctc = () => m.cur.state as CtcState;
    assert.deepEqual(await move(a, m.id, { type: "secret", code: "1234" }), { ok: true });
    clock.advance(BOT_DELAY_MS[1]);
    assert.equal(ctc().phase, "rounds");

    const guesses = ["5678", "9123", "4567", "8912", "3456", "7891", "2345", "6789"];
    let rounds = 0;
    while (!m.cur.outcome) {
      const round = ctc().round;
      const deadline = m.deadline;
      assert.deepEqual(await move(a, m.id, { type: "guess", code: guesses[rounds % guesses.length] }), { ok: true });
      if (ctc().round === round && !m.cur.outcome) {
        assert.equal(m.deadline, deadline, "one seat moving must not reset the round timer");
        clock.advance(BOT_DELAY_MS[1]);
      }
      rounds += 1;
      assert.ok(rounds <= 40, "match should end");
    }

    await waitFor(a, "match:end", (d) => d.matchId === m.id);
    const botSecret = ctc().secrets[1]!;
    const end = a.events.findIndex((e) => e.name === "match:end" && e.data.matchId === m.id);
    // Everything sent while the match was live (the final "over" view is sent alongside match:end).
    const seen = a.events.slice(0, end).filter((e) => e.name !== "match:view" || e.data.view.phase !== "over");
    assert.ok(seen.every((e) => e.name !== "match:view" || e.data.view.secrets === null));
    // The code can only show up if alice happened to guess it herself.
    const guessed = m.log.some((e) => e.seat === 0 && (e.move as { code: string }).code === botSecret);
    assert.ok(guessed || !JSON.stringify(seen).includes(`"${botSecret}"`), "alice saw the bot's secret");
    const record = matches.record(m)!;
    assert.deepEqual(replay(crackTheCode, record.seed, record.log).outcome, record.outcome);
  });
});
