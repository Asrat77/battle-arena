// Independent end-to-end check of the Fable fix-review leftovers (R1-R6 and the near-simultaneous
// drop) against the REAL server process, with verify.et and Telegram replaced by local stub HTTP
// servers (VERIFY_ET_URL / TELEGRAM_API_URL). Nothing here imports the code under test.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { io as connect, type Socket } from "socket.io-client";

const ROOT = join(__dirname, "..", "..");
const tsx = join(ROOT, "node_modules", ".bin", "tsx");
const children: ChildProcess[] = [];
const stubs: HttpServer[] = [];
after(() => {
  children.forEach((c) => {
    c.kill("SIGKILL");
    c.stdout?.destroy();
    c.stderr?.destroy();
  });
  stubs.forEach((s) => s.close());
});

let nextPort = 5200 + Math.floor(Math.random() * 300);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean | Promise<boolean>, ms = 8000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await f()) return true;
    await wait(100);
  }
  return false;
};

// ---------------------------------------------------------------- stubs

type Receipt = (now: number) => Record<string, unknown>;

/** A fake verify.et: POST /api/verify answers from `receipts` by reference; counts every call. */
async function verifyStub() {
  const receipts = new Map<string, Receipt>();
  const calls: string[] = [];
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const ref = String(body.transactionNumber ?? body.reference ?? "");
      calls.push(ref);
      const make = receipts.get(ref);
      res.setHeader("content-type", "application/json");
      if (!make) return void res.end(JSON.stringify({ verification: { verified: false, processingStatus: "completed" }, data: [], message: "transaction not found" }));
      const item = { verified: true, currency: "ETB", status: "success", receiverName: "SWAFRI", settlementAccountMatch: { matched: true }, ...make(Date.now()) };
      res.end(JSON.stringify({ verification: { verified: true, processingStatus: "completed" }, data: [item] }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  stubs.push(srv);
  return { url: `http://127.0.0.1:${(srv.address() as any).port}`, receipts, calls };
}

/** A fake Telegram Bot API: records sendMessage / editMessageText, serves queued getUpdates. */
async function telegramStub() {
  const sent: { method: string; params: any }[] = [];
  const queue: any[] = [];
  let updateId = 1;
  let messageId = 100;
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      const method = String(req.url).split("/").pop()!;
      const params = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      if (method === "getUpdates") {
        await wait(150);
        const out = queue.splice(0, queue.length);
        return void res.end(JSON.stringify({ ok: true, result: out }));
      }
      sent.push({ method, params });
      res.end(JSON.stringify({ ok: true, result: { message_id: messageId++ } }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  stubs.push(srv);
  const tap = (data: string, from = 7) => queue.push({ update_id: updateId++, callback_query: { id: "cb" + updateId, data, from: { id: from, username: "mod" + from }, message: { chat: { id: -42 } } } });
  const texts = (method = "sendMessage") => sent.filter((m) => m.method === method).map((m) => String(m.params.text));
  return { url: `http://127.0.0.1:${(srv.address() as any).port}`, sent, tap, texts };
}

// ------------------------------------------------------------- server

interface Server {
  child: ChildProcess;
  url: string;
  out: () => string;
}

async function start(env: Record<string, string> = {}): Promise<Server> {
  const port = nextPort++;
  const dir = mkdtempSync(join(tmpdir(), "audit-left-"));
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
      if ((await fetch(url + "/health")).ok) return { child, url, out: () => log };
    } catch {
      /* not up yet */
    }
    await wait(150);
  }
  throw new Error("server never came up:\n" + log);
}

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const PASSWORD = "correct-horse-9";
let n = 0;

async function signup(url: string, name: string, withPassword = false): Promise<{ id: string; token: string }> {
  const res = await fetch(url + "/api/signup", json({ name }));
  const body: any = await res.json();
  if (withPassword) {
    const r = await fetch(url + "/api/me/credentials", { ...json({ username: `user${Date.now() % 1e6}x${n++}`, password: PASSWORD }), headers: { "content-type": "application/json", authorization: `Bearer ${body.token}` } });
    assert.equal(r.status, 200, await r.text());
  }
  return { id: body.profile.id, token: body.token };
}

const sock = (url: string, token: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const s = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
const call = (s: Socket, event: string, msg?: unknown): Promise<any> => new Promise((r) => s.timeout(15000).emit(event, msg, (err: unknown, res: any) => r(err ? { timeout: true } : res)));
const wallet = async (url: string, token: string) => (await (await fetch(url + "/api/wallet", { headers: { authorization: `Bearer ${token}` } })).json()) as any;
const balance = async (url: string, token: string) => (await wallet(url, token)).balance as number;

// ------------------------------------------------------------ R1 + simultaneous drops

const BIRR = 100;
describe("R1 (#109), near-simultaneous drops (#110, #112): real server, real 30 s clocks", () => {
  test("first to leave forfeits when the other drops later; ms-apart drops (either order) are a draw; a returner still wins", async () => {
    const srv = await start();
    const STAKE = 100 * BIRR;
    const pairs: Record<string, { a: any; b: any; sa: Socket; sb: Socket }> = {};
    for (const k of ["late", "simAB", "simBA", "ret"]) {
      const a = await signup(srv.url, k + "A");
      const b = await signup(srv.url, k + "B");
      const sa = await sock(srv.url, a.token);
      const sb = await sock(srv.url, b.token);
      for (const s of [sa, sb]) assert.equal((await call(s, "wallet:faucet")).ok, true);
      let started = 0;
      for (const s of [sa, sb]) s.on("match:start", () => started++);
      const room = await call(sa, "room:create", { gameId: "dots-and-boxes", stake: STAKE });
      assert.equal(room.ok, true, JSON.stringify(room));
      assert.equal((await call(sb, "room:join", { code: room.room.code })).ok, true);
      await call(sa, "room:ready", { ready: true });
      await call(sb, "room:ready", { ready: true });
      assert.ok(await until(() => started >= 2, 10000), k + ": match never started");
      assert.equal(await balance(srv.url, a.token), 50000 - STAKE, k + ": stake not held");
      pairs[k] = { a, b, sa, sb };
    }
    const t0 = Date.now();
    // late: B (joiner) leaves first, A drops 10 s later. B's clock runs out first: B forfeits, A is paid (R1 / #109).
    pairs.late.sb.close();
    // simAB / simBA: both drop 100 ms apart, in both orders (#110 / #112).
    pairs.simAB.sa.close();
    await wait(100);
    pairs.simAB.sb.close();
    pairs.simBA.sb.close();
    await wait(100);
    pairs.simBA.sa.close();
    // ret: both drop 100 ms apart, then A returns at ~10 s; B stays away and must still forfeit.
    pairs.ret.sb.close();
    await wait(100);
    pairs.ret.sa.close();
    await wait(Math.max(0, 10_000 - (Date.now() - t0)));
    pairs.late.sa.close();
    pairs.ret.sa = await sock(srv.url, pairs.ret.a.token);

    const winner = 50000 - STAKE + 2 * STAKE - (2 * STAKE) / 10; // prize less 10% fee
    const settled = async (k: string) => {
      const p = pairs[k];
      const [x, y] = [await balance(srv.url, p.a.token), await balance(srv.url, p.b.token)];
      return x !== 50000 - STAKE || y !== 50000 - STAKE;
    };
    for (const k of Object.keys(pairs)) assert.ok(await until(() => settled(k), 70_000), `${k}: never settled\n${srv.out().slice(-1500)}`);
    const bal = async (k: string) => [await balance(srv.url, pairs[k].a.token), await balance(srv.url, pairs[k].b.token)];
    assert.deepEqual(await bal("late"), [winner, 50000 - STAKE], "late: first to leave (B) must forfeit; A must be paid, not refunded");
    assert.deepEqual(await bal("simAB"), [50000, 50000], "simAB: ms-apart drops must be a draw (both refunded)");
    assert.deepEqual(await bal("simBA"), [50000, 50000], "simBA: ms-apart drops must be a draw (both refunded)");
    assert.deepEqual(await bal("ret"), [winner, 50000 - STAKE], "ret: A came back inside the window, B stayed away: B forfeits");
    // The money is conserved: no unexpected fee on a draw.
    Object.values(pairs).forEach((p) => [p.sa, p.sb].forEach((s) => s.close()));
  });
});

// ---------------------------------------------------------------- real-mode servers

const realEnv = (v: Awaited<ReturnType<typeof verifyStub>>, t: Awaited<ReturnType<typeof telegramStub>>, extra: Record<string, string> = {}) => ({
  WALLET_MODE: "real",
  REAL_MONEY_LEGAL_OK: "1",
  VERIFY_ET_KEY: "stub-key",
  VERIFY_ET_URL: v.url,
  DEPOSIT_TELEBIRR: "0911000000",
  TELEGRAM_BOT_TOKEN: "stub-token",
  TELEGRAM_API_URL: t.url,
  TELEGRAM_MODERATOR_CHAT: "-42",
  TELEGRAM_MODERATORS: "7",
  ADMIN_TOKEN: "a".repeat(32),
  ...extra,
});
const deposit = (s: Socket, reference: string, payerName: string) => call(s, "wallet:deposit", { bank: "telebirr", reference, payerName });
const eatNow = (offsetMs = 0) => new Date(Date.now() + offsetMs + 3 * 3600_000).toISOString().slice(0, 19).replace("T", " ");

describe("R2 / R4 / R6: deposits and withdrawals against stub verify.et + Telegram", () => {
  test("R2: a reference alone can't claim a deposit; the player never sees the sender; Reject frees it for the real payer only", async () => {
    const v = await verifyStub();
    const t = await telegramStub();
    const srv = await start(realEnv(v, t, { DEPOSIT_HOLD_HOURS: "0" }));
    v.receipts.set("CH12R2REF1", (now) => ({ amount: 300, senderName: "ABEBE BIKILA KEBEDE", transactionDate: new Date(now - 60_000).toISOString() }));
    const thief = await signup(srv.url, "Thief", true);
    const owner = await signup(srv.url, "Owner", true);
    const st = await sock(srv.url, thief.token);
    const so = await sock(srv.url, owner.token);
    const seen: string[] = [];
    st.on("wallet:deposit", (d) => seen.push(JSON.stringify(d)));

    const r = await deposit(st, "CH12R2REF1", "Kebede Alemu");
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.deposit.status, "review");
    assert.doesNotMatch(JSON.stringify(r) + seen.join(""), /ABEBE|BIKILA/i, "receipt sender leaked to the player");
    assert.ok(await until(() => t.texts().length > 0, 5000), "no Telegram alert");
    const alert = t.texts().join("\n");
    assert.match(alert, /ABEBE BIKILA KEBEDE/, "moderators should see the receipt sender");
    assert.match(alert, /Reject frees the reference/);
    const w = await wallet(srv.url, thief.token);
    assert.deepEqual(w.depositPayer, { name: "Kebede Alemu", locked: true }, "payer name should be locked once in review");
    // Player can't just retype the name: still locked.
    const again0 = await deposit(st, "CH12R2REF1", "Abebe Bikila Kebede");
    assert.equal(again0.ok, false, "re-claim while in review must not work");

    t.tap(`dep-no:${r.deposit.id}`);
    assert.ok(await until(() => t.texts("editMessageText").some((x) => /freed for others \(not this player\)/.test(x)), 8000), "Reject not applied");
    const retry = await deposit(st, "CH12R2REF1", "Abebe Bikila Kebede");
    assert.equal(retry.ok, false, "rejected thief must not claim the ref again: " + JSON.stringify(retry));
    assert.equal(await balance(srv.url, thief.token), 0);
    const real = await deposit(so, "CH12R2REF1", "Abebe Bikila");
    assert.equal(real.ok && real.deposit.status, "credited", JSON.stringify(real));
    assert.equal(await balance(srv.url, owner.token), 300 * BIRR);
    [st, so].forEach((s) => s.close());
  });

  test("R4: named transfer date beats `timestamp`; no date -> review; zone-less dates are Addis time", async () => {
    const v = await verifyStub();
    const t = await telegramStub();
    const srv = await start(realEnv(v, t, { DEPOSIT_HOLD_HOURS: "0" }));
    const fresh = (now: number) => new Date(now).toISOString();
    // (a) `timestamp` looks fresh (check time) but the explicit transfer date is 3 days old.
    v.receipts.set("CH12R4OLD1", (now) => ({ amount: 100, senderName: "ABEBE BIKILA", timestamp: fresh(now), transactionDate: new Date(now - 3 * 86400_000).toISOString() }));
    // (b) no date field at all.
    v.receipts.set("CH12R4NONE", () => ({ amount: 100, senderName: "ABEBE BIKILA" }));
    // (c) bank-local zone-less date one minute ago (UTC+3 wall clock): must be read as EAT, not UTC.
    v.receipts.set("CH12R4EAT1", () => ({ amount: 100, senderName: "ABEBE BIKILA", transactionDate: eatNow(-60_000) }));
    // (d) the same wall clock read as UTC would be 3 h in the future: must still credit. And one a day+ old in EAT must not.
    v.receipts.set("CH12R4EAT2", () => ({ amount: 100, senderName: "ABEBE BIKILA", transactionDate: eatNow(-30 * 3600_000) }));
    const out: Record<string, any> = {};
    for (const ref of ["CH12R4OLD1", "CH12R4NONE", "CH12R4EAT1", "CH12R4EAT2"]) {
      const p = await signup(srv.url, "P" + ref, true);
      const s = await sock(srv.url, p.token);
      const r = await deposit(s, ref, "Abebe Bikila");
      out[ref] = { r, bal: await balance(srv.url, p.token) };
      s.close();
    }
    assert.notEqual(out.CH12R4OLD1.r.deposit?.status, "credited", "old transferDate must not credit: " + JSON.stringify(out.CH12R4OLD1));
    assert.equal(out.CH12R4OLD1.bal, 0);
    assert.equal(out.CH12R4NONE.r.deposit?.status, "review", "missing date must go to review: " + JSON.stringify(out.CH12R4NONE));
    assert.equal(out.CH12R4NONE.bal, 0);
    assert.equal(out.CH12R4EAT1.r.deposit?.status, "credited", "zone-less EAT date 1 min ago should credit: " + JSON.stringify(out.CH12R4EAT1));
    assert.equal(out.CH12R4EAT1.bal, 100 * BIRR);
    assert.equal(out.CH12R4EAT2.bal, 0, "30 h old (EAT) must not credit");
    assert.match(srv.out(), /receipt dates/, "raw receipt date fields should be logged");
  });

  test("R6: Reject after Paid with no payout number needs the confirm step; only the confirm refunds", async () => {
    const v = await verifyStub();
    const t = await telegramStub();
    const srv = await start(realEnv(v, t, { DEPOSIT_HOLD_HOURS: "0" }));
    v.receipts.set("CH12R6DEP1", (now) => ({ amount: 500, senderName: "ABEBE BIKILA", transactionDate: new Date(now - 60_000).toISOString() }));
    const p = await signup(srv.url, "Payee", true);
    const s = await sock(srv.url, p.token);
    const dep = await deposit(s, "CH12R6DEP1", "Abebe Bikila");
    assert.equal(dep.deposit?.status, "credited", JSON.stringify(dep));
    const w = await call(s, "wallet:withdraw", { bank: "telebirr", account: "0922334455", amount: 100 * BIRR, password: PASSWORD });
    assert.equal(w.ok, true, JSON.stringify(w));
    const id = w.withdrawal.id;
    assert.equal(await balance(srv.url, p.token), 400 * BIRR);
    assert.ok(await until(() => t.sent.some((m) => JSON.stringify(m.params).includes(`paid:${id}`)), 5000), "no withdrawal alert with a Paid button");

    t.tap(`paid:${id}`);
    assert.ok(await until(() => t.texts().some((x) => /Reply to this message with the/.test(x)), 8000), "Paid not handled");
    t.tap(`reject:${id}`);
    assert.ok(await until(() => t.texts().some((x) => /Reject only if NO money was sent/.test(x)), 8000), "Reject after Paid (no number) did not ask for confirmation:\n" + JSON.stringify(t.texts()));
    await wait(500);
    assert.equal(await balance(srv.url, p.token), 400 * BIRR, "a single Reject tap refunded the player");
    t.tap(`reject!:${id}`);
    assert.ok(await until(async () => (await balance(srv.url, p.token)) === 500 * BIRR, 8000), "confirmed reject should refund");
    // Control: a plain Reject (nobody tapped Paid) still refunds at once, so the confirm step is not just a broken button.
    const w2 = await call(s, "wallet:withdraw", { bank: "telebirr", account: "0922334455", amount: 100 * BIRR, password: PASSWORD });
    assert.equal(w2.ok, true, JSON.stringify(w2));
    t.tap(`reject:${w2.withdrawal.id}`);
    assert.ok(await until(async () => (await balance(srv.url, p.token)) === 500 * BIRR, 8000), "plain Reject (no Paid) should refund at once");
    s.close();
  });
});

describe("R3: shared verify.et budget", () => {
  test("deposits pause when the day's budget is spent; one moderator alert; stub is not called past the budget", async () => {
    const v = await verifyStub();
    const t = await telegramStub();
    const srv = await start(realEnv(v, t, { VERIFY_DAILY_BUDGET: "3", VERIFY_MONTHLY_BUDGET: "100" }));
    const replies: any[] = [];
    // 6 attempts by 6 different players (so per-account / per-IP limits aren't what stops them).
    for (let i = 0; i < 6; i++) {
      const p = await signup(srv.url, "Q" + i, true);
      const s = await sock(srv.url, p.token);
      replies.push(await deposit(s, `CH12R3REF${i}`, "Abebe Bikila"));
      s.close();
    }
    assert.ok(v.calls.length <= 3, `verify.et was called ${v.calls.length} times with a budget of 3`);
    assert.ok(v.calls.length >= 3, "budget should still allow 3 checks");
    const paused = replies.slice(3);
    for (const r of paused) assert.match(JSON.stringify(r), /pause|later|busy/i, "expected a paused reply, got " + JSON.stringify(r));
    await wait(500);
    const alerts = t.texts().filter((x) => /budget|paused/i.test(x));
    assert.equal(alerts.length, 1, "exactly one moderator alert expected, got: " + JSON.stringify(t.texts()));
  });
});

describe("R5: the deposit hold follows the money", () => {
  test("a player who wins a stake paid from the loser's held deposit gets a held amount, not free money", async () => {
    const v = await verifyStub();
    const t = await telegramStub();
    const srv = await start(realEnv(v, t, { STAKE_MIN_ACCOUNT_AGE_HOURS: "0" })); // default 24 h hold
    v.receipts.set("CH12R5DEP1", (now) => ({ amount: 200, senderName: "BERHANE ASFAW", transactionDate: new Date(now - 60_000).toISOString() }));
    const a = await signup(srv.url, "Winner", true); // funded freely by an admin adjust
    const b = await signup(srv.url, "Dumper", true); // funds are a fresh (held) deposit
    const adj = await fetch(srv.url + "/api/admin/wallet/adjust", { ...json({ book: "real", profileId: a.id, amount: 300 * BIRR, reason: "test funding", by: "test" }), headers: { "content-type": "application/json", "x-admin-token": "a".repeat(32) } });
    assert.equal(adj.status, 200, await adj.text());
    const sa = await sock(srv.url, a.token);
    const sb = await sock(srv.url, b.token);
    const dep = await deposit(sb, "CH12R5DEP1", "Berhane Asfaw");
    assert.equal(dep.deposit?.status, "credited", JSON.stringify(dep));
    assert.equal((await wallet(srv.url, b.token)).withdrawals.held, 200 * BIRR, "fresh deposit should be held");
    assert.equal((await wallet(srv.url, a.token)).withdrawals.held, 0);
    let started = 0;
    for (const s of [sa, sb]) s.on("match:start", () => started++);
    const room = await call(sa, "room:create", { gameId: "dots-and-boxes", stake: 100 * BIRR });
    assert.equal(room.ok, true, JSON.stringify(room));
    assert.equal((await call(sb, "room:join", { code: room.room.code })).ok, true);
    await call(sa, "room:ready", { ready: true });
    await call(sb, "room:ready", { ready: true });
    assert.ok(await until(() => started >= 2, 10000), "match never started");
    // B loses on purpose by leaving.
    const live: any = await (await fetch(srv.url + "/api/live")).json();
    const id = JSON.stringify(live).match(/"(?:matchId|id)":"([^"]+)"/)?.[1];
    assert.ok(id, "couldn't find the live match: " + JSON.stringify(live).slice(0, 300));
    assert.equal((await call(sb, "match:leave", { matchId: id })).ok, true);
    assert.ok(await until(async () => (await balance(srv.url, a.token)) > 300 * BIRR, 10000), "winner never paid");
    const after = await wallet(srv.url, a.token);
    assert.ok(after.withdrawals.held > 0, "winnings from the dumper's held deposit are not held: " + JSON.stringify(after.withdrawals));
    assert.ok(after.withdrawals.held <= 100 * BIRR, "held more than the loser's stake: " + after.withdrawals.held);
    assert.equal((await wallet(srv.url, b.token)).withdrawals.held, 100 * BIRR, "the loser keeps the hold only on what they still have");
    [sa, sb].forEach((s) => s.close());
  });
});
