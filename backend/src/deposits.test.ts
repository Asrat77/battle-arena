import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Deposits, DEPOSIT_LIMITS, depositAccountsFromEnv, namesMatch, parseReference, httpVerifyEt, MIN_DEPOSIT, POLL_TRIES, RETRIES, type Deposit, type VerifyEt, type VerifyResult } from "./deposits";
import { moderatorList } from "./moderators";
import { MemoryStore } from "./store";
import { BIRR, Wallet } from "./wallet";

const ACCOUNTS = { telebirr: "0911000000", cbe: "1000123456789" };
const PAYER = "Abebe Bikila";
const paid = (birr: number, toUs = true, extra: Partial<Extract<VerifyResult, { state: "verified" }>> = {}): VerifyResult => ({
  state: "verified",
  amount: birr * BIRR,
  currency: "ETB",
  senderName: "ABEBE BIKILA KEBEDE",
  paidAt: Date.now() - 60_000,
  toUs,
  ...extra,
});

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
    limits: { perAccount: 100 },
  });
  return { wallet, deposits, calls: fake.calls, updates };
}

describe("deposits", () => {
  test("a verified transfer to our account is credited once", async () => {
    const { wallet, deposits, calls, updates } = setup({ CH12ABC345: paid(150) });
    const r = await deposits.submit("a", "telebirr", " ch12abc345 ", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "credited");
    assert.equal(r.deposit.amount, 150 * BIRR);
    assert.equal(wallet.balanceOf("a"), 150 * BIRR);
    assert.deepEqual(calls, [{ bank: "telebirr", reference: "CH12ABC345", settlementAccount: ACCOUNTS.telebirr }]);
    assert.deepEqual(updates, ["credited"]);
    assert.equal(wallet.history("a")[0].kind, "deposit");

    // Same reference again, by anyone: refused before verify.et is asked.
    assert.deepEqual(await deposits.submit("b", "telebirr", "CH12ABC345", PAYER), { ok: false, reason: "this transaction was already used" });
    assert.equal(calls.length, 1);
  });

  test("a transfer not matched to our account waits for a moderator and holds the reference", async () => {
    const { wallet, deposits } = setup({ FT2600012345: paid(500, false) });
    const r = await deposits.submit("a", "cbe", "FT2600012345", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "review");
    assert.match(r.deposit.reason!, /moderator/);
    assert.equal(wallet.balanceOf("a"), 0);
    assert.equal((await deposits.submit("a", "cbe", "FT2600012345", PAYER)).ok, false);
  });

  test("too small is rejected", async () => {
    const { deposits } = setup({ CH12ABC999: paid(MIN_DEPOSIT / BIRR - 1) });
    const r = await deposits.submit("a", "telebirr", "CH12ABC999", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "rejected");
  });

  test("not found yet can be tried again", async () => {
    const { wallet, deposits } = setup({ CH12LATER1: [{ state: "failed", reason: "transaction not found" }, paid(100)] });
    const first = await deposits.submit("a", "telebirr", "CH12LATER1", PAYER);
    assert.ok(first.ok);
    assert.equal(first.deposit.status, "rejected");
    const second = await deposits.submit("a", "telebirr", "CH12LATER1", PAYER);
    assert.ok(second.ok);
    assert.equal(second.deposit.status, "credited");
    assert.equal(wallet.balanceOf("a"), 100 * BIRR);
  });

  test("a queued check is polled until it completes", async () => {
    const { deposits, wallet } = setup({
      CH12QUEUE1: { state: "pending", requestId: "req1" },
      req1: [{ state: "pending", requestId: "req1" }, paid(200)],
    });
    const r = await deposits.submit("a", "telebirr", "CH12QUEUE1", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "credited");
    assert.equal(wallet.balanceOf("a"), 200 * BIRR);
  });

  test("a check that never completes gives up and frees the reference", async () => {
    const { deposits } = setup({ CH12STUCK1: { state: "pending", requestId: "stuck" }, stuck: { state: "pending", requestId: "stuck" } });
    const r = await deposits.submit("a", "telebirr", "CH12STUCK1", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "rejected");
    assert.match(r.deposit.reason!, /still checking/);
    assert.ok(POLL_TRIES > 0);
  });

  test("off in play mode or without a key, and bad input is refused", async () => {
    assert.deepEqual(await setup({}, { mode: "play" }).deposits.submit("a", "telebirr", "CH12ABC345", PAYER), { ok: false, reason: "deposits are off" });
    assert.deepEqual(await setup({}, { key: false }).deposits.submit("a", "telebirr", "CH12ABC345", PAYER), { ok: false, reason: "deposits are off" });
    assert.equal(setup({}, { mode: "play" }).deposits.accounts().length, 0);
    const { deposits } = setup({});
    assert.deepEqual(await deposits.submit("a", "boa", "CH12ABC345", PAYER), { ok: false, reason: "pick Telebirr or CBE" });
    assert.equal((await deposits.submit("a", "telebirr", "x", PAYER)).ok, false);
    assert.deepEqual(deposits.accounts(), [
      { bank: "telebirr", account: ACCOUNTS.telebirr },
      { bank: "cbe", account: ACCOUNTS.cbe },
    ]);
  });

  test("a slow bank is retried before giving up", async () => {
    const slow: VerifyResult = { state: "failed", reason: "The bank took too long to respond. Please try again shortly.", retry: true };
    const { deposits, wallet, calls } = setup({ CH12ABC345: [slow, paid(20)] });
    const r = await deposits.submit("a", "telebirr", "CH12ABC345", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "credited");
    assert.equal(calls.length, 2);
    assert.equal(wallet.balanceOf("a"), 20 * BIRR);

    const always = setup({ CH99ABC345: slow });
    const r2 = await always.deposits.submit("a", "telebirr", "CH99ABC345", PAYER);
    assert.ok(r2.ok);
    assert.equal(r2.deposit.status, "rejected");
    assert.equal(always.calls.length, 1 + RETRIES);
    assert.equal((await always.deposits.submit("a", "telebirr", "CH99ABC345", PAYER)).ok, true, "the reference is free to try again");
  });

  test("reads the reference out of a pasted receipt link or SMS", () => {
    assert.equal(parseReference("telebirr", " ch12abc345 "), "CH12ABC345");
    assert.equal(parseReference("telebirr", "https://transactioninfo.ethiotelecom.et/receipt/CH12ABC345"), "CH12ABC345");
    assert.equal(
      parseReference("telebirr", "You have transferred ETB 10.00 to Abebe (2519****1234). Your transaction number is CH12ABC345. Thank you"),
      "CH12ABC345",
    );
    assert.equal(parseReference("cbe", "https://apps.cbe.com.et:100/?id=FT26314ABCDE12345678"), "FT26314ABCDE");
    assert.equal(parseReference("cbe", "ft26314abcde"), "FT26314ABCDE");
  });

  test("a pasted telebirr receipt link is checked by its transaction number", async () => {
    const { deposits, wallet } = setup({ CH12ABC345: paid(50) });
    const r = await deposits.submit("a", "telebirr", "https://transactioninfo.ethiotelecom.et/receipt/CH12ABC345", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "credited");
    assert.equal(wallet.balanceOf("a"), 50 * BIRR);
  });

  test("accounts come from DEPOSIT_TELEBIRR and DEPOSIT_CBE", () => {
    assert.deepEqual(depositAccountsFromEnv({ DEPOSIT_TELEBIRR: " 0911 " }), { telebirr: "0911" });
    assert.deepEqual(depositAccountsFromEnv({}), {});
  });
});

/** Telegram stand-in for the moderators' chat. */
function fakeTelegram() {
  const sent: { method: string; params: Record<string, unknown> }[] = [];
  let nextId = 100;
  return {
    sent,
    chat: { chatId: "-42", allowed: moderatorList("7", "-42"), call: async (method: string, params: Record<string, unknown>) => (sent.push({ method, params }), { message_id: nextId++ }) },
  };
}

function guarded(answers: Record<string, VerifyResult | VerifyResult[]>, opts: { receiverName?: string; createdAt?: number } = {}) {
  const store = new MemoryStore();
  const wallet = new Wallet(store, { mode: "real" });
  const tg = fakeTelegram();
  const deposits = new Deposits(store, wallet, {
    verifyEt: fakeVerifyEt(answers).api,
    accounts: ACCOUNTS,
    sleep: async () => {},
    receiverName: opts.receiverName ?? null,
    accountCreatedAt: () => opts.createdAt ?? 0,
    moderators: tg.chat,
    limits: { perAccount: 100 },
  });
  const tap = (data: string, chat = "-42", fromId = 7) =>
    deposits.handleUpdate({ callback_query: { id: "cb", data, from: { id: fromId, username: "mod" }, message: { chat: { id: chat } } } });
  return { wallet, deposits, tg, tap };
}

describe("deposits: who paid and when (audit H1, M4, M10)", () => {
  test("pasting someone else's reference doesn't credit it; a moderator reject frees it for the real payer", async () => {
    const { wallet, deposits, tg, tap } = guarded({ CH12THEFT1: paid(300) });
    const thief = await deposits.submit("thief", "telebirr", "CH12THEFT1", "Kebede Alemu");
    assert.ok(thief.ok);
    assert.equal(thief.deposit.status, "review");
    assert.match(thief.deposit.reason!, /isn't the name you pay from/);
    assert.equal(wallet.balanceOf("thief"), 0);
    // The moderators got the details and two buttons.
    const alert = tg.sent.find((m) => m.method === "sendMessage")!;
    assert.match(String(alert.params.text), /ABEBE BIKILA KEBEDE/);
    assert.match(String(alert.params.text), /Kebede Alemu/);
    assert.equal(deposits.get(thief.deposit.id)!.alertMessageId, 100);
    // The real payer is blocked while it's in review...
    assert.equal((await deposits.submit("owner", "telebirr", "CH12THEFT1", PAYER)).ok, false);
    // ...a tap from another chat or from someone off the moderator list does nothing (M3)...
    await tap(`dep-no:${thief.deposit.id}`, "-1");
    assert.equal(deposits.get(thief.deposit.id)!.status, "review");
    await tap(`dep-ok:${thief.deposit.id}`, "-42", 666);
    assert.equal(deposits.get(thief.deposit.id)!.status, "review");
    assert.equal(wallet.balanceOf("thief"), 0);
    // ...a moderator's reject frees it.
    await tap(`dep-no:${thief.deposit.id}`);
    assert.equal(deposits.get(thief.deposit.id)!.status, "rejected");
    assert.equal(deposits.get(thief.deposit.id)!.closedBy, "@mod");
    assert.ok(tg.sent.some((m) => m.method === "editMessageText" && /Rejected by @mod/.test(String(m.params.text))));
    const owner = await deposits.submit("owner", "telebirr", "CH12THEFT1", PAYER);
    assert.ok(owner.ok);
    assert.equal(owner.deposit.status, "credited");
    assert.equal(wallet.balanceOf("owner"), 300 * BIRR);
    assert.equal(wallet.balanceOf("thief"), 0);
  });

  test("a moderator can approve a deposit in review, once", async () => {
    const { wallet, deposits, tap } = guarded({ CH12OLDONE: paid(80, true, { paidAt: Date.now() - 2 * 24 * 3600_000 }) });
    const r = await deposits.submit("a", "telebirr", "CH12OLDONE", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "review");
    assert.match(r.deposit.reason!, /more than a day old/);
    await tap(`dep-ok:${r.deposit.id}`);
    await tap(`dep-ok:${r.deposit.id}`);
    assert.equal(deposits.get(r.deposit.id)!.status, "credited");
    assert.equal(wallet.balanceOf("a"), 80 * BIRR);
  });

  test("the payer name is required, and fixed once a deposit is credited", async () => {
    const { deposits } = guarded({ CH12FIRST1: paid(50), CH12SECND2: paid(50, true, { senderName: "Kebede Alemu" }) });
    assert.deepEqual(await deposits.submit("a", "telebirr", "CH12FIRST1"), { ok: false, reason: "enter the full name on the account you pay from" });
    assert.deepEqual(await deposits.submit("a", "telebirr", "CH12FIRST1", "Abebe"), { ok: false, reason: "enter the full name on the account you pay from" });
    assert.equal(deposits.payer("a"), null, "nothing saved for a refused try");
    assert.equal(((await deposits.submit("a", "telebirr", "CH12FIRST1", " abebe   BIKILA ")) as { deposit: { status: string } }).deposit.status, "credited");
    assert.deepEqual(deposits.payer("a"), { name: "abebe BIKILA", locked: true });
    // A different name typed later is ignored: the receipt must still match the saved one.
    const r = await deposits.submit("a", "telebirr", "CH12SECND2", "Kebede Alemu");
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "review");
    assert.equal(deposits.payer("a")!.name, "abebe BIKILA");
  });

  test("a transfer made before the account existed is refused and freed", async () => {
    const { wallet, deposits } = guarded({ CH12BEFORE: paid(100, true, { paidAt: Date.now() - 3600_000 }) }, { createdAt: Date.now() - 60_000 });
    const r = await deposits.submit("a", "telebirr", "CH12BEFORE", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "rejected");
    assert.match(r.deposit.reason!, /before your account existed/);
    assert.equal(wallet.balanceOf("a"), 0);
    assert.equal((await deposits.submit("b", "telebirr", "CH12BEFORE", PAYER)).ok, true, "reference freed");
  });

  test("receiver name, receipt status, missing sender or date (M4)", async () => {
    const { deposits, wallet } = guarded(
      {
        CH12OTHER1: paid(100, true, { receiverName: "Someone Else Trading" }),
        CH12OURS01: paid(100, true, { receiverName: "ACME TRADING PLC" }),
        CH12PENDNG: paid(100, true, { itemStatus: "pending" }),
        CH12NOSEND: paid(100, true, { senderName: null }),
        CH12NODATE: paid(100, true, { paidAt: null }),
        CH12AMBIG1: paid(100, false, { ambiguous: true }),
      },
      { receiverName: "Acme Trading" },
    );
    const status = async (ref: string) => ((await deposits.submit("a", "telebirr", ref, PAYER)) as { deposit: { status: string; reason: string } }).deposit;
    assert.match((await status("CH12OTHER1")).reason, /not our account name/);
    assert.equal((await status("CH12OURS01")).status, "credited");
    const pending = await status("CH12PENDNG");
    assert.equal(pending.status, "rejected");
    assert.match(pending.reason, /isn't complete/);
    assert.equal((await deposits.submit("a", "telebirr", "CH12PENDNG", PAYER)).ok, true, "a pending transfer can be tried again");
    assert.match((await status("CH12NOSEND")).reason, /who sent it/);
    assert.match((await status("CH12NODATE")).reason, /when it was sent/);
    assert.match((await status("CH12AMBIG1")).reason, /more than one of our accounts/);
    assert.equal(wallet.balanceOf("a"), 100 * BIRR);
  });

  test("name matching wants two of the names the player gave", () => {
    assert.ok(namesMatch("Abebe Bikila", "ABEBE BIKILA KEBEDE"));
    assert.ok(namesMatch("abebe  bikila kebede", "Abebe Bikila"));
    assert.ok(!namesMatch("Abebe Bikila", "Abebe Kebede"));
    assert.ok(namesMatch("Abebe", "Abebe Kebede"), "one word given: one hit (submit asks for two words anyway)");
    assert.ok(!namesMatch("", "Abebe Kebede"));
    assert.ok(!namesMatch("Abebe Bikila", null));
  });
});

describe("deposits: verify.et credits (audit H2)", () => {
  function limited(answers: Record<string, VerifyResult | VerifyResult[]>, verify?: VerifyEt["verify"]) {
    const store = new MemoryStore();
    const wallet = new Wallet(store, { mode: "real" });
    const tg = fakeTelegram();
    const fake = fakeVerifyEt(answers);
    let t = 1_000_000;
    const deposits = new Deposits(store, wallet, {
      verifyEt: verify ? { ...fake.api, verify } : fake.api,
      accounts: ACCOUNTS,
      sleep: async () => {},
      now: () => t,
      moderators: tg.chat,
    });
    return { deposits, calls: fake.calls, tg, later: (ms: number) => (t += ms) };
  }

  test("checks per account are limited, and a refused try costs no credit", async () => {
    const { deposits, calls, later } = limited({});
    for (let i = 0; i < DEPOSIT_LIMITS.perAccount; i++) {
      assert.equal((await deposits.submit("a", "telebirr", `CH12NOPE0${i}`, PAYER, "1.1.1.1")).ok, true);
    }
    assert.deepEqual(await deposits.submit("a", "telebirr", "CH12NOPE99", PAYER, "1.1.1.1"), { ok: false, reason: "too many deposit checks, try again in an hour" });
    assert.equal(calls.length, DEPOSIT_LIMITS.perAccount);
    later(DEPOSIT_LIMITS.windowMs + 1);
    assert.equal((await deposits.submit("a", "telebirr", "CH12NOPE99", PAYER, "1.1.1.1")).ok, true);
  });

  test("checks per IP are limited across accounts", async () => {
    const { deposits, calls } = limited({});
    for (let i = 0; i < DEPOSIT_LIMITS.perIp; i++) {
      assert.equal((await deposits.submit(`p${i}`, "telebirr", `CH12IPIP${String(i).padStart(2, "0")}`, PAYER, "6.6.6.6")).ok, true);
    }
    assert.equal((await deposits.submit("fresh", "telebirr", "CH12IPIP99", PAYER, "6.6.6.6")).ok, false);
    assert.equal((await deposits.submit("fresh", "telebirr", "CH12IPIP99", PAYER, "7.7.7.7")).ok, true);
    assert.equal(calls.length, DEPOSIT_LIMITS.perIp + 1);
  });

  test("one check at a time per account", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { deposits } = limited({}, async () => {
      await gate;
      return { state: "failed", reason: "transaction not found" };
    });
    const first = deposits.submit("a", "telebirr", "CH12SLOW01", PAYER);
    assert.deepEqual(await deposits.submit("a", "telebirr", "CH12SLOW02", PAYER), { ok: false, reason: "a deposit is already being checked, wait for it to finish" });
    release();
    assert.equal((await first).ok, true);
    assert.equal((await deposits.submit("a", "telebirr", "CH12SLOW02", PAYER)).ok, true);
  });

  test("running out of credits (402) alerts moderators once an hour", async () => {
    const out: VerifyResult = { state: "failed", reason: "deposits are paused for now, try again later", creditsOut: true };
    const { deposits, tg, later } = limited({ CH12CRED01: out, CH12CRED02: out, CH12CRED03: out });
    const r = await deposits.submit("a", "telebirr", "CH12CRED01", PAYER);
    assert.ok(r.ok);
    assert.equal(r.deposit.status, "rejected");
    await deposits.submit("b", "telebirr", "CH12CRED02", PAYER);
    const alerts = () => tg.sent.filter((m) => /credits are used up/.test(String(m.params.text))).length;
    assert.equal(alerts(), 1);
    later(60 * 60_000);
    await deposits.submit("c", "telebirr", "CH12CRED03", PAYER);
    assert.equal(alerts(), 2);
  });
});

describe("deposits: references and restarts (audit H3, M9)", () => {
  test("one transfer can't be credited twice under two spellings", async () => {
    const { deposits, wallet, calls } = setup({ CH12ABC345: paid(100), FT26314ABCDE: paid(100) });
    assert.equal(((await deposits.submit("a", "telebirr", "CH12-ABC-345", PAYER)) as { deposit: Deposit }).deposit.status, "credited");
    assert.deepEqual(await deposits.submit("b", "telebirr", "ch12 abc345", PAYER), { ok: false, reason: "this transaction was already used" });
    assert.deepEqual(await deposits.submit("b", "telebirr", "CH12ABC-345", PAYER), { ok: false, reason: "this transaction was already used" });
    assert.equal(((await deposits.submit("a", "cbe", "FT26314-ABCDE", PAYER)) as { deposit: Deposit }).deposit.status, "credited");
    assert.equal((await deposits.submit("b", "cbe", "FT26314ABCDE", PAYER)).ok, false);
    assert.deepEqual(
      calls.map((c) => c.reference),
      ["CH12ABC345", "FT26314ABCDE"],
    );
    assert.equal(wallet.balanceOf("a"), 200 * BIRR);
    assert.equal(parseReference("telebirr", "ch12-abc 345"), "CH12ABC345");
  });

  test("after a restart a stuck check is released, or finished if the wallet was already credited", async () => {
    const store = new MemoryStore();
    const wallet = new Wallet(store, { mode: "real" });
    // Two checks that were running when the process died, one of them credited just before.
    const stuck = (id: string, reference: string) => ({
      id,
      profileId: "a",
      bank: "telebirr",
      reference,
      status: "checking",
      amount: null,
      reason: null,
      createdAt: 1,
      closedAt: null,
      payerName: PAYER,
    });
    store.write("deposits", {
      list: [stuck("d1", "CH12STUCK1"), stuck("d2", "CH12DONE01")],
      used: { "telebirr:CH12STUCK1": "d1", "telebirr:CH12DONE01": "d2", "cbe:FT26314-ABCDE": "old" },
    });
    wallet.deposit("a", 70 * BIRR, "d2");
    const deposits = new Deposits(store, wallet, { verifyEt: fakeVerifyEt({ CH12STUCK1: paid(50) }).api, accounts: ACCOUNTS, sleep: async () => {} });
    assert.deepEqual(deposits.recover(), { credited: 1, released: 1 });
    assert.equal(deposits.get("d1")!.status, "rejected");
    assert.match(deposits.get("d1")!.reason!, /restart/);
    assert.equal(deposits.get("d2")!.status, "credited");
    assert.equal(deposits.get("d2")!.amount, 70 * BIRR);
    assert.deepEqual(deposits.payer("a"), { name: PAYER, locked: true });
    // The released one can be pasted again; the credited one and the old hyphenated one stay used.
    assert.equal(((await deposits.submit("a", "telebirr", "CH12STUCK1")) as { deposit: Deposit }).deposit.status, "credited");
    assert.equal((await deposits.submit("a", "telebirr", "CH12DONE01")).ok, false);
    assert.equal((await deposits.submit("a", "cbe", "FT26314ABCDE")).ok, false);
    assert.equal(wallet.balanceOf("a"), 120 * BIRR);
    assert.deepEqual(deposits.recover(), { credited: 0, released: 0 }, "nothing left to do");
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
          receiverName: "Acme Trading",
          receiverAccount: "1****7441",
          timestamp: "2026-02-20T12:00:00.000Z",
          settlementAccountMatch: { matched: true, ambiguous: false },
        },
      ],
      requestId: "r1",
      verification: { requestId: "r1", processingStatus: "completed", status: "success", verified: true },
    };
    await withFetch(200, body, async (seen) => {
      const r = await httpVerifyEt("KEY", "https://v.test").verify({ bank: "telebirr", reference: "CH1", settlementAccount: "0911" });
      assert.deepEqual(r, {
        state: "verified",
        amount: 150_000,
        currency: "ETB",
        senderName: "Abebe",
        receiverName: "Acme Trading",
        itemStatus: "success",
        paidAt: Date.parse("2026-02-20T12:00:00.000Z"),
        toUs: true,
        ambiguous: false,
      });
      assert.equal(seen[0].url, "https://v.test/api/verify?waitMs=8000");
      assert.equal((seen[0].init.headers as Record<string, string>)["x-api-key"], "KEY");
      assert.deepEqual(JSON.parse(String(seen[0].init.body)), { bank: "telebirr", transactionNumber: "CH1", settlementAccount: "0911" });
    });
  });

  test("reads the status layout after a queued check (live shape)", async () => {
    const done = {
      success: true,
      message: "Verification status.",
      data: {
        requestId: "r9",
        bank: "telebirr",
        processingStatus: "completed",
        status: "success",
        verified: true,
        result: {
          bank: "telebirr",
          status: "success",
          verified: true,
          amount: 40,
          currency: "ETB",
          senderName: "Abebe",
          receiverAccount: "2519****1234",
          transactionNumber: "DKA40GSWJ4",
          settlementAccountMatch: { matched: true, ambiguous: false, matchType: "masked_pattern", candidateCount: 1 },
        },
      },
    };
    await withFetch(200, done, async () => {
      assert.deepEqual(await httpVerifyEt("K").status("r9"), {
        state: "verified",
        amount: 4_000,
        currency: "ETB",
        senderName: "Abebe",
        receiverName: null,
        itemStatus: "success",
        paidAt: null,
        toUs: true,
        ambiguous: false,
      });
    });
    await withFetch(200, { success: true, data: { requestId: "r9", processingStatus: "processing", verified: false } }, async () => {
      assert.deepEqual(await httpVerifyEt("K").status("r9"), { state: "pending", requestId: "r9" });
    });
    const failed = { success: true, message: "Verification status.", data: { requestId: "r9", processingStatus: "failed", verified: false, error: { message: "The bank took too long to respond." } } };
    await withFetch(200, failed, async () => {
      assert.deepEqual(await httpVerifyEt("K").status("r9"), { state: "failed", reason: "The bank took too long to respond.", retry: true });
    });
  });

  test("202 is pending, 402 and not verified are failures", async () => {
    await withFetch(202, { requestId: "r2", verification: { requestId: "r2", processingStatus: "queued" } }, async () => {
      assert.deepEqual(await httpVerifyEt("K").status("r2"), { state: "pending", requestId: "r2" });
    });
    await withFetch(402, { message: "no credits" }, async () => {
      assert.deepEqual(await httpVerifyEt("K").status("r2"), { state: "failed", reason: "deposits are paused for now, try again later", creditsOut: true });
    });
    await withFetch(200, { message: "Not found", data: [{ verified: false }], verification: { processingStatus: "completed", verified: false } }, async () => {
      assert.deepEqual(await httpVerifyEt("K").status("r3"), { state: "failed", reason: "Not found", retry: false });
    });
    await withFetch(200, { message: "The bank took too long to respond. Please try again shortly.", verification: { processingStatus: "completed", verified: false } }, async () => {
      assert.equal(((await httpVerifyEt("K").status("r4")) as { retry?: boolean }).retry, true);
    });
    await withFetch(504, {}, async () => {
      assert.equal(((await httpVerifyEt("K").status("r5")) as { retry?: boolean }).retry, true);
    });
  });
});
