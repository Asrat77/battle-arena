import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Deposits, depositAccountsFromEnv, httpVerifyEt, MIN_DEPOSIT, POLL_TRIES, type VerifyEt, type VerifyResult } from "./deposits";
import { MemoryStore } from "./store";
import { BIRR, Wallet } from "./wallet";

const ACCOUNTS = { telebirr: "0911000000", cbe: "1000123456789" };
const paid = (birr: number, toUs = true): VerifyResult => ({ state: "verified", amount: birr * BIRR, currency: "ETB", senderName: "A", toUs });

/** verify.et stand-in: answers from a table keyed by reference, and records calls. */
function fakeVerifyEt(answers: Record<string, VerifyResult | VerifyResult[]>) {
  const calls: { bank: string; reference: string; settlementAccount: string }[] = [];
  const queues = new Map<string, VerifyResult[]>();
  const next = (ref: string) => {
    if (!queues.has(ref)) {
      const a = answers[ref] ?? { state: "failed", reason: "transaction not found" };
      queues.set(ref, Array.isArray(a) ? [...a] : [a]);
    }
    const q = queues.get(ref)!;
    return q.length > 1 ? q.shift()! : q[0];
  };
  const api: VerifyEt = {
    verify: async (input) => {
      calls.push(input);
      return next(input.reference);
    },
    status: async (requestId) => next(requestId),
  };
  return { api, calls };
}

function setup(answers: Record<string, VerifyResult | VerifyResult[]>, opts: { mode?: "play" | "real"; key?: boolean } = {}) {
  const store = new MemoryStore();
  const wallet = new Wallet(store, { mode: opts.mode ?? "real" });
  const fake = fakeVerifyEt(answers);
  const updates: string[] = [];
  const deposits = new Deposits(store, wallet, {
    verifyEt: opts.key === false ? null : fake.api,
    accounts: ACCOUNTS,
    sleep: async () => {},
    onUpdate: (d) => updates.push(d.status),
  });
  return { wallet, deposits, calls: fake.calls, updates };
}

describe("deposits", () => {
  test("a verified transfer to our account is credited once", async () => {
    const { wallet, deposits, calls, updates } = setup({ CH12ABC345: paid(150) });
    const r = await deposits.submit("a", "telebirr", " ch12abc345 ");
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "credited");
    assert.equal(r.deposit.amount, 150 * BIRR);
    assert.equal(wallet.balanceOf("a"), 150 * BIRR);
    assert.deepEqual(calls, [{ bank: "telebirr", reference: "CH12ABC345", settlementAccount: ACCOUNTS.telebirr }]);
    assert.deepEqual(updates, ["credited"]);
    assert.equal(wallet.history("a")[0].kind, "deposit");

    // Same reference again, by anyone: refused before verify.et is asked.
    assert.deepEqual(await deposits.submit("b", "telebirr", "CH12ABC345"), { ok: false, reason: "this transaction was already used" });
    assert.equal(calls.length, 1);
  });

  test("a transfer to someone else is rejected and stays used", async () => {
    const { wallet, deposits } = setup({ FT2600012345: paid(500, false) });
    const r = await deposits.submit("a", "cbe", "FT2600012345");
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "rejected");
    assert.equal(r.deposit.reason, "this transfer wasn't paid to our account");
    assert.equal(wallet.balanceOf("a"), 0);
    assert.equal((await deposits.submit("a", "cbe", "FT2600012345")).ok, false);
  });

  test("too small is rejected", async () => {
    const { deposits } = setup({ CH12ABC999: paid(MIN_DEPOSIT / BIRR - 1) });
    const r = await deposits.submit("a", "telebirr", "CH12ABC999");
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "rejected");
  });

  test("not found yet can be tried again", async () => {
    const { wallet, deposits } = setup({ CH12LATER1: [{ state: "failed", reason: "transaction not found" }, paid(100)] });
    const first = await deposits.submit("a", "telebirr", "CH12LATER1");
    assert.ok(first.ok);
    assert.equal(first.deposit.status, "rejected");
    const second = await deposits.submit("a", "telebirr", "CH12LATER1");
    assert.ok(second.ok);
    assert.equal(second.deposit.status, "credited");
    assert.equal(wallet.balanceOf("a"), 100 * BIRR);
  });

  test("a queued check is polled until it completes", async () => {
    const { deposits, wallet } = setup({
      CH12QUEUE1: { state: "pending", requestId: "req1" },
      req1: [{ state: "pending", requestId: "req1" }, paid(200)],
    });
    const r = await deposits.submit("a", "telebirr", "CH12QUEUE1");
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "credited");
    assert.equal(wallet.balanceOf("a"), 200 * BIRR);
  });

  test("a check that never completes gives up and frees the reference", async () => {
    const { deposits } = setup({ CH12STUCK1: { state: "pending", requestId: "stuck" }, stuck: { state: "pending", requestId: "stuck" } });
    const r = await deposits.submit("a", "telebirr", "CH12STUCK1");
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "rejected");
    assert.match(r.deposit.reason!, /still checking/);
    assert.ok(POLL_TRIES > 0);
  });

  test("off in play mode or without a key, and bad input is refused", async () => {
    assert.deepEqual(await setup({}, { mode: "play" }).deposits.submit("a", "telebirr", "CH12ABC345"), { ok: false, reason: "deposits are off" });
    assert.deepEqual(await setup({}, { key: false }).deposits.submit("a", "telebirr", "CH12ABC345"), { ok: false, reason: "deposits are off" });
    assert.equal(setup({}, { mode: "play" }).deposits.accounts().length, 0);
    const { deposits } = setup({});
    assert.deepEqual(await deposits.submit("a", "boa", "CH12ABC345"), { ok: false, reason: "pick Telebirr or CBE" });
    assert.equal((await deposits.submit("a", "telebirr", "x")).ok, false);
    assert.deepEqual(deposits.accounts(), [
      { bank: "telebirr", account: ACCOUNTS.telebirr },
      { bank: "cbe", account: ACCOUNTS.cbe },
    ]);
  });

  test("accounts come from DEPOSIT_TELEBIRR and DEPOSIT_CBE", () => {
    assert.deepEqual(depositAccountsFromEnv({ DEPOSIT_TELEBIRR: " 0911 " }), { telebirr: "0911" });
    assert.deepEqual(depositAccountsFromEnv({}), {});
  });
});

describe("httpVerifyEt", () => {
  const realFetch = globalThis.fetch;
  async function withFetch(status: number, body: unknown, run: (seen: { url: string; init: RequestInit }[]) => Promise<void>) {
    const seen: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    try {
      await run(seen);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  test("reads a completed verification (docs example shape)", async () => {
    const body = {
      success: true,
      message: "Transaction verified successfully.",
      data: [
        {
          bank: "telebirr",
          status: "success",
          verified: true,
          amount: 1500,
          currency: "ETB",
          senderName: "Abebe",
          receiverAccount: "1****7441",
          settlementAccountMatch: { matched: true, ambiguous: false },
        },
      ],
      requestId: "r1",
      verification: { requestId: "r1", processingStatus: "completed", status: "success", verified: true },
    };
    await withFetch(200, body, async (seen) => {
      const r = await httpVerifyEt("KEY", "https://v.test").verify({ bank: "telebirr", reference: "CH1", settlementAccount: "0911" });
      assert.deepEqual(r, { state: "verified", amount: 150_000, currency: "ETB", senderName: "Abebe", toUs: true });
      assert.equal(seen[0].url, "https://v.test/api/verify?waitMs=8000");
      assert.equal((seen[0].init.headers as Record<string, string>)["x-api-key"], "KEY");
      assert.deepEqual(JSON.parse(String(seen[0].init.body)), { bank: "telebirr", transactionNumber: "CH1", settlementAccount: "0911" });
    });
  });

  test("202 is pending, 402 and not verified are failures", async () => {
    await withFetch(202, { requestId: "r2", verification: { requestId: "r2", processingStatus: "queued" } }, async () => {
      assert.deepEqual(await httpVerifyEt("K").status("r2"), { state: "pending", requestId: "r2" });
    });
    await withFetch(402, { message: "no credits" }, async () => {
      assert.deepEqual(await httpVerifyEt("K").status("r2"), { state: "failed", reason: "verification credits used up" });
    });
    await withFetch(200, { message: "Not found", data: [{ verified: false }], verification: { processingStatus: "completed", verified: false } }, async () => {
      assert.deepEqual(await httpVerifyEt("K").status("r3"), { state: "failed", reason: "Not found" });
    });
  });
});
