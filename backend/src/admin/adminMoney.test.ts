// HTTP bodies are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createApp } from "../app";
import type { VerifyEt, VerifyResult } from "../deposits";
import { moderatorList } from "../moderators";
import { MemoryStore } from "../store";
import { BIRR, LEGACY_REPORT } from "../wallet";
import { FileTxnLog } from "../walletLog";
import { LogCache } from "./adminLedger";

const TEST_TOKEN = "test-admin-token-" + "m".repeat(16);
const ADMIN = { "x-admin-token": TEST_TOKEN };
const CHAT = "-42";

/** Every response body seen, to check that no secret ever leaves. */
const seen: string[] = [];

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

async function call(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = ADMIN) {
  const res = await fetch(base + path, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  seen.push(text);
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

// ---- the main app: real money, fake verify.et and Telegram ----

const answers: Record<string, VerifyResult> = {};
/** Money time: wallet, deposits and withdrawals; moved on between steps so "newest first" is certain. */
let now = Date.now();
const tick = () => (now += 1000);
const verified = (birr: number, senderName: string): VerifyResult => ({
  state: "verified",
  amount: birr * BIRR,
  currency: "ETB",
  senderName,
  paidAt: Date.now() - 60_000,
  toUs: true,
});
const verifyEt: VerifyEt = {
  verify: async ({ reference }) => answers[reference] ?? { state: "failed", reason: "transaction not found" },
  status: async () => ({ state: "failed", reason: "x" }),
};
const telegramCalls: { method: string; params: Record<string, unknown> }[] = [];
let telegramFails = false;
let nextMessage = 100;
const moderatorCall = async (method: string, params: Record<string, unknown>) => {
  telegramCalls.push({ method, params });
  if (telegramFails && method === "editMessageText") throw new Error("telegram down");
  return { message_id: nextMessage++ };
};

const store = new MemoryStore();
store.write(LEGACY_REPORT, { migratedAt: 1, profiles: { x: { deposited: 100, withdrawn: 0, refunded: 0, balance: 100 } } });
const app = createApp({
  store,
  db: null,
  wallet: { mode: "real", depositHoldMs: 0, now: () => now },
  deposits: {
    now: () => now,
    verifyEt,
    accounts: { telebirr: "0911000000" },
    sleep: async () => {},
    limits: { perAccount: 100, perIp: 100 },
    moderators: { chatId: CHAT, allowed: moderatorList("7", CHAT), call: moderatorCall },
  },
  withdrawals: { telegram: { call: moderatorCall }, moderatorChat: CHAT, moderators: moderatorList("7", CHAT), now: () => now },
  admin: { token: () => TEST_TOKEN },
});
let main: Running;
let url = "";

async function signup(body: Record<string, unknown>): Promise<{ id: string; token: string }> {
  const res = await fetch(url + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json: any = await res.json();
  assert.equal(res.status, 201, JSON.stringify(json));
  return { id: json.profile.id, token: json.token };
}

const get = (path: string, headers: Record<string, string> = ADMIN) => call(url, "GET", path, undefined, headers);
const post = (path: string, body: unknown, headers: Record<string, string> = ADMIN) => call(url, "POST", path, body, headers);

let alice: { id: string };
let bob: { id: string };
let dave: { id: string };
let credited = "";
let bobReview = "";
let daveReview = "";
let settledEscrow = "";
let heldEscrow = "";
let withdrawalId = "";

before(async () => {
  main = await listen(app);
  url = main.url;
  alice = await signup({ name: "Alice Abebe", username: "alice", password: "alice-password" });
  bob = await signup({ name: "Bob Builder", username: "bobby", password: "bob-password" });
  dave = await signup({ name: "Dave Dawit", username: "dave", password: "dave-password" });

  // A deposit credited at once (sender matches the payer name).
  answers.CH12GOOD001 = verified(300, "ALICE ABEBE KEBEDE");
  const a = await app.deposits.submit(alice.id, "telebirr", "CH12GOOD001", "Alice Abebe");
  assert.ok(a.ok && a.deposit.status === "credited", JSON.stringify(a));
  credited = a.deposit.id;

  // Two in review: the receipt's sender isn't the name they pay from.
  tick();
  answers.CH12REVIEW1 = verified(200, "SOMEONE ELSE");
  const b = await app.deposits.submit(bob.id, "telebirr", "CH12REVIEW1", "Bob Builder");
  assert.ok(b.ok && b.deposit.status === "review", JSON.stringify(b));
  bobReview = b.deposit.id;
  tick();
  answers.CH12REVIEW2 = verified(150, "ANOTHER PERSON");
  const d = await app.deposits.submit(dave.id, "telebirr", "CH12REVIEW2", "Dave Dawit");
  assert.ok(d.ok && d.deposit.status === "review", JSON.stringify(d));
  daveReview = d.deposit.id;

  // An adjustment, a staked match held then settled (fee to the platform), one still held.
  const w = app.wallet;
  tick();
  assert.ok(w.adjust("real", bob.id, 100 * BIRR, "test funding", "test").ok);
  tick();
  const one = w.hold([alice.id, bob.id], 50 * BIRR);
  assert.ok(one.ok);
  settledEscrow = one.escrow.id;
  w.bind(settledEscrow, "match-settled");
  w.settle(settledEscrow, { winner: 0, draw: false });
  tick();
  const two = w.hold([alice.id, bob.id], 10 * BIRR);
  assert.ok(two.ok);
  heldEscrow = two.escrow.id;

  tick();
  // A pending withdrawal (alerted on Telegram).
  const wd = await app.withdrawals.request(alice.id, { bank: "telebirr", account: "0911223344", amount: 100 * BIRR, password: "alice-password" });
  assert.ok(wd.ok, JSON.stringify(wd));
  withdrawalId = wd.withdrawal.id;
  assert.ok(app.withdrawals.get(withdrawalId)!.alertMessageId);
});

after(() => main.close());

describe("guard", () => {
  test("every new money route answers 401 without an admin token or session", async () => {
    const paths = ["/api/admin/wallet/summary", "/api/admin/wallet/transactions", "/api/admin/wallet/escrows", "/api/admin/deposits", "/api/admin/withdrawals"];
    for (const p of paths) {
      assert.equal((await get(p, {})).status, 401, p);
      assert.equal((await get(p, { "x-admin-session": "nope" })).status, 401, p);
    }
    const r = await post(`/api/admin/deposits/${bobReview}/resolve`, { approve: true, reason: "looks fine to me" }, {});
    assert.equal(r.status, 401);
    assert.equal(app.deposits.get(bobReview)!.status, "review", "nothing changed");
  });
});

describe("GET /wallet/summary", () => {
  test("adds up a known sequence in the real book", async () => {
    const { status, body } = await get("/api/admin/wallet/summary?book=real");
    assert.equal(status, 200);
    // alice: +300 deposit, -50 hold, +90 prize, -10 hold, -100 withdrawal = 230. bob: +100 adjust, -50, -10 = 40.
    assert.equal(body.book, "real");
    assert.equal(body.mode, "real");
    assert.equal(body.playerBalances, 270 * BIRR);
    assert.equal(body.platformBalance, 10 * BIRR);
    assert.equal(body.heldInEscrow, 20 * BIRR);
    assert.equal(body.heldEscrows, 1);
    assert.deepEqual(body.deposits, { count: 1, amount: 300 * BIRR });
    assert.deepEqual(body.withdrawals, { paid: { count: 0, amount: 0 }, pending: { count: 1, amount: 100 * BIRR } });
    assert.deepEqual(body.depositsInReview, { count: 2, amount: 350 * BIRR });
    assert.deepEqual(body.adjustments, { count: 1, net: 100 * BIRR });
    assert.equal(body.legacyReport.profiles.x.balance, 100);
    // Money in minus money out is what players, the platform and escrow hold.
    assert.equal(300 * BIRR + 100 * BIRR - 100 * BIRR, body.playerBalances + body.platformBalance + body.heldInEscrow);
    assert.equal(body.config.mode, "real");
    assert.equal(body.config.feeBps, 1000);
    assert.equal(body.config.depositHoldMs, 0);
    assert.equal(body.config.minDeposit, 10 * BIRR);
    assert.equal(body.config.depositsEnabled, true);
    assert.deepEqual(body.config.withdrawals, { enabled: true, minAmount: 50 * BIRR, perRequest: 2000 * BIRR, perDay: 5000 * BIRR, secondApprovalAbove: 1000 * BIRR });
  });

  test("the play book shows zeros for deposits and withdrawals; the default book is the wallet mode", async () => {
    const { body } = await get("/api/admin/wallet/summary?book=play");
    assert.equal(body.book, "play");
    assert.equal(body.playerBalances, 0);
    assert.deepEqual(body.deposits, { count: 0, amount: 0 });
    assert.deepEqual(body.withdrawals, { paid: { count: 0, amount: 0 }, pending: { count: 0, amount: 0 } });
    assert.deepEqual(body.depositsInReview, { count: 0, amount: 0 });
    assert.deepEqual(body.adjustments, { count: 0, net: 0 });
    assert.equal((await get("/api/admin/wallet/summary")).body.book, "real");
  });
});

describe("GET /wallet/transactions", () => {
  test("from the log, newest first, with names", async () => {
    const { body } = await get("/api/admin/wallet/transactions?book=real");
    assert.equal(body.source, "log");
    // deposit, adjust, 2 holds, win, fee, 2 holds, withdrawal
    assert.equal(body.total, 9);
    const seqs = body.rows.map((r: any) => r.seq);
    assert.deepEqual(seqs, [...seqs].sort((a: number, b: number) => b - a));
    assert.equal(body.rows[0].kind, "withdrawal");
    assert.equal(body.rows.at(-1).kind, "deposit");
    const dep = body.rows.at(-1);
    assert.deepEqual(Object.keys(dep).sort(), ["amount", "balance", "book", "by", "id", "kind", "name", "note", "profileId", "ref", "seq", "ts", "username"]);
    assert.equal(dep.name, "Alice Abebe");
    assert.equal(dep.username, "alice");
    assert.equal(dep.ref, credited);
    const adj = body.rows.find((r: any) => r.kind === "adjust");
    assert.equal(adj.note, "test funding");
    assert.equal(adj.by, "test");
  });

  test("filters: kind list, profileId (platform too), from/to, q, paging", async () => {
    const kinds = await get("/api/admin/wallet/transactions?book=real&kind=deposit,withdrawal");
    assert.deepEqual(kinds.body.rows.map((r: any) => r.kind), ["withdrawal", "deposit"]);
    const fee = await get("/api/admin/wallet/transactions?book=real&profileId=platform");
    assert.equal(fee.body.total, 1);
    assert.equal(fee.body.rows[0].kind, "fee");
    assert.equal(fee.body.rows[0].name, "Platform");
    const bobs = await get(`/api/admin/wallet/transactions?book=real&profileId=${bob.id}`);
    assert.deepEqual(bobs.body.rows.map((r: any) => r.kind), ["hold", "hold", "adjust"]);
    const byName = await get("/api/admin/wallet/transactions?book=real&q=@bobby");
    assert.equal(byName.body.total, 3);
    const byRef = await get(`/api/admin/wallet/transactions?book=real&q=${settledEscrow.slice(0, 8)}`);
    assert.deepEqual(byRef.body.rows.map((r: any) => r.kind).sort(), ["fee", "hold", "hold", "win"]);
    const all = (await get("/api/admin/wallet/transactions?book=real")).body.rows;
    const byId = await get(`/api/admin/wallet/transactions?book=real&q=${all[3].id}`);
    assert.ok(byId.body.rows.some((r: any) => r.id === all[3].id));
    const ts = all[0].ts;
    assert.equal((await get(`/api/admin/wallet/transactions?book=real&from=${ts + 1}`)).body.total, 0);
    assert.equal((await get(`/api/admin/wallet/transactions?book=real&to=${ts}`)).body.total, 9);
    assert.equal((await get(`/api/admin/wallet/transactions?book=real&from=0&to=${all.at(-1).ts - 1}`)).body.total, 0);
    const p1 = await get("/api/admin/wallet/transactions?book=real&limit=4&page=1");
    assert.equal(p1.body.total, 9);
    assert.deepEqual(p1.body.rows.map((r: any) => r.seq), all.slice(4, 8).map((r: any) => r.seq));
  });

  test("falls back to the stored transactions when the log has none for the book", async () => {
    const old = new MemoryStore();
    old.write("wallet:play", {
      balances: { someone: 700 },
      txns: [
        { id: "t1", profileId: "someone", kind: "faucet", amount: 500, balance: 500, ref: null, ts: 10 },
        { id: "t2", profileId: "someone", kind: "adjust", amount: 200, balance: 700, ref: null, ts: 20, note: "old fix", by: "admin" },
      ],
      escrows: {},
      lastFaucet: {},
    });
    let t = 1_000_000;
    const bare = createApp({ store: old, db: null, admin: { token: () => TEST_TOKEN, now: () => t } });
    const run = await listen(bare);
    try {
      const { body } = await call(run.url, "GET", "/api/admin/wallet/transactions?book=play");
      assert.equal(body.source, "store");
      assert.deepEqual(body.rows.map((r: any) => [r.id, r.seq]), [["t2", null], ["t1", null]]);
      assert.equal(body.rows[0].note, "old fix");
      const k = await call(run.url, "GET", "/api/admin/wallet/transactions?book=play&kind=faucet");
      assert.deepEqual(k.body.rows.map((r: any) => r.id), ["t1"]);
      // Once the log has one, it is the source (after the 5 s cache).
      bare.wallet.adjust("play", "0x" + "1".repeat(40), 5, "new fix", "test");
      t += 5_000;
      const next = await call(run.url, "GET", "/api/admin/wallet/transactions?book=play");
      assert.equal(next.body.source, "log");
      assert.equal(next.body.total, 1);
    } finally {
      run.close();
    }
  });
});

describe("cached log reader", () => {
  test("the wallet's log accessor returns a copy of every entry (memory log)", () => {
    const entries = app.wallet.logEntries();
    assert.equal(entries.filter((e) => e.type === "open").length, 2);
    assert.equal(entries.filter((e) => e.type === "txn" && e.book === "real").length, 9);
    entries.length = 0;
    assert.ok(app.wallet.logEntries().length > 0);
  });

  test("LogCache reads at most once per 5 s", () => {
    let t = 1000;
    let reads = 0;
    const cache = new LogCache(() => (reads++, []), () => t);
    cache.entries();
    cache.entries();
    t += 4_999;
    cache.entries();
    assert.equal(reads, 1);
    t += 1;
    cache.entries();
    assert.equal(reads, 2);
  });

  test("a file log is re-read at most every 5 s by the admin routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "admin-money-"));
    let t = 5_000_000;
    const fileApp = createApp({ store: new MemoryStore(), db: null, wallet: { log: new FileTxnLog(join(dir, "log.jsonl")) }, admin: { token: () => TEST_TOKEN, now: () => t } });
    const run = await listen(fileApp);
    const who = "0x" + "2".repeat(40);
    const count = async () => (await call(run.url, "GET", "/api/admin/wallet/transactions?book=play")).body;
    try {
      fileApp.wallet.adjust("play", who, 100, "first", "test");
      assert.equal((await count()).total, 1);
      fileApp.wallet.adjust("play", who, 100, "second", "test");
      t += 4_999;
      assert.equal((await count()).total, 1, "cached");
      t += 1;
      const fresh = await count();
      assert.equal(fresh.total, 2);
      assert.equal(fresh.source, "log");
      assert.equal(fresh.rows[0].note, "second");
    } finally {
      run.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GET /wallet/escrows", () => {
  test("newest first with names, pot, prize, fee and match id; status filter", async () => {
    const { body } = await get("/api/admin/wallet/escrows?book=real");
    assert.equal(body.total, 2);
    const [held, settled] = body.rows;
    assert.equal(held.id, heldEscrow);
    assert.equal(held.status, "held");
    assert.equal(held.matchId, null);
    assert.equal(held.pot, 20 * BIRR);
    assert.equal(held.fee, 2 * BIRR);
    assert.equal(held.prize, 18 * BIRR);
    assert.equal(settled.id, settledEscrow);
    assert.equal(settled.matchId, "match-settled");
    assert.equal(settled.winner, 0);
    assert.equal(settled.book, "real");
    assert.deepEqual(settled.players, [
      { id: alice.id, name: "Alice Abebe", username: "alice" },
      { id: bob.id, name: "Bob Builder", username: "bobby" },
    ]);
    assert.equal(settled.prize, 90 * BIRR);
    assert.equal(settled.fee, 10 * BIRR);
    const only = await get("/api/admin/wallet/escrows?book=real&status=settled");
    assert.deepEqual(only.body.rows.map((r: any) => r.id), [settledEscrow]);
    assert.equal((await get("/api/admin/wallet/escrows?book=play")).body.total, 0);
  });
});

describe("GET /deposits", () => {
  test("review first, then newest first; full admin fields without the Telegram id", async () => {
    const { body } = await get("/api/admin/deposits");
    assert.equal(body.total, 3);
    assert.deepEqual(body.rows.map((r: any) => r.id), [daveReview, bobReview, credited]);
    const r = body.rows[1];
    assert.equal(r.status, "review");
    assert.equal(r.senderName, "SOMEONE ELSE");
    assert.equal(r.payerName, "Bob Builder");
    assert.equal(r.reviewAmount, 200 * BIRR);
    assert.match(r.reviewWhy, /sender/);
    assert.deepEqual(r.player, { id: bob.id, name: "Bob Builder", username: "bobby" });
    assert.ok(app.deposits.get(bobReview)!.alertMessageId, "the stored deposit has one");
    assert.ok(!("alertMessageId" in r));
  });

  test("status filter and q (reference, payer, sender, player)", async () => {
    assert.deepEqual((await get("/api/admin/deposits?status=credited")).body.rows.map((r: any) => r.id), [credited]);
    assert.deepEqual((await get("/api/admin/deposits?q=ch12review1")).body.rows.map((r: any) => r.id), [bobReview]);
    assert.deepEqual((await get("/api/admin/deposits?q=another")).body.rows.map((r: any) => r.id), [daveReview]);
    assert.deepEqual((await get("/api/admin/deposits?q=@alice")).body.rows.map((r: any) => r.id), [credited]);
    assert.deepEqual((await get(`/api/admin/deposits?q=${bob.id.slice(0, 10)}`)).body.rows.map((r: any) => r.id), [bobReview]);
    assert.equal((await get("/api/admin/deposits?q=nobody-at-all")).body.total, 0);
  });
});

describe("GET /withdrawals", () => {
  test("pending first, player names, no Telegram ids", async () => {
    const { body, text } = await get("/api/admin/withdrawals");
    assert.equal(body.total, 1);
    const w = body.rows[0];
    assert.equal(w.id, withdrawalId);
    assert.equal(w.status, "pending");
    assert.equal(w.amount, 100 * BIRR);
    assert.equal(w.account, "0911223344");
    assert.equal(w.payToName, "Alice Abebe");
    assert.deepEqual(w.player, { id: alice.id, name: "Alice Abebe", username: "alice" });
    assert.doesNotMatch(text, /MessageId|byId/);
    assert.equal((await get("/api/admin/withdrawals?status=paid")).body.total, 0);
    assert.equal((await get("/api/admin/withdrawals?q=0911223344")).body.total, 1);
    assert.equal((await get("/api/admin/withdrawals?q=bobby")).body.total, 0);
  });

  test("read only: no write route", async () => {
    assert.equal((await post(`/api/admin/withdrawals/${withdrawalId}/resolve`, { approve: true, reason: "paid it" })).status, 404);
    assert.equal(app.withdrawals.get(withdrawalId)!.status, "pending");
  });
});

describe("POST /deposits/:id/resolve", () => {
  test("validates approve and the reason, 404 for an unknown id, 409 when not in review", async () => {
    const path = `/api/admin/deposits/${bobReview}/resolve`;
    assert.equal((await post(path, { approve: "yes", reason: "looks fine" })).status, 400);
    assert.equal((await post(path, { approve: true })).status, 400);
    assert.equal((await post(path, { approve: true, reason: "  ok  " })).status, 400);
    assert.equal((await post(path, { approve: true, reason: "x".repeat(301) })).status, 400);
    assert.equal(app.deposits.get(bobReview)!.status, "review");
    assert.equal((await post("/api/admin/deposits/nope/resolve", { approve: true, reason: "looks fine" })).status, 404);
    const done = await post(`/api/admin/deposits/${credited}/resolve`, { approve: true, reason: "looks fine" });
    assert.equal(done.status, 409);
    assert.match(done.body.error, /credited/);
  });

  test("approve with a session credits once, attributes the admin, audits it and clears the Telegram buttons", async () => {
    const signin = await post("/api/admin/session", { name: "Asrat" });
    assert.equal(signin.status, 200);
    const session = { "x-admin-session": signin.body.session };
    const before = app.wallet.balanceIn("real", bob.id);
    const alertId = app.deposits.get(bobReview)!.alertMessageId;
    const edits = telegramCalls.length;

    const r = await post(`/api/admin/deposits/${bobReview}/resolve`, { approve: true, reason: "  Checked the bank statement  " }, session);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.status, "credited");
    assert.equal(r.body.amount, 200 * BIRR);
    assert.equal(r.body.closedBy, "admin:Asrat");
    assert.deepEqual(r.body.player, { id: bob.id, name: "Bob Builder", username: "bobby" });
    assert.ok(!("alertMessageId" in r.body));
    assert.doesNotMatch(r.text, /bank statement/, "the reason stays in the audit log");
    assert.equal(app.wallet.balanceIn("real", bob.id), before + 200 * BIRR);

    const edit = telegramCalls.slice(edits).find((c) => c.method === "editMessageText");
    assert.ok(edit, "telegram alert edited");
    assert.equal(edit!.params.message_id, alertId);
    assert.deepEqual(edit!.params.reply_markup, { inline_keyboard: [] });
    assert.match(String(edit!.params.text), /Approved by admin:Asrat/);

    const again = await post(`/api/admin/deposits/${bobReview}/resolve`, { approve: true, reason: "Checked the bank statement" }, session);
    assert.equal(again.status, 409);
    assert.equal(app.wallet.balanceIn("real", bob.id), before + 200 * BIRR, "credited once");
    assert.equal(app.wallet.txnsIn("real").filter((t) => t.kind === "deposit" && t.ref === bobReview).length, 1);

    const audit = await get("/api/admin/audit");
    const entry = audit.body.rows.find((e: any) => e.action === "deposit-resolve" && e.target === bobReview);
    assert.ok(entry);
    assert.equal(entry.actor, "Asrat");
    assert.deepEqual(entry.detail, {
      approve: true,
      reason: "Checked the bank statement",
      profileId: bob.id,
      amount: 200 * BIRR,
      bank: "telebirr",
      reference: "CH12REVIEW1",
      status: "credited",
      by: "admin:Asrat",
    });
    assert.ok(!audit.text.includes(signin.body.session));
    assert.ok(!audit.text.includes(TEST_TOKEN));

    // The player never sees the admin's reason.
    assert.doesNotMatch(JSON.stringify(app.deposits.get(bobReview)), /bank statement/);
  });

  test("reject with the raw token frees the reference, tolerates a Telegram failure, and is audited", async () => {
    telegramFails = true;
    try {
      const r = await post(`/api/admin/deposits/${daveReview}/resolve`, { approve: false, reason: "Sender does not match" });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.status, "rejected");
      assert.equal(r.body.closedBy, "admin");
      assert.equal(r.body.reason, "A moderator couldn't match this transfer to you.");
      assert.ok(telegramCalls.some((c) => c.method === "editMessageText" && String(c.params.text).includes("Rejected by admin")));
    } finally {
      telegramFails = false;
    }
    assert.equal(app.wallet.balanceIn("real", dave.id), 0);
    // Freed for whoever really paid it, but not for dave.
    const daveAgain = await app.deposits.submit(dave.id, "telebirr", "CH12REVIEW2", "Dave Dawit");
    assert.equal(daveAgain.ok, false);
    const other = await app.deposits.submit(alice.id, "telebirr", "CH12REVIEW2");
    assert.ok(other.ok, JSON.stringify(other));
    const entry = (await get("/api/admin/audit")).body.rows.find((e: any) => e.action === "deposit-resolve" && e.target === daveReview);
    assert.equal(entry.actor, "token");
    assert.equal(entry.detail.approve, false);
    assert.equal(entry.detail.reason, "Sender does not match");
  });

  test("approving is refused while real money is off", async () => {
    const playStore = new MemoryStore();
    const playApp = createApp({ store: playStore, db: null, admin: { token: () => TEST_TOKEN } });
    playStore.write("deposits", {
      list: [{ id: "dep1", profileId: "p", bank: "telebirr", reference: "CH12PLAY001", status: "review", amount: null, reason: "x", createdAt: 1, closedAt: null, reviewAmount: 100 }],
      used: { "telebirr:CH12PLAY001": "dep1" },
    });
    const run = await listen(playApp);
    try {
      const r = await call(run.url, "POST", "/api/admin/deposits/dep1/resolve", { approve: true, reason: "looks fine" });
      assert.equal(r.status, 409);
      assert.equal(playApp.deposits.get("dep1")!.status, "review");
    } finally {
      run.close();
    }
  });
});

describe("secrets", () => {
  test("no response carries a private key, password hash or the admin token", async () => {
    await get("/api/admin/wallet/summary");
    await get("/api/admin/deposits?limit=200");
    await get("/api/admin/withdrawals?limit=200");
    assert.ok(seen.length > 20);
    for (const text of seen) {
      assert.doesNotMatch(text, /privateKey|passwordHash|publicKey/);
      assert.ok(!text.includes(TEST_TOKEN));
    }
  });
});
