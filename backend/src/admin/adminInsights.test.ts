// HTTP bodies are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import type { MatchRecord } from "../../../engine/types";
import { io as connect } from "socket.io-client";
import { createApp } from "../app";
import type { Deposit } from "../deposits";
import type { StoredMatch } from "../recorder";
import { MemoryStore } from "../store";
import { BIRR } from "../wallet";
import { MemoryTxnLog } from "../walletLog";
import type { Withdrawal } from "../withdrawals";

const TEST_TOKEN = "test-admin-token-" + "i".repeat(16);
const ADMIN = { "x-admin-token": TEST_TOKEN };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ROUTES = ["/api/admin/overview", "/api/admin/activity", "/api/admin/system"];

interface Running {
  url: string;
  close: () => void;
}

async function listen(app: ReturnType<typeof createApp>): Promise<Running> {
  await new Promise<void>((r) => app.httpServer.listen(0, r));
  return {
    url: `http://localhost:${(app.httpServer.address() as AddressInfo).port}`,
    close: () => {
      app.io.close();
      app.httpServer.close();
    },
  };
}

async function get(base: string, path: string, headers: Record<string, string> = ADMIN) {
  const res = await fetch(base + path, { headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

async function signup(base: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(base + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json: any = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  return json.profile.id;
}

function match(matchId: string, gameId: string, players: [string, string], winner: 0 | 1 | null, endedAt: number): StoredMatch {
  const rec: MatchRecord = {
    matchId,
    gameId,
    players,
    bot: players.includes("bot"),
    seed: `seed-${matchId}`,
    log: [],
    outcome: { winner, draw: winner === null, reason: winner === null ? "draw" : "win" },
    startedAt: endedAt - 60_000,
    endedAt,
  };
  return { record: rec, reveal: {}, commitments: {}, resultHash: `hash-${matchId}`, status: "recorded", commitIndex: 1, resultIndex: 2 };
}

const deposit = (id: string, profileId: string, status: Deposit["status"], createdAt: number, closedAt: number | null, amount: number | null, reviewAmount: number | null = null): Deposit => ({
  id,
  profileId,
  bank: "cbe",
  reference: `REF-${id}`,
  status,
  amount,
  reason: null,
  createdAt,
  closedAt,
  reviewAmount,
});

const withdrawal = (id: string, profileId: string, status: Withdrawal["status"], createdAt: number, closedAt: number | null, amount: number): Withdrawal => ({
  id,
  profileId,
  bank: "telebirr",
  account: "0911223344",
  amount,
  status,
  reference: null,
  closedBy: null,
  createdAt,
  closedAt,
  alertMessageId: null,
  promptMessageId: null,
});

// ---- guard ----

describe("guard", () => {
  test("401 without credentials, 404 without a token configured", async () => {
    const app = createApp({ store: new MemoryStore(), db: null, admin: { token: () => TEST_TOKEN } });
    const off = createApp({ store: new MemoryStore(), db: null, admin: { token: () => undefined } });
    const run = await listen(app);
    const runOff = await listen(off);
    try {
      for (const path of ROUTES) {
        assert.equal((await get(run.url, path, {})).status, 401, path);
        assert.equal((await get(run.url, path, { "x-admin-token": "wrong-token-wrong-token-wrong" })).status, 401, path);
        assert.equal((await get(runOff.url, path)).status, 404, path);
        assert.equal((await get(run.url, path)).status, 200, path);
      }
    } finally {
      run.close();
      runOff.close();
    }
  });
});

// ---- empty store ----

describe("overview on an empty store", () => {
  test("all zeros, a series of the right length, null changes", async () => {
    const app = createApp({ store: new MemoryStore(), db: null, admin: { token: () => TEST_TOKEN } });
    const run = await listen(app);
    try {
      const { body } = await get(run.url, "/api/admin/overview?days=7&tz=180");
      assert.equal(body.book, "play");
      assert.equal(body.range.days, 7);
      assert.equal(body.range.tz, 180);
      assert.equal(body.range.to - body.range.from, 7 * DAY);
      assert.deepEqual(body.now, { online: 0, inMatch: 0, liveMatches: 0, queued: 0, pendingWithdrawals: { count: 0, amount: 0 }, depositsInReview: { count: 0, amount: 0 }, pendingWrites: 0 });
      assert.deepEqual(body.totals, { players: 0, registered: 0, guests: 0, matches: 0, stakedMatches: 0, tournaments: 0 });
      for (const k of ["newPlayers", "activePlayers", "matches", "stakeVolume", "fees", "deposits", "withdrawals"]) assert.deepEqual(body.kpis[k], { value: 0, previous: 0, change: null }, k);
      assert.equal(body.series.length, 7);
      for (const d of body.series) {
        assert.match(d.day, /^\d{4}-\d{2}-\d{2}$/);
        assert.deepEqual(Object.values({ ...d, day: 0 }), new Array(14).fill(0));
      }
      assert.deepEqual(body.byGame, []);
      // days and tz are clamped; book is checked.
      assert.equal((await get(run.url, "/api/admin/overview?days=9999&tz=99999")).body.series.length, 180);
      assert.equal((await get(run.url, "/api/admin/overview?days=0")).body.series.length, 1);
      assert.equal((await get(run.url, "/api/admin/overview")).body.series.length, 30);
      assert.equal((await get(run.url, "/api/admin/overview?tz=99999")).body.range.tz, 840);
      assert.equal((await get(run.url, "/api/admin/overview?book=real")).body.book, "real");
      assert.deepEqual((await get(run.url, "/api/admin/activity")).body, { rows: [], total: 0 });
    } finally {
      run.close();
    }
  });
});

// ---- seeded app ----

const store = new MemoryStore();
const app = createApp({ store, db: null, wallet: { mode: "real", depositHoldMs: 0 }, admin: { token: () => TEST_TOKEN } });
let run: Running;
let alice = "";
let bob = "";
let carol = "";
let t0 = 0;

before(async () => {
  run = await listen(app);
  alice = await signup(run.url, { name: "Alice", username: "alice", password: "alice-password" });
  bob = await signup(run.url, { name: "Bob", username: "bobby", password: "bob-password" });
  carol = await signup(run.url, { name: "Carol" });
  t0 = Date.now();
  store.write("matches", {
    m1: match("m1", "gebeta", [alice, bob], 0, t0 - HOUR),
    m2: match("m2", "gebeta", [alice, "bot"], 0, t0 - 2 * HOUR),
    m3: match("m3", "tic-tac-toe", [bob, carol], null, t0 - 3 * HOUR),
    old: match("old", "gebeta", [alice, bob], 1, t0 - 9 * DAY),
  });
  // One staked, settled match: both stakes held, then the winner paid and the fee taken.
  const { wallet } = app;
  assert.ok(wallet.adjust("real", alice, 200 * BIRR, "seed money", "Boss").ok);
  assert.ok(wallet.adjust("real", bob, 200 * BIRR, "seed money", "Boss").ok);
  const held = wallet.hold([alice, bob], 50 * BIRR);
  assert.ok(held.ok);
  if (held.ok) {
    wallet.bind(held.escrow.id, "m1");
    wallet.settle(held.escrow.id, { winner: 0, draw: false });
  }
  store.write("deposits", {
    list: [
      deposit("d1", alice, "credited", t0 - 5 * HOUR, t0 - 4 * HOUR, 200 * BIRR),
      deposit("d2", bob, "review", t0 - 30 * 60_000, null, null, 30 * BIRR),
      deposit("d3", alice, "credited", t0 - 10 * DAY, t0 - 10 * DAY + HOUR, 50 * BIRR),
      deposit("d4", carol, "rejected", t0 - 6 * HOUR, t0 - 5 * HOUR - 1000, null),
    ],
    used: {},
  });
  store.write("withdrawals", [
    withdrawal("w1", alice, "paid", t0 - 3 * HOUR - 1000, t0 - 2 * HOUR - 1000, 80 * BIRR),
    withdrawal("w2", bob, "pending", t0 - 10 * 60_000, null, 60 * BIRR),
  ]);
  // Admin sign-in (a row in the feed) and a failed one (not in the feed).
  await fetch(run.url + "/api/admin/session", { method: "POST", headers: { ...ADMIN, "content-type": "application/json" }, body: JSON.stringify({ name: "Boss" }) });
  await fetch(run.url + "/api/admin/session", { method: "POST", headers: { "x-admin-token": "nope-nope-nope-nope-nope-nope", "content-type": "application/json" }, body: JSON.stringify({ name: "Intruder" }) });
});

after(() => run.close());

describe("overview with data", () => {
  test("totals, now, kpis and byGame add up", async () => {
    const { status, body } = await get(run.url, "/api/admin/overview?days=7&book=real");
    assert.equal(status, 200);
    assert.deepEqual(body.totals, { players: 3, registered: 2, guests: 1, matches: 4, stakedMatches: 1, tournaments: 0 });
    assert.deepEqual(body.now.pendingWithdrawals, { count: 1, amount: 60 * BIRR });
    assert.deepEqual(body.now.depositsInReview, { count: 1, amount: 30 * BIRR });
    assert.equal(body.now.online, 0);
    const k = body.kpis;
    assert.deepEqual(k.matches, { value: 3, previous: 1, change: 2 });
    assert.deepEqual(k.activePlayers, { value: 3, previous: 2, change: 0.5 });
    assert.deepEqual(k.newPlayers, { value: 3, previous: 0, change: null });
    assert.deepEqual(k.stakeVolume, { value: 100 * BIRR, previous: 0, change: null });
    assert.deepEqual(k.fees, { value: 10 * BIRR, previous: 0, change: null });
    assert.deepEqual(k.deposits, { value: 200 * BIRR, previous: 50 * BIRR, change: 3 });
    assert.deepEqual(k.withdrawals, { value: 80 * BIRR, previous: 0, change: null });
    assert.deepEqual(body.byGame, [
      { gameId: "gebeta", gameName: "Gebeta", matches: 2, staked: 1 },
      { gameId: "tic-tac-toe", gameName: "Tic-Tac-Toe", matches: 1, staked: 0 },
    ]);
  });

  test("series is zero-filled and sums to the kpis", async () => {
    const { body } = await get(run.url, "/api/admin/overview?days=7&book=real");
    assert.equal(body.series.length, 7);
    const sum = (key: string) => body.series.reduce((s: number, d: any) => s + d[key], 0);
    assert.equal(sum("signups"), 3);
    assert.equal(sum("matches"), 3);
    assert.equal(sum("matchesVsBot"), 1);
    assert.equal(sum("matchesVsHuman"), 2);
    assert.equal(sum("stakeVolume"), 100 * BIRR);
    assert.equal(sum("fees"), 10 * BIRR);
    assert.equal(sum("deposits"), 200 * BIRR);
    assert.equal(sum("depositCount"), 1);
    assert.equal(sum("withdrawals"), 80 * BIRR);
    assert.equal(sum("withdrawalCount"), 1);
    // Everyone signed up today, so no active player is a returning one on a day they signed up.
    for (const d of body.series) assert.equal(d.activePlayers, d.newActive + d.returningActive);
    // The 30-day view also contains the old match.
    const wide = (await get(run.url, "/api/admin/overview?days=30&book=real")).body;
    assert.equal(wide.kpis.matches.value, 4);
    assert.equal(wide.series.length, 30);
  });

  test("online counts distinct profiles with an open socket", async () => {
    const res = await fetch(run.url + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", password: "alice-password" }) });
    const { token } = (await res.json()) as { token: string };
    const sockets = [0, 1].map(() => connect(run.url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false }));
    try {
      await Promise.all(sockets.map((s) => new Promise<void>((resolve, reject) => (s.once("connect", resolve), s.once("connect_error", reject)))));
      const { body } = await get(run.url, "/api/admin/overview?days=7");
      assert.equal(body.now.online, 1, "two tabs, one player");
      assert.equal(body.now.inMatch, 0);
      assert.equal((await get(run.url, "/api/admin/system")).body.counts.sockets, 2);
    } finally {
      sockets.forEach((s) => s.disconnect());
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  test("the play book has no deposits, withdrawals or stake volume here", async () => {
    const { body } = await get(run.url, "/api/admin/overview?days=7&book=play");
    assert.equal(body.book, "play");
    assert.deepEqual(body.kpis.deposits, { value: 0, previous: 0, change: null });
    assert.deepEqual(body.kpis.stakeVolume, { value: 0, previous: 0, change: null });
  });
});

describe("activity", () => {
  const feed = async (qs = "") => (await get(run.url, `/api/admin/activity?limit=200${qs}`)).body;

  test("newest first with unique ids, every type present", async () => {
    const { rows, total } = await feed();
    assert.equal(total, rows.length);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].ts >= rows[i].ts, `order at ${i}`);
    assert.equal(new Set(rows.map((r: any) => r.id)).size, rows.length);
    const count = (type: string) => rows.filter((r: any) => r.type === type).length;
    assert.equal(count("signup"), 3);
    assert.equal(count("match"), 4);
    assert.equal(count("deposit"), 7);
    assert.equal(count("withdrawal"), 3);
    assert.equal(count("adjust"), 2);
    assert.equal(count("admin"), 1, "sign-in is kept, the failed sign-in is not");
    assert.equal(count("tournament"), 0);
    assert.equal(total, 3 + 4 + 7 + 3 + 2 + 1);
  });

  test("row shape, titles and links", async () => {
    const { rows } = await feed();
    const byId = (id: string) => rows.find((r: any) => r.id === id);
    const m1 = byId("match:m1");
    assert.equal(m1.title, "Alice beat Bob at Gebeta");
    assert.deepEqual(m1.actor, { id: alice, name: "Alice", username: "alice" });
    assert.equal(m1.amount, 50 * BIRR);
    assert.equal(m1.link, "/admin/matches?open=m1");
    assert.equal(m1.meta.staked, true);
    assert.equal(m1.meta.book, "real");
    assert.equal(byId("match:m3").title, "Bob and Carol drew at Tic-Tac-Toe");
    assert.equal(byId("match:m2").title, "Alice beat Bot at Gebeta");
    assert.equal(byId(`signup:${carol}`).title, "Carol joined");
    assert.equal(byId(`signup:${carol}`).link, `/admin/players/${carol}`);
    assert.equal(byId("deposit:d1:closed").amount, 200 * BIRR);
    assert.equal(byId("deposit:d1:closed").meta.status, "credited");
    assert.equal(byId("deposit:d2:new").amount, 30 * BIRR);
    assert.equal(byId("deposit:d1:new").link, "/admin/deposits");
    assert.match(byId("deposit:d4:closed").title, /rejected/);
    assert.equal(byId("withdrawal:w1:closed").amount, 80 * BIRR);
    assert.match(byId("withdrawal:w1:closed").title, /was paid/);
    assert.equal(byId("withdrawal:w2:new").link, "/admin/withdrawals");
    const adj = rows.filter((r: any) => r.type === "adjust");
    assert.deepEqual(adj.map((r: any) => r.amount), [200 * BIRR, 200 * BIRR]);
    assert.match(adj[0].title, /Boss credited 200.00 birr to (Alice|Bob) \(real\)/);
    const admin = rows.find((r: any) => r.type === "admin");
    assert.equal(admin.link, "/admin/audit");
    assert.equal(admin.actor.name, "Boss");
    for (const r of rows) {
      assert.deepEqual(Object.keys(r).sort(), ["actor", "amount", "id", "link", "meta", "title", "ts", "type"]);
      assert.ok(r.id.startsWith(r.type + ":"));
    }
  });

  test("type filter takes a comma list and ignores unknown names", async () => {
    const two = await feed("&type=match,withdrawal");
    assert.equal(two.total, 4 + 3);
    assert.ok(two.rows.every((r: any) => r.type === "match" || r.type === "withdrawal"));
    const one = await feed("&type=signup");
    assert.equal(one.total, 3);
    assert.equal((await feed("&type=bogus")).total, (await feed()).total, "no valid type means all");
    assert.equal((await feed("&type=bogus,admin")).total, 1);
  });

  test("paging walks the same list as one big page", async () => {
    const all = (await feed()).rows;
    const seen: any[] = [];
    for (let page = 0; page < 10; page++) {
      const { rows, total } = (await get(run.url, `/api/admin/activity?limit=5&page=${page}`)).body;
      assert.equal(total, all.length);
      assert.ok(rows.length <= 5);
      seen.push(...rows);
    }
    assert.deepEqual(
      seen.map((r) => r.id),
      all.map((r: any) => r.id),
    );
  });
});

describe("system", () => {
  test("shape on the seeded app", async () => {
    const { status, body } = await get(run.url, "/api/admin/system");
    assert.equal(status, 200);
    assert.ok(Math.abs(body.time - Date.now()) < 5000);
    assert.equal(typeof body.uptimeMs, "number");
    assert.equal(body.node, process.version);
    assert.deepEqual(body.store, { kind: "memory", pendingWrites: 0, lastError: null });
    assert.equal(body.database, "none");
    assert.equal(body.wallet.mode, "real");
    assert.equal(body.wallet.chain, "intact");
    assert.ok(body.wallet.logEntries > 0);
    assert.equal(body.wallet.config.feeBps, 1000);
    assert.equal(typeof body.ledger.blocks, "number");
    assert.equal(typeof body.ledger.pending, "number");
    assert.deepEqual(body.telegram, { configured: false, moderatorChat: false, moderators: 0 });
    assert.deepEqual(body.deposits, { enabled: false, accounts: 0 });
    assert.equal(body.withdrawals.enabled, false);
    assert.equal(body.admin.liveSessions, 1);
    assert.ok(body.admin.auditEntries >= 2);
    assert.deepEqual(body.counts, { profiles: 3, matches: 4, deposits: 4, withdrawals: 2, tournaments: 0, liveMatches: 0, sockets: 0 });
    assert.equal(body.verifyBudget.limits.daily, 20);
  });

  test("a broken chain is reported with where and why", async () => {
    class TamperedLog extends MemoryTxnLog {
      entries() {
        return super.entries().map((e, i) => (i === 1 ? { ...e, ts: e.ts + 1 } : e));
      }
    }
    const broken = createApp({ store: new MemoryStore(), db: null, wallet: { log: new TamperedLog() }, admin: { token: () => TEST_TOKEN } });
    const r = await listen(broken);
    try {
      const { chain } = (await get(r.url, "/api/admin/system")).body.wallet;
      assert.equal(chain.at, 1);
      assert.match(chain.reason, /changed/);
    } finally {
      r.close();
    }
  });

  test("no secrets, tokens, account numbers, chat ids or env values", async () => {
    const fake = {
      TELEGRAM_BOT_TOKEN: "7777777:FAKE-bot-token-AAAA",
      TELEGRAM_MODERATOR_CHAT: "-1009998887776",
      TELEGRAM_MODERATORS: "5550001112",
      DATABASE_URL: "postgres://user:FAKE-db-password@db.example.test/arena",
      VERIFY_ET_KEY: "FAKE-verify-key-12345",
      LEDGER_PRIVATE_KEY: "ab".repeat(32),
    };
    const saved = Object.fromEntries(Object.keys(fake).map((k) => [k, process.env[k]]));
    Object.assign(process.env, fake);
    const secretApp = createApp({
      store: new MemoryStore(),
      db: { query: async () => ({ rows: [] }) as never, end: async () => {} },
      wallet: { mode: "real" },
      deposits: { accounts: { cbe: "1000123456789", telebirr: "0911999888" } },
      admin: { token: () => TEST_TOKEN },
    });
    Object.entries(saved).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
    const r = await listen(secretApp);
    try {
      const { status, body, text } = await get(r.url, "/api/admin/system");
      assert.equal(status, 200);
      assert.equal(body.database, "ok");
      assert.deepEqual(body.telegram, { configured: true, moderatorChat: true, moderators: 1 });
      assert.deepEqual(body.deposits, { enabled: true, accounts: 2 });
      const all = [text, (await get(r.url, "/api/admin/overview")).text, (await get(r.url, "/api/admin/activity")).text].join("\n");
      for (const secret of [...Object.values(fake), "1000123456789", "0911999888", TEST_TOKEN, "FAKE-db-password", "privateKey", "passwordHash", "DATABASE_URL", "tokenHash"]) {
        assert.ok(!all.includes(secret), `leaked ${secret}`);
      }
    } finally {
      r.close();
    }
  });
});
