// Hostile socket payloads must never take the server down. A crash restarts the process,
// and a restart used to refund every live stake (audit finding C1).
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import { firstToThree } from "../../engine/games/firstToThree";
import type { AnyGame } from "../../engine/types";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { guardSocket } from "./safe";
import { MemoryStore } from "./store";

const games: AnyGame[] = [firstToThree];
const { httpServer, io, identity } = createApp({
  store: new MemoryStore(),
  ledger: { blockTimeMs: 1 },
  clock: new FakeClock(),
  games: { get: (id) => games.find((g) => g.id === id), list: () => games },
});
const alice = identity.signup("Alice");
let url = "";

before(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});
after(() => io.close());

const EVENTS = [
  "friend:request", "friend:add", "friend:accept", "friend:decline", "friend:cancel", "friend:remove", "friend:list", "friend:invite",
  "chat:send", "chat:react", "chat:history",
  "queue:join", "queue:leave", "rematch:status", "rematch:request", "rematch:cancel",
  "room:create", "room:join", "room:ready", "room:leave",
  "match:move", "match:watch", "match:leave",
  "tournament:create", "tournament:join", "tournament:leave", "tournament:start", "tournament:addBots", "tournament:watch",
  "wallet:get", "wallet:faucet", "wallet:deposit", "wallet:withdraw",
];
const KEYS = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty"];
const FIELDS = ["profileId", "username", "matchId", "roomId", "code", "gameId", "id", "tournamentId", "bank", "reference", "account", "amount", "stake", "text", "emoji", "move"];
const PAYLOADS: unknown[] = [
  null, 0, -1, "", true, [], {}, 1e309,
  ...KEYS,
  ...KEYS.flatMap((k) => FIELDS.map((f) => ({ [f]: k }))),
  ...FIELDS.map((f) => ({ [f]: {} })),
  ...FIELDS.map((f) => ({ [f]: [] })),
  ...FIELDS.map((f) => ({ [f]: null })),
  JSON.parse('{"__proto__": {"polluted": true}}'),
];

describe("hostile socket payloads", () => {
  test("no handler throws, and the server keeps answering", async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    const socket: ClientSocket = connect(url, { auth: { token: alice.token }, transports: ["websocket"], forceNew: true, reconnection: false });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      for (const event of EVENTS) {
        for (const payload of PAYLOADS) {
          // Fire and forget: some handlers never ack a bad message, which is fine.
          socket.emit(event, payload, () => {});
        }
      }
      // Still alive: a normal call answers.
      const res: any = await new Promise((resolve) => socket.emit("friend:list", resolve));
      assert.equal(res.ok, true);
      assert.equal(({} as any).polluted, undefined);
      assert.deepEqual(errors, [], "a socket handler threw");
    } finally {
      console.error = original;
      socket.disconnect();
    }
  });

  test("guardSocket turns a throwing handler into an error ack", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const fake: any = { id: "s1", data: { profileId: "p" }, on: (e: string, h: any) => handlers.set(e, h) };
    const logged: string[] = [];
    guardSocket(fake, (msg) => logged.push(msg));
    fake.on("boom", () => {
      throw new TypeError("x.includes is not a function");
    });
    fake.on("later", async () => {
      throw new Error("async");
    });
    const acks: unknown[] = [];
    handlers.get("boom")!({}, (r: unknown) => acks.push(r));
    handlers.get("later")!({}, (r: unknown) => acks.push(r));
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(acks, [{ ok: false, reason: "server error" }, { ok: false, reason: "server error" }]);
    assert.equal(logged.length, 2);
  });
});
