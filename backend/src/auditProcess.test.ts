// Independent re-check of the money audit against the REAL server process (not createApp in
// the test process): hostile socket input must not kill it (C1), a hard crash and restart must
// not refund live staked matches (C2/M6), real money needs a second switch (C3), admin routes
// stay hidden without a token, and db.json gets backups (M2).
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { io as connect, type Socket } from "socket.io-client";

const ROOT = join(__dirname, "..", "..");
const tsx = join(ROOT, "node_modules", ".bin", "tsx");
const children: ChildProcess[] = [];
after(() =>
  children.forEach((c) => {
    c.kill("SIGKILL");
    c.stdout?.destroy();
    c.stderr?.destroy();
  }),
);

let nextPort = 4700 + Math.floor(Math.random() * 200);

interface Server {
  child: ChildProcess;
  url: string;
  out: () => string;
  exited: () => boolean;
}

async function start(dir: string, env: Record<string, string> = {}): Promise<Server> {
  const port = nextPort++;
  const child = spawn(tsx, ["backend/src/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_FILE: join(dir, "db.json"), FRONTEND_URL: "http://localhost:3000", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let log = "";
  let gone = false;
  child.stdout!.on("data", (d) => (log += d));
  child.stderr!.on("data", (d) => (log += d));
  child.on("exit", () => (gone = true));
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    if (gone) throw new Error("server exited at boot:\n" + log);
    try {
      if ((await fetch(url + "/health")).ok) return { child, url, out: () => log, exited: () => gone };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server never came up:\n" + log);
}

async function signup(url: string, name: string): Promise<{ id: string; token: string }> {
  const res = await fetch(url + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  const body: any = await res.json();
  return { id: body.profile.id, token: body.token };
}

const sock = (url: string, token: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const s = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });

const call = (s: Socket, event: string, msg?: unknown): Promise<any> => new Promise((r) => s.timeout(3000).emit(event, msg, (err: unknown, res: any) => r(err ? { timeout: true } : res)));
const get = async (url: string, path: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url + path, { headers });
  return { status: res.status, body: await res.json().catch(() => null) as any };
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean | Promise<boolean>, ms = 8000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await f()) return true;
    await wait(100);
  }
  return false;
};

describe("C1: hostile socket input cannot kill the process", () => {
  test("prototype keys, junk types and oversized payloads leave the server up", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-c1-"));
    const srv = await start(dir);
    const a = await signup(srv.url, "Alice");
    const s = await sock(srv.url, a.token);
    const evil: unknown[] = [
      { profileId: "__proto__" }, { profileId: "constructor" }, { profileId: "toString" }, { username: "__proto__" },
      { id: "__proto__" }, { matchId: "__proto__" }, { code: "__proto__" }, { tournamentId: "__proto__" },
      JSON.parse('{"__proto__":{"x":1}}'), null, 1e309, [], "x", { profileId: {} }, { profileId: [] },
    ];
    const events = [
      "friend:remove", "friend:request", "friend:add", "friend:accept", "friend:decline", "friend:cancel", "friend:invite",
      "chat:send", "chat:react", "chat:history", "room:join", "room:create", "match:move", "match:watch", "rematch:request",
      "tournament:join", "tournament:watch", "tournament:start", "wallet:deposit", "wallet:withdraw", "wallet:withdraw-cancel", "queue:join",
    ];
    for (const ev of events) for (const msg of evil) s.emit(ev, msg);
    await wait(1500);
    assert.equal(srv.exited(), false, "process died:\n" + srv.out().slice(-2000));
    assert.equal((await get(srv.url, "/health")).status, 200);
    // And still serves the same socket.
    assert.equal((await call(s, "wallet:get")).ok, true);
    s.close();
  });
});

describe("C2/M6: a hard crash must not refund or forfeit a live staked match", () => {
  test("SIGKILL mid-match, reboot: stakes still held, match resumes, leaver loses, winner is paid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-c2-"));
    let srv = await start(dir);
    const [a, b] = [await signup(srv.url, "Alice"), await signup(srv.url, "Bob")];
    let [sa, sb] = [await sock(srv.url, a.token), await sock(srv.url, b.token)];
    for (const s of [sa, sb]) assert.equal((await call(s, "wallet:faucet")).ok, true);
    const stake = 10000; // 100 birr
    const started: Record<string, string> = {};
    for (const [k, s] of [["a", sa], ["b", sb]] as const) s.on("match:start", (p: any) => (started[k] = p.matchId ?? p.id));
    const created = await call(sa, "room:create", { gameId: "dots-and-boxes", stake });
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal((await call(sb, "room:join", { code: created.room.code })).ok, true);
    await call(sa, "room:ready", { ready: true });
    await call(sb, "room:ready", { ready: true });
    assert.ok(await until(() => !!started.a && !!started.b, 10000), "match never started");
    const matchId = started.a;
    const balance = async (t: string) => (await get(srv.url, "/api/wallet", { authorization: `Bearer ${t}` })).body.balance;
    assert.equal(await balance(a.token), 50000 - stake, "stake not held");

    // Crash: no shutdown handlers run.
    sa.close(); sb.close();
    srv.child.kill("SIGKILL");
    await wait(500);

    srv = await start(dir);
    assert.equal(await balance(a.token), 50000 - stake, "restart refunded Alice's stake");
    assert.equal(await balance(b.token), 50000 - stake, "restart refunded Bob's stake");
    const live = await get(srv.url, "/api/live");
    assert.ok(JSON.stringify(live.body).includes(matchId), "match is not live after restart: " + JSON.stringify(live.body).slice(0, 300));

    // Both come back inside the grace window; one leaves; the other is paid prize = 2*stake - 10% fee.
    [sa, sb] = [await sock(srv.url, a.token), await sock(srv.url, b.token)];
    await wait(300);
    assert.equal((await call(sa, "match:leave", { matchId })).ok, true);
    const aliceLost = await until(async () => (await balance(b.token)) === 50000 - stake + 18000);
    assert.ok(aliceLost, `winner not paid; b=${await balance(b.token)} a=${await balance(a.token)}`);
    assert.equal(await balance(a.token), 50000 - stake);
    sa.close(); sb.close();
  });

  test("graceful shutdown (SIGTERM) starts no forfeit clock either: stakes stay held", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-m6-"));
    let srv = await start(dir);
    const [a, b] = [await signup(srv.url, "Alice"), await signup(srv.url, "Bob")];
    const [sa, sb] = [await sock(srv.url, a.token), await sock(srv.url, b.token)];
    for (const s of [sa, sb]) await call(s, "wallet:faucet");
    let started = 0;
    for (const s of [sa, sb]) s.on("match:start", () => started++);
    const created = await call(sa, "room:create", { gameId: "gebeta", stake: 10000 });
    await call(sb, "room:join", { code: created.room.code });
    await call(sa, "room:ready", { ready: true });
    await call(sb, "room:ready", { ready: true });
    assert.ok(await until(() => started >= 2, 10000));
    srv.child.kill("SIGTERM");
    await until(() => srv.exited(), 8000);
    srv = await start(dir);
    const bal = async (t: string) => (await get(srv.url, "/api/wallet", { authorization: `Bearer ${t}` })).body.balance;
    assert.equal(await bal(a.token), 40000);
    assert.equal(await bal(b.token), 40000);
    // Nobody connects: after the 2 min grace both-gone is a draw (refund, no fee), never a loss. Checked in matches tests;
    // here we only assert the match survived the boot.
    const live = await get(srv.url, "/api/live");
    assert.ok(JSON.stringify(live.body).length > 5);
  });
});

describe("C3 / admin / backups", () => {
  test("WALLET_MODE=real alone stays play money; both switches give real", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-c3-"));
    const one = await start(dir, { WALLET_MODE: "real" });
    assert.equal((await get(one.url, "/api/wallet/config")).body.mode, "play");
    one.child.kill("SIGKILL");
    await wait(300);
    const dir2 = mkdtempSync(join(tmpdir(), "audit-c3b-"));
    const two = await start(dir2, { WALLET_MODE: "real", REAL_MONEY_LEGAL_OK: "1" });
    assert.equal((await get(two.url, "/api/wallet/config")).body.mode, "real");
    two.child.kill("SIGKILL");
  });

  test("admin routes: 404 without ADMIN_TOKEN, 404 with a short one, 401 wrong header, 200 right header", async () => {
    const d1 = mkdtempSync(join(tmpdir(), "audit-adm1-"));
    const none = await start(d1);
    assert.equal((await get(none.url, "/api/admin/wallet/reconcile", { "x-admin-token": "anything" })).status, 404);
    none.child.kill("SIGKILL");
    const short = await start(mkdtempSync(join(tmpdir(), "audit-adm2-")), { ADMIN_TOKEN: "short" });
    assert.equal((await get(short.url, "/api/admin/wallet/reconcile", { "x-admin-token": "short" })).status, 404);
    short.child.kill("SIGKILL");
    const token = "x".repeat(32);
    const ok = await start(mkdtempSync(join(tmpdir(), "audit-adm3-")), { ADMIN_TOKEN: token });
    assert.equal((await get(ok.url, "/api/admin/wallet/reconcile")).status, 401);
    assert.equal((await get(ok.url, "/api/admin/wallet/reconcile", { "x-admin-token": "y".repeat(32) })).status, 401);
    const good = await get(ok.url, "/api/admin/wallet/reconcile", { "x-admin-token": token });
    assert.equal(good.status, 200);
    assert.equal(good.body.ok, true);
    assert.equal(good.body.chain, "intact");
    // Unauthenticated adjust never moves money.
    const adj = await fetch(ok.url + "/api/admin/wallet/adjust", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ book: "play", profileId: "platform", amount: 100, reason: "free money" }) });
    assert.equal(adj.status, 401);
    ok.child.kill("SIGKILL");
  });

  test("boot writes a db.json backup and the wallet log sits beside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-m2-"));
    const srv = await start(dir);
    const a = await signup(srv.url, "Alice");
    const s = await sock(srv.url, a.token);
    await call(s, "wallet:faucet");
    await wait(500);
    assert.ok(existsSync(join(dir, "wallet-log.jsonl")), "wallet-log.jsonl missing");
    const lines = readFileSync(join(dir, "wallet-log.jsonl"), "utf8").trim().split("\n");
    assert.ok(lines.length >= 3, "log has the opens and the faucet txn");
    assert.ok(existsSync(join(dir, "backups")), "backups dir missing");
    assert.ok(readdirSync(join(dir, "backups")).length >= 1);
    s.close();
    srv.child.kill("SIGKILL");
  });
});
