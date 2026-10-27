// Socket payloads and HTTP bodies are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { crackTheCode, type CtcState } from "../../engine/games/crackTheCode";
import { firstToThree } from "../../engine/games/firstToThree";
import type { Block } from "../../engine/ledger";
import { verifyMatch, type CheckName } from "../../engine/verify";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { BOT_DELAY_MS } from "./matches";
import { MemoryStore } from "./store";

const clock = new FakeClock();
const { httpServer, io, matches } = createApp({ store: new MemoryStore(), clock, ledger: { blockTimeMs: 5 } });
let url = "";
const sockets: ClientSocket[] = [];

before(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

after(() => {
  sockets.forEach((s) => s.disconnect());
  io.close();
});

async function api(path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(url + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function player(name: string) {
  const { body } = await api("/api/signup", { name });
  const socket = connect(url, { auth: { token: body.token }, transports: ["websocket"], forceNew: true, reconnection: false });
  sockets.push(socket);
  const events: { name: string; data: any }[] = [];
  socket.onAny((n, data) => events.push({ name: n, data }));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const waitFor = (n: string, pred: (d: any) => boolean = () => true, ms = 3000) =>
    new Promise<any>((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const hit = events.find((e) => e.name === n && pred(e.data));
        if (hit) return resolve(hit.data);
        if (Date.now() - started > ms) return reject(new Error(`timed out waiting for ${n}`));
        setTimeout(tick, 5);
      };
      tick();
    });
  const move = (matchId: string, m: unknown) =>
    new Promise<any>((resolve) => socket.emit("match:move", { matchId, move: m }, resolve));
  return { id: body.profile.id as string, events, waitFor, move };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const failed = (report: ReturnType<typeof verifyMatch>) => report.checks.filter((c) => !c.ok).map((c) => c.name);
const check = (report: ReturnType<typeof verifyMatch>, name: CheckName) => report.checks.find((c) => c.name === name)!;

describe("recording and verify", () => {
  let stored: any;
  let ledger: { publicKey: string; blocks: Block[] };

  test("signup → bot match → recorded → verify all green", async () => {
    const alice = await player("Alice");
    const m = matches.create({ game: crackTheCode, players: [alice.id, "bot"], botSeat: 1 });
    assert.equal((await api(`/api/matches/${m.id}`)).status, 409, "record must not be served while live");

    assert.deepEqual(await alice.move(m.id, { type: "secret", code: "1234" }), { ok: true });
    clock.advance(BOT_DELAY_MS[1]);
    assert.equal((m.cur.state as CtcState).phase, "rounds");

    // The commit block goes out once both secrets exist, before any guess.
    const committed = await alice.waitFor("match:committed", (d) => d.matchId === m.id);
    assert.deepEqual(Object.keys(committed.commitments).sort(), ["0", "1"]);
    assert.equal(m.log.filter((e) => (e.move as any)?.type === "guess").length, 0);
    assert.equal((await api(`/api/matches/${m.id}`)).status, 409);

    const guesses = ["5678", "9123", "4567", "8912", "3456", "7891"];
    for (let i = 0; !m.cur.outcome; i++) {
      assert.ok(i < 40, "match should end");
      await alice.move(m.id, { type: "guess", code: guesses[i % guesses.length] });
      if (!m.cur.outcome) clock.advance(BOT_DELAY_MS[1]);
    }

    const recorded = await alice.waitFor("match:recorded", (d) => d.matchId === m.id);
    const res = await api(`/api/matches/${m.id}`);
    assert.equal(res.status, 200);
    stored = res.body;
    assert.equal(stored.status, "recorded");
    assert.equal(stored.resultIndex, recorded.ledgerIndex);
    assert.equal(stored.commitIndex, committed.ledgerIndex);
    assert.ok(stored.commitIndex < stored.resultIndex);
    assert.deepEqual(stored.reveal.secrets[0], "1234");

    ledger = (await api("/api/ledger")).body;
    const result = ledger.blocks[stored.resultIndex];
    assert.equal(result.kind, "result");
    assert.deepEqual(Object.keys(result.payload as object).sort(), ["matchId", "resultHash", "ts", "winner"]);

    const report = verifyMatch({ record: stored.record, reveal: stored.reveal, ...ledger });
    assert.deepEqual(failed(report), [], JSON.stringify(report.checks, null, 2));
    assert.equal(report.ok, true);
    assert.deepEqual(
      report.checks.map((c) => c.name),
      ["game", "replay", "outcome", "resultBlock", "resultHash", "commitments", "reveal", "chain"],
    );

    const list = await api(`/api/matches?player=${alice.id}`);
    assert.equal(list.body[0].matchId, m.id);
  });

  test("a tampered log entry breaks the result hash", () => {
    const record = clone(stored.record);
    const i = record.log.findIndex((e: any) => e.seat === 0 && e.move?.type === "guess");
    record.log[i].t += 1; // still a legal log, but not the one on the ledger
    const report = verifyMatch({ record, reveal: stored.reveal, ...ledger });
    assert.deepEqual(failed(report), ["resultHash"]);
    assert.match(check(report, "resultHash").detail, new RegExp(`block ${stored.resultIndex} has`));
  });

  test("a tampered outcome fails the outcome and hash checks", () => {
    const record = clone(stored.record);
    record.outcome = { winner: 0, draw: false, reason: "cracked the code" };
    const report = verifyMatch({ record, reveal: stored.reveal, ...ledger });
    assert.ok(failed(report).includes("outcome"));
    assert.ok(failed(report).includes("resultHash"));
  });

  test("a swapped secret in the log fails the commitment check", () => {
    const record = clone(stored.record);
    const i = record.log.findIndex((e: any) => e.seat === 0 && e.move?.type === "secret");
    record.log[i].move.code = "9876";
    const report = verifyMatch({ record, reveal: stored.reveal, ...ledger });
    assert.ok(failed(report).includes("commitments"));
    assert.match(check(report, "commitments").detail, /do not match/);
  });

  test("a tampered revealed secret fails the reveal check", () => {
    const reveal = clone(stored.reveal);
    reveal.secrets[1] = reveal.secrets[1] === "9876" ? "6789" : "9876";
    const report = verifyMatch({ record: stored.record, reveal, ...ledger });
    assert.deepEqual(failed(report), ["reveal"]);
  });

  test("an edited ledger block fails the chain at that index", () => {
    const blocks = clone(ledger.blocks);
    (blocks[stored.resultIndex].payload as any).resultHash = "f".repeat(64);
    const report = verifyMatch({ record: stored.record, reveal: stored.reveal, blocks, publicKey: ledger.publicKey });
    assert.deepEqual(failed(report), ["resultHash", "chain"]);
    assert.equal(check(report, "chain").detail, `block ${stored.resultIndex}: hash does not match contents`);
  });

  test("a match with no result block on the ledger fails", () => {
    const blocks = ledger.blocks.slice(0, stored.resultIndex);
    const report = verifyMatch({ record: stored.record, reveal: stored.reveal, blocks, publicKey: ledger.publicKey });
    assert.deepEqual(failed(report), ["resultBlock", "resultHash"]);
  });

  test("a game without hidden data is recorded with no commit block", async () => {
    const alice = await player("Alicia");
    const m = matches.create({ game: firstToThree, players: [alice.id, "bot"], botSeat: 1 });
    await alice.move(m.id, { type: "point" });
    while (!m.cur.outcome) clock.advance(BOT_DELAY_MS[1]);
    await alice.waitFor("match:recorded", (d) => d.matchId === m.id);
    const body = (await api(`/api/matches/${m.id}`)).body;
    assert.equal(body.commitIndex, null);
    const report = verifyMatch({ record: body.record, reveal: body.reveal, ...(await api("/api/ledger")).body, game: firstToThree });
    assert.equal(report.ok, true, JSON.stringify(report.checks));
  });

  test("unknown matches are 404", async () => {
    assert.equal((await api("/api/matches/nope")).status, 404);
  });
});
