// Leftovers from the fix review of the staked-matches money audit (R2-R4: deposits;
// R5 is in auditReviewHold.test.ts, R6 in withdrawals.test.ts, the near-simultaneous
// drop in resume.test.ts).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Deposits, parseReceiptDate, receiptDate, type VerifyEt, type VerifyResult } from "./deposits";
import { moderatorList } from "./moderators";
import { MemoryStore } from "./store";
import { VerifyBudget, verifyBudgetFromEnv } from "./verifyBudget";
import { BIRR, Wallet } from "./wallet";

const DAY = 24 * 60 * 60_000;
const T0 = Date.parse("2026-11-12T08:00:00Z");
const ACCOUNTS = { telebirr: "0911000000" };
const PAYER = "Abebe Bikila";

const paid = (birr: number, extra: Partial<Extract<VerifyResult, { state: "verified" }>> = {}): VerifyResult => ({
  state: "verified",
  amount: birr * BIRR,
  currency: "ETB",
  senderName: "ABEBE BIKILA KEBEDE",
  paidAt: T0 - 60_000,
  toUs: true,
  ...extra,
});

function setup(answers: Record<string, VerifyResult>, budget?: { daily: number; monthly: number }) {
  let now = T0;
  const store = new MemoryStore();
  const wallet = new Wallet(store, { mode: "real", now: () => now });
  const sent: { method: string; params: Record<string, unknown> }[] = [];
  const updates: unknown[] = [];
  const counter = new VerifyBudget(store, budget, () => now);
  let calls = 0;
  const raw: VerifyEt = {
    verify: async ({ reference }) => (calls++, answers[reference] ?? { state: "failed", reason: "transaction not found" }),
    status: async () => ({ state: "failed", reason: "x" }),
  };
  const deposits = new Deposits(store, wallet, {
    verifyEt: counter.wrap(raw),
    budget: budget ? counter : null,
    accounts: ACCOUNTS,
    now: () => now,
    sleep: async () => {},
    accountCreatedAt: () => 0,
    onUpdate: (d) => updates.push(d),
    moderators: { chatId: "-42", allowed: moderatorList("7", "-42"), call: async (method, params) => (sent.push({ method, params }), { message_id: 1 }) },
    limits: { perAccount: 100, perIp: 100 },
  });
  const tap = (data: string) => deposits.handleUpdate({ callback_query: { id: "cb", data, from: { id: 7, username: "mod" }, message: { chat: { id: "-42" } } } });
  return { wallet, deposits, sent, updates, tap, counter, calls: () => calls, tick: (ms: number) => (now += ms) };
}

describe("review R2: a reference alone can't be walked into a credit", () => {
  test("the player never sees the receipt's sender; the moderators do, and learn what Reject does", async () => {
    const { deposits, sent } = setup({ CH12THEFT1: paid(300) });
    const r = await deposits.submit("thief", "telebirr", "CH12THEFT1", "Kebede Alemu");
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "review");
    const view = Deposits.view(r.deposit);
    assert.doesNotMatch(JSON.stringify(view), /ABEBE|BIKILA/i);
    assert.equal(view.reason, "A moderator will check this transfer.");
    const alert = String(sent.find((m) => m.method === "sendMessage")!.params.text);
    assert.match(alert, /ABEBE BIKILA KEBEDE/);
    assert.match(alert, /Reject frees the reference/);
  });

  test("the payer name locks once a deposit goes to review", async () => {
    const { deposits } = setup({ CH12THEFT1: paid(300) });
    await deposits.submit("thief", "telebirr", "CH12THEFT1", "Kebede Alemu");
    assert.deepEqual(deposits.payer("thief"), { name: "Kebede Alemu", locked: true });
  });

  test("after a moderator Reject the same player can't claim the reference again (with any name); the real payer can", async () => {
    const { deposits, tap, wallet, sent } = setup({ CH12THEFT1: paid(300) });
    const r = await deposits.submit("thief", "telebirr", "CH12THEFT1", "Kebede Alemu");
    assert.ok(r.ok);
    await tap(`dep-no:${r.deposit.id}`);
    assert.equal(deposits.get(r.deposit.id)!.status, "rejected");
    const edited = sent.find((m) => m.method === "editMessageText")!;
    assert.match(String(edited.params.text), /freed for others \(not this player\)/);
    const again = await deposits.submit("thief", "telebirr", "CH12THEFT1", "Abebe Bikila Kebede");
    assert.deepEqual(again, { ok: false, reason: "a moderator already checked this transaction and couldn't match it to you" });
    assert.equal(deposits.payer("thief")!.name, "Kebede Alemu", "name still locked");
    const owner = await deposits.submit("owner", "telebirr", "CH12THEFT1", PAYER);
    assert.ok(owner.ok);
    assert.equal(owner.deposit.status, "credited");
    assert.equal(wallet.balanceOf("owner"), 300 * BIRR);
    assert.equal(wallet.balanceOf("thief"), 0);
  });
});

describe("review R3: a shared verify.et budget", () => {
  test("deposits pause once the day's checks are spent, moderators are told once, and it resets the next day", async () => {
    const { deposits, sent, calls, tick, counter } = setup({}, { daily: 2, monthly: 200 });
    await deposits.submit("a", "telebirr", "CH12NOPE01", PAYER);
    await deposits.submit("b", "telebirr", "CH12NOPE02", PAYER);
    assert.equal(calls(), 2);
    const r = await deposits.submit("c", "telebirr", "CH12NOPE03", PAYER);
    assert.deepEqual(r, { ok: false, reason: "deposits are paused for today, try again later" });
    await deposits.submit("d", "telebirr", "CH12NOPE04", PAYER);
    assert.equal(calls(), 2, "no credits spent once paused");
    assert.equal(sent.filter((m) => /Today's verify.et budget/.test(String(m.params.text))).length, 1);
    assert.deepEqual(counter.used(), { day: 2, month: 2 });
    tick(DAY);
    assert.equal((await deposits.submit("c", "telebirr", "CH12NOPE05", PAYER)).ok, true);
    assert.equal(calls(), 3);
  });

  test("the monthly cap holds across days", async () => {
    const { deposits, tick } = setup({}, { daily: 5, monthly: 3 });
    for (let i = 0; i < 3; i++) {
      await deposits.submit(`p${i}`, "telebirr", `CH12MONTH${i}`, PAYER);
      tick(DAY);
    }
    assert.deepEqual(await deposits.submit("x", "telebirr", "CH12MONTHX", PAYER), { ok: false, reason: "deposits are paused for this month, try again later" });
  });

  test("counts survive a restart (kept in the store)", () => {
    const store = new MemoryStore();
    const one = new VerifyBudget(store, { daily: 2 }, () => T0);
    one.record();
    one.record();
    assert.equal(new VerifyBudget(store, { daily: 2 }, () => T0).spent(), "day");
  });

  test("VERIFY_DAILY_BUDGET / VERIFY_MONTHLY_BUDGET", () => {
    assert.deepEqual(verifyBudgetFromEnv({}), { daily: 20, monthly: 200 });
    assert.deepEqual(verifyBudgetFromEnv({ VERIFY_DAILY_BUDGET: "50", VERIFY_MONTHLY_BUDGET: "off" }), { daily: 50, monthly: Infinity });
    assert.deepEqual(verifyBudgetFromEnv({ VERIFY_DAILY_BUDGET: "abc", VERIFY_MONTHLY_BUDGET: "-4" }), { daily: 20, monthly: 200 });
  });
});

describe("review R4: receipt dates", () => {
  test("a named transfer date wins over verify.et's timestamp", () => {
    const r = receiptDate({ timestamp: "2026-11-12T09:00:00Z", transactionDate: "2026-11-10T09:00:00Z" });
    assert.deepEqual(r, { paidAt: Date.parse("2026-11-10T09:00:00Z"), field: "transactionDate" });
    assert.equal(receiptDate({ timestamp: "2026-11-12T09:00:00Z" }).field, "timestamp");
    assert.deepEqual(receiptDate({ date: "garbage" }), { paidAt: null, field: null });
  });

  test("bank-local dates without a zone are read as Addis Ababa time; epoch numbers work", () => {
    assert.equal(parseReceiptDate("2026-11-12 10:30:00"), Date.parse("2026-11-12T07:30:00Z"));
    assert.equal(parseReceiptDate(1_763_000_000), 1_763_000_000_000);
    assert.equal(parseReceiptDate("1763000000000"), 1_763_000_000_000);
    assert.equal(parseReceiptDate(""), null);
    assert.equal(parseReceiptDate("12/40/2026"), null);
  });

  test("no readable date: review, never an automatic credit", async () => {
    const { deposits, wallet } = setup({ CH12NODATE: paid(100, { paidAt: null }) });
    const r = await deposits.submit("a", "telebirr", "CH12NODATE", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "review");
    assert.equal(wallet.balanceOf("a"), 0);
  });
});
