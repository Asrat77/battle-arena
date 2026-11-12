// Independent re-check of the money audit: each test is the original exploit (or the nearest
// thing an attacker could try) run against the whole app with stubbed verify.et and Telegram.
// Names start with the audit finding id.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { io as connect, type Socket } from "socket.io-client";
import { firstToThree } from "../../engine/games/firstToThree";
import { getGame, listGames } from "../../engine/registry";
import type { AnyGame } from "../../engine/types";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import type { VerifyEt, VerifyResult } from "./deposits";
import { Identity } from "./identity";
import { moderatorList } from "./moderators";
import { StakeLimits } from "./stakeLimits";
import { FileStore, MemoryStore } from "./store";
import { BIRR, Wallet } from "./wallet";
import { FileTxnLog } from "./walletLog";

const games: AnyGame[] = [firstToThree, ...listGames()];
const lookup = { get: (id: string) => games.find((g) => g.id === id), list: () => games };
const PW = "correct horse 9";
const CHAT = "-100";
const MODS = moderatorList("111,222", CHAT);

type Verified = Extract<VerifyResult, { state: "verified" }>;
const receipt = (o: Partial<Verified> = {}): Verified => ({
  state: "verified", amount: 100 * BIRR, currency: "ETB", senderName: "Abebe Kebede Alemu", receiverName: "Our Shop", itemStatus: "success",
  paidAt: Date.now() - 60_000, toUs: true, ambiguous: false, ...o,
});

/** verify.et stub: reference -> answer. Counts every call (each costs a credit). */
function fakeVerify() {
  const answers = new Map<string, VerifyResult | (() => Promise<VerifyResult>)>();
  const calls: string[] = [];
  const v: VerifyEt & { answers: typeof answers; calls: string[] } = {
    answers,
    calls,
    async verify({ reference }) {
      calls.push(reference);
      const a = answers.get(reference);
      if (!a) return { state: "failed", reason: "transaction not found" };
      return typeof a === "function" ? a() : a;
    },
    async status() {
      return { state: "failed", reason: "no" };
    },
  };
  return v;
}

function fakeTelegram() {
  let id = 1000;
  const sent: { method: string; params: any; id: number }[] = [];
  const tg = {
    sent,
    async call(method: string, params: any) {
      sent.push({ method, params, id: ++id });
      return { message_id: id };
    },
    prompts: () => sent.filter((s) => s.method === "sendMessage" && s.params.reply_markup?.force_reply),
    texts: () => sent.filter((s) => s.method === "sendMessage").map((s) => s.params.text as string),
  };
  return tg;
}

interface Opts {
  store?: MemoryStore;
  hold?: number;
  verify?: ReturnType<typeof fakeVerify>;
  tg?: ReturnType<typeof fakeTelegram>;
  second?: number | null;
  limits?: Record<string, number>;
  noStakeLimitOverride?: boolean;
  receiverName?: string | null;
  payoutSenderName?: string | null;
  depositLimits?: Record<string, number>;
  withdrawalLimits?: Record<string, number>;
  clock?: FakeClock;
  alert?: (t: string) => void;
}

function boot(o: Opts = {}) {
  const verify = o.verify ?? fakeVerify();
  const tg = o.tg ?? fakeTelegram();
  const store = o.store ?? new MemoryStore();
  const clock = o.clock ?? new FakeClock();
  const app = createApp({
    store,
    clock,
    games: lookup,
    ledger: { blockTimeMs: 1 },
    wallet: { mode: "real", depositHoldMs: o.hold ?? 0 },
    deposits: {
      verifyEt: verify,
      accounts: { telebirr: "0911000000" },
      sleep: async () => {},
      receiverName: o.receiverName ?? null,
      moderators: { call: (m, p) => tg.call(m, p), chatId: CHAT, allowed: MODS },
      limits: o.depositLimits,
    },
    withdrawals: {
      telegram: tg as any,
      moderatorChat: CHAT,
      verifyEt: verify,
      moderators: MODS,
      secondApprovalAbove: o.second === undefined ? 1_000 * BIRR : o.second,
      payoutSenderName: o.payoutSenderName ?? null,
      limits: o.withdrawalLimits,
    },
    stakeLimits: o.noStakeLimitOverride ? { alert: o.alert } : { limits: { minAccountAgeMs: 0, ...o.limits }, alert: o.alert },
  });
  return { ...app, verify, tg, store, clock };
}
type App = ReturnType<typeof boot>;

let n = 0;
const user = (app: App, first = "Abebe", last = "Kebede") => {
  const username = `u${++n}_${first.toLowerCase()}`;
  const s = app.identity.signup(`${first} ${last}`, { username, password: PW });
  return { id: s.profile.id, token: s.token, username, name: `${first} ${last} Alemu` };
};
const guest = (app: App, name = "Guest") => app.identity.signup(name);

let refN = 0;
const ref = () => `TX${String(++refN).padStart(8, "0")}`;

/** A player with a credited real-money deposit (payer name locked). */
async function funded(app: App, birr = 500, first = "Abebe", last = "Kebede") {
  const u = user(app, first, last);
  const r = ref();
  app.verify.answers.set(r, receipt({ amount: birr * BIRR, senderName: `${first} ${last} Alemu` }));
  const res: any = await app.deposits.submit(u.id, "telebirr", r, `${first} ${last} Alemu`, "1.1.1.1");
  assert.equal(res.deposit.status, "credited", JSON.stringify(res));
  return u;
}

const cb = (data: string, fromId: number, messageId = 1) => ({ callback_query: { id: "q" + Math.random(), from: { id: fromId, username: "mod" + fromId }, data, message: { chat: { id: Number(CHAT) }, message_id: messageId } } });
const say = (text: string, fromId: number, replyTo?: number) => ({ message: { from: { id: fromId, username: "mod" + fromId }, chat: { id: Number(CHAT) }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) } });
const bal = (app: App, id: string) => app.wallet.balanceOf(id);

async function withdraw(app: App, u: ReturnType<typeof user>, amount: number, extra: Record<string, unknown> = {}): Promise<any> {
  return app.withdrawals.request(u.id, { bank: "telebirr", account: "0911223344", amount: amount * BIRR, password: PW, ...extra });
}

/** Moderator taps Paid, then replies with a payout number; returns the Telegram prompt used. */
async function payOut(app: App, wid: string, payoutRef: string, mod = 111) {
  await app.withdrawals.handleUpdate(cb(`paid:${wid}`, mod));
  const prompt = app.tg.prompts().at(-1)!;
  await app.withdrawals.handleUpdate(say(payoutRef, mod, prompt.id));
  return prompt;
}

// ───────────────────────── Group B: deposits ─────────────────────────

describe("H1: a deposit goes to whoever really sent the money", () => {
  test("pasting someone else's reference (claiming to be them or not) credits nothing", async () => {
    const app = boot();
    const victim = "Abebe Kebede Alemu";
    const r = ref();
    app.verify.answers.set(r, receipt({ senderName: victim }));
    const thief = user(app, "Chala", "Gemechu");
    // honest attempt under the thief's own name
    const a: any = await app.deposits.submit(thief.id, "telebirr", r, "Chala Gemechu Tadesse", "9.9.9.9");
    assert.equal(a.deposit.status, "review");
    assert.equal(bal(app, thief.id), 0);
    // the reference is now frozen for the moderator, so the real owner can't even race: a reject frees it
    assert.equal(app.verify.calls.length, 1);
  });

  test("a transfer older than 24 h, or older than the account, is not credited", async () => {
    const app = boot();
    const u = user(app);
    const old = ref();
    app.verify.answers.set(old, receipt({ paidAt: Date.now() - 2 * 86_400_000 }));
    const a: any = await app.deposits.submit(u.id, "telebirr", old, "Abebe Kebede Alemu", "1.1.1.1");
    assert.notEqual(a.deposit.status, "credited", "2-day-old transfer is not credited (it predates the account, so it is refused outright)");
    assert.equal(bal(app, u.id), 0);
    const before = ref();
    app.verify.answers.set(before, receipt({ paidAt: Date.now() - 3 * 3_600_000 }));
    const b: any = await app.deposits.submit(u.id, "telebirr", before, "Abebe Kebede Alemu", "1.1.1.1");
    assert.equal(b.deposit.status, "rejected", "made before the account existed");
    assert.equal(bal(app, u.id), 0);
  });

  test("the payer name is locked after the first credit; a later deposit from another name needs a moderator", async () => {
    const app = boot();
    const u = await funded(app, 100);
    const r = ref();
    app.verify.answers.set(r, receipt({ senderName: "Someone Else Entirely" }));
    const res: any = await app.deposits.submit(u.id, "telebirr", r, "Someone Else Entirely", "1.1.1.1");
    assert.equal(res.deposit.status, "review", "new payer name is ignored once locked");
    assert.equal(bal(app, u.id), 100 * BIRR);
  });

  test("the same transfer can't be credited twice", async () => {
    const app = boot();
    const u = user(app);
    const r = ref();
    app.verify.answers.set(r, receipt());
    assert.equal(((await app.deposits.submit(u.id, "telebirr", r, "Abebe Kebede Alemu", "1.1.1.1")) as any).deposit.status, "credited");
    const again: any = await app.deposits.submit(u.id, "telebirr", r, "Abebe Kebede Alemu", "2.2.2.2");
    assert.equal(again.ok, false);
    const other = user(app, "Chala", "Gemechu");
    assert.equal(((await app.deposits.submit(other.id, "telebirr", r, "Abebe Kebede Alemu", "3.3.3.3")) as any).ok, false);
    assert.equal(bal(app, u.id), 100 * BIRR);
    assert.equal(bal(app, other.id), 0);
  });

  test("H7 tie-in: a guest (no password) can't deposit real money", async () => {
    const app = boot();
    const g = guest(app);
    const r = ref();
    app.verify.answers.set(r, receipt());
    const res: any = await app.deposits.submit(g.profile.id, "telebirr", r, "Abebe Kebede Alemu", "1.1.1.1");
    assert.equal(res.ok, false);
    assert.equal(app.verify.calls.length, 0);
  });
});

describe("M4: receipts are checked for status, receiver and ambiguity", () => {
  test("failed status is refused; ambiguous / not-to-us / wrong receiver name go to review", async () => {
    const app = boot({ receiverName: "Our Shop PLC" });
    const u = user(app);
    const cases: [Partial<Verified>, string][] = [
      [{ itemStatus: "failed" }, "rejected"],
      [{ itemStatus: "reversed" }, "rejected"],
      [{ ambiguous: true, toUs: false }, "review"],
      [{ toUs: false }, "review"],
      [{ receiverName: "Somebody Else Ltd" }, "review"],
    ];
    for (const [over, want] of cases) {
      const r = ref();
      app.verify.answers.set(r, receipt(over));
      const res: any = await app.deposits.submit(u.id, "telebirr", r, "Abebe Kebede Alemu", `ip${refN}`);
      assert.equal(res.deposit.status, want, JSON.stringify(over));
      assert.equal(bal(app, u.id), 0, JSON.stringify(over));
    }
  });
});

describe("M9: one transfer, one spelling", () => {
  test("hyphen / space / case variants of a reference credit once", async () => {
    const app = boot();
    const u = user(app);
    app.verify.answers.set("ABC12345XY", receipt());
    assert.equal(((await app.deposits.submit(u.id, "telebirr", "abc-123 45xy", "Abebe Kebede Alemu", "1.1.1.1")) as any).deposit.status, "credited");
    for (const v of ["ABC12345XY", "abc12345xy", "ABC-12345-XY", "ABC 12345 XY"]) {
      assert.equal(((await app.deposits.submit(u.id, "telebirr", v, "Abebe Kebede Alemu", "1.1.1.1")) as any).ok, false, v);
    }
    assert.equal(bal(app, u.id), 100 * BIRR);
  });
});

describe("M10: a 'not paid to our account' receipt is reviewed, not burned", () => {
  test("reject frees the reference for the real owner; approve credits once; strangers can't tap", async () => {
    const app = boot();
    const thief = user(app, "Chala", "Gemechu");
    const r = ref();
    app.verify.answers.set(r, receipt({ toUs: false }));
    const res: any = await app.deposits.submit(thief.id, "telebirr", r, "Chala Gemechu Tadesse", "1.1.1.1");
    assert.equal(res.deposit.status, "review");
    const alert = app.tg.sent.find((s) => s.params?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith("dep-ok:"))!;
    assert.ok(alert, "moderators were alerted");
    const depId = res.deposit.id;
    // a stranger in the chat taps approve
    await app.withdrawals.handleUpdate(cb(`dep-ok:${depId}`, 999, alert.id));
    assert.equal(bal(app, thief.id), 0, "non-moderator tap ignored");
    // moderator rejects: reference is free again
    await app.withdrawals.handleUpdate(cb(`dep-no:${depId}`, 111, alert.id));
    assert.equal(app.deposits.get(depId)!.status, "rejected");
    // an approve tapped after the reject must not credit
    await app.withdrawals.handleUpdate(cb(`dep-ok:${depId}`, 111, alert.id));
    assert.equal(bal(app, thief.id), 0);
    // the genuine owner now pastes it and it works
    const owner = user(app);
    app.verify.answers.set(r, receipt());
    assert.equal(((await app.deposits.submit(owner.id, "telebirr", r, "Abebe Kebede Alemu", "5.5.5.5")) as any).deposit.status, "credited");
    // approve twice credits once
    const r2 = ref();
    app.verify.answers.set(r2, receipt({ toUs: false }));
    const u2 = user(app, "Dawit", "Haile");
    const d2: any = await app.deposits.submit(u2.id, "telebirr", r2, "Dawit Haile Alemu", "6.6.6.6");
    await app.withdrawals.handleUpdate(cb(`dep-ok:${d2.deposit.id}`, 222));
    await app.withdrawals.handleUpdate(cb(`dep-ok:${d2.deposit.id}`, 111));
    assert.equal(bal(app, u2.id), 100 * BIRR);
  });
});

describe("H2: deposit checks are rate limited and 402 alerts", () => {
  test("at most 5 checks an hour per account, one at a time, 15 per IP", async () => {
    const app = boot();
    const u = user(app);
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      const res: any = await app.deposits.submit(u.id, "telebirr", ref(), "Abebe Kebede Alemu", "1.1.1.1");
      if (res.ok) ok++;
    }
    assert.equal(ok, 5);
    assert.equal(app.verify.calls.length, 5, "verify.et credits spent: only the allowed ones");
    // IP limit across accounts
    const app2 = boot();
    let spent = 0;
    for (let i = 0; i < 20; i++) {
      const x = user(app2);
      const res: any = await app2.deposits.submit(x.id, "telebirr", ref(), "Abebe Kebede Alemu", "7.7.7.7");
      if (res.ok) spent++;
    }
    assert.equal(spent, 15);
    // concurrency
    const app3 = boot();
    const c = user(app3);
    let release!: () => void;
    const r = ref();
    app3.verify.answers.set(r, () => new Promise((res) => (release = () => res(receipt()))));
    const first = app3.deposits.submit(c.id, "telebirr", r, "Abebe Kebede Alemu", "1.1.1.1");
    await new Promise((x) => setTimeout(x, 20));
    const second: any = await app3.deposits.submit(c.id, "telebirr", ref(), "Abebe Kebede Alemu", "1.1.1.1");
    assert.equal(second.ok, false);
    release();
    await first;
    assert.equal(app3.verify.calls.length, 1);
  });

  test("HTTP 402 from verify.et sends one moderator alert and an error log", async () => {
    const app = boot();
    const u = user(app);
    app.verify.verify = async () => ({ state: "failed", reason: "paused", creditsOut: true });
    await app.deposits.submit(u.id, "telebirr", ref(), "Abebe Kebede Alemu", "1.1.1.1");
    await app.deposits.submit(u.id, "telebirr", ref(), "Abebe Kebede Alemu", "1.1.1.1");
    assert.equal(app.tg.texts().filter((t) => t.includes("402")).length, 1, "alert at most hourly");
  });
});

describe("H3: a restart never leaves a deposit stuck in 'checking'", () => {
  test("not credited -> released and re-pasteable; credited in the wallet -> finished", async () => {
    const store = new MemoryStore();
    const first = boot({ store });
    const u = user(first);
    const r = ref();
    first.verify.answers.set(r, () => new Promise(() => {})); // process "dies" mid-check
    void first.deposits.submit(u.id, "telebirr", r, "Abebe Kebede Alemu", "1.1.1.1");
    await new Promise((x) => setTimeout(x, 20));
    assert.equal(first.deposits.history(u.id)[0].status, "checking");
    first.io.close();
    const second = boot({ store });
    assert.equal(second.deposits.history(u.id)[0].status, "rejected", "released on boot");
    second.verify.answers.set(r, receipt());
    assert.equal(((await second.deposits.submit(u.id, "telebirr", r, "Abebe Kebede Alemu", "1.1.1.1")) as any).deposit.status, "credited");
    assert.equal(bal(second, u.id), 100 * BIRR);
    // crash AFTER the wallet credit but before the deposit record closed
    const s2 = new MemoryStore();
    const a = boot({ store: s2 });
    const v = user(a);
    const r2 = ref();
    a.verify.answers.set(r2, () => new Promise(() => {}));
    void a.deposits.submit(v.id, "telebirr", r2, "Abebe Kebede Alemu", "1.1.1.1");
    await new Promise((x) => setTimeout(x, 20));
    const dep = a.deposits.history(v.id)[0];
    a.wallet.deposit(v.id, 100 * BIRR, dep.id);
    a.io.close();
    const b = boot({ store: s2 });
    assert.equal(b.deposits.history(v.id)[0].status, "credited");
    assert.equal(bal(b, v.id), 100 * BIRR, "credited exactly once");
  });
});

// ───────────────────────── Group C: withdrawals ─────────────────────────

describe("H4: a payout proof must really be this payout", () => {
  async function pending(app: App, amount = 100) {
    const u = await funded(app, 500);
    const w = (await withdraw(app, u, amount)).withdrawal;
    return { u, w };
  }
  const closed = (app: App, id: string) => app.withdrawals.get(id)!.status;

  test("old transfer, wrong account, too small, wrong sender, no verify.et: none close the request", async () => {
    const app = boot({ payoutSenderName: "Our Shop PLC", second: null });
    const { w } = await pending(app);
    const bad: [string, Partial<Verified>][] = [
      ["OLDTX00001", { paidAt: Date.now() - 86_400_000, senderName: "Our Shop PLC" }],
      ["WRONGACC01", { toUs: false, senderName: "Our Shop PLC" }],
      ["SMALL00001", { amount: 10 * BIRR, senderName: "Our Shop PLC" }],
      ["WRONGSND01", { senderName: "Random Person" }],
      ["FAILED0001", { itemStatus: "failed", senderName: "Our Shop PLC" }],
      ["NOWHO00001", { senderName: "Our Shop PLC", receiverName: "A Different Holder" }],
    ];
    // payToName (player's deposit name) must be the receiver, so even a "good" transfer to another holder fails
    for (const [r, over] of bad) {
      app.verify.answers.set(r, receipt(over));
      await payOut(app, w.id, r);
      assert.equal(closed(app, w.id), "pending", r);
    }
    // the right one closes it
    app.verify.answers.set("GOODTX0001", receipt({ senderName: "Our Shop PLC", receiverName: "Abebe Kebede Alemu", amount: 100 * BIRR }));
    await payOut(app, w.id, "GOODTX0001");
    assert.equal(closed(app, w.id), "paid");
  });

  test("an already-used payout number can't close another withdrawal; replying text with no verify.et never closes", async () => {
    const app = boot({ second: null });
    const a = await pending(app);
    const b = await pending(app);
    app.verify.answers.set("SHARED0001", receipt({ receiverName: "Abebe Kebede Alemu" }));
    await payOut(app, a.w.id, "SHARED0001");
    assert.equal(closed(app, a.w.id), "paid");
    await payOut(app, b.w.id, "SHARED0001");
    assert.equal(closed(app, b.w.id), "pending", "same payout reused");
    assert.equal(closed(app, b.w.id), "pending");
    // hyphenated spelling of the same number is also used
    await payOut(app, b.w.id, "shared-0001");
    assert.equal(closed(app, b.w.id), "pending");

    const off = boot({ second: null });
    off.withdrawals["opts" as never]; // (private opts exist; build one without verifyEt instead)
    const bare = createApp({ store: new MemoryStore(), clock: new FakeClock(), games: lookup, ledger: { blockTimeMs: 1 }, wallet: { mode: "real", depositHoldMs: 0 },
      deposits: { verifyEt: fakeVerify(), accounts: { telebirr: "1" }, sleep: async () => {} }, withdrawals: { telegram: fakeTelegram() as any, moderatorChat: CHAT, verifyEt: null, moderators: MODS, secondApprovalAbove: null, payer: () => ({ name: "A B", locked: true }) } });
    const p = bare.identity.signup("Pat Lee", { username: "patlee", password: PW }).profile.id;
    bare.wallet.deposit(p, 200 * BIRR, "x1");
    const wr: any = await bare.withdrawals.request(p, { bank: "telebirr", account: "0911223344", amount: 100 * BIRR, password: PW });
    assert.equal(wr.ok, true, JSON.stringify(wr));
    const tg = (bare.withdrawals as any).opts.telegram;
    await bare.withdrawals.handleUpdate(cb(`paid:${wr.withdrawal.id}`, 111));
    await bare.withdrawals.handleUpdate(say("ANYTEXT123", 111, tg.prompts().at(-1).id));
    assert.equal(bare.withdrawals.get(wr.withdrawal.id)!.status, "pending", "Paid alone never closes without verify.et");
  });
});

describe("H5: unconfirmed payouts have an exit that isn't a double pay", () => {
  test("'confirm anyway' needs a reason and records who; reject after a payout number asks again", async () => {
    const app = boot({ second: null });
    const u = await funded(app, 500);
    const w = (await withdraw(app, u, 100)).withdrawal;
    // verify.et can't confirm
    await payOut(app, w.id, "UNSEEN0001");
    assert.equal(app.withdrawals.get(w.id)!.status, "pending");
    // Reject now: money may have gone out -> must ask for confirmation instead of refunding
    const before = bal(app, u.id);
    await app.withdrawals.handleUpdate(cb(`reject:${w.id}`, 111));
    assert.equal(app.withdrawals.get(w.id)!.status, "pending", "first reject only asks");
    assert.equal(bal(app, u.id), before);
    // force with a too-short reason is not accepted
    await app.withdrawals.handleUpdate(cb(`force:${w.id}`, 111));
    const fp = app.tg.prompts().at(-1)!;
    await app.withdrawals.handleUpdate(say("ok", 111, fp.id));
    assert.equal(app.withdrawals.get(w.id)!.status, "pending");
    await app.withdrawals.handleUpdate(say("Saw the SMS from the bank, money reached the account", 111, fp.id));
    const done = app.withdrawals.get(w.id)!;
    assert.equal(done.status, "paid");
    assert.ok(done.forced?.reason && done.forced.by);
    assert.equal(bal(app, u.id), before, "no refund");
    // the player's view hides moderator notes
    assert.equal(JSON.stringify(app.withdrawals.forPlayer(u.id)).includes("Saw the SMS"), false);
  });

  test("the player can cancel until a moderator taps Paid; cancel refunds exactly once", async () => {
    const app = boot();
    const u = await funded(app, 500);
    const start = bal(app, u.id);
    const w = (await withdraw(app, u, 100)).withdrawal;
    assert.equal(bal(app, u.id), start - 100 * BIRR);
    assert.equal((await app.withdrawals.cancel(u.id, w.id)).ok, true);
    assert.equal((await app.withdrawals.cancel(u.id, w.id)).ok, false);
    await app.withdrawals.handleUpdate(cb(`reject:${w.id}`, 111));
    assert.equal(bal(app, u.id), start, "refunded once, not twice");
    // a different player can't cancel mine
    const x = await funded(app, 500);
    const w2 = (await withdraw(app, x, 100)).withdrawal;
    assert.equal((await app.withdrawals.cancel(u.id, w2.id)).ok, false);
    // after Paid is tapped the player can no longer cancel
    await app.withdrawals.handleUpdate(cb(`paid:${w2.id}`, 111));
    assert.equal((await app.withdrawals.cancel(x.id, w2.id)).ok, false);
  });
});

describe("M3: only allow-listed moderators act; big payouts need two", () => {
  test("strangers' taps and replies do nothing; a second, different moderator approves > threshold", async () => {
    const app = boot();
    const u = await funded(app, 1500);
    const w = (await withdraw(app, u, 1200)).withdrawal;
    await app.withdrawals.handleUpdate(cb(`paid:${w.id}`, 999));
    assert.equal(app.tg.prompts().length, 0, "stranger's Paid tap ignored");
    await app.withdrawals.handleUpdate(cb(`reject:${w.id}`, 999));
    assert.equal(app.withdrawals.get(w.id)!.status, "pending");
    app.verify.answers.set("BIGPAY0001", receipt({ amount: 1200 * BIRR, receiverName: "Abebe Kebede Alemu" }));
    await payOut(app, w.id, "BIGPAY0001", 111);
    assert.equal(app.withdrawals.get(w.id)!.status, "pending", "waits for second moderator");
    await app.withdrawals.handleUpdate(cb(`approve:${w.id}`, 111));
    assert.equal(app.withdrawals.get(w.id)!.status, "pending", "same moderator can't approve");
    await app.withdrawals.handleUpdate(cb(`approve:${w.id}`, 999));
    assert.equal(app.withdrawals.get(w.id)!.status, "pending", "stranger can't approve");
    await app.withdrawals.handleUpdate(cb(`approve:${w.id}`, 222));
    assert.equal(app.withdrawals.get(w.id)!.status, "paid");
  });

  test("a group chat with no TELEGRAM_MODERATORS has no moderators at all", () => {
    assert.equal(moderatorList(undefined, "-100123").allows(-100123), false);
    assert.equal(moderatorList("", "-100123").count, 0);
    assert.equal(moderatorList(undefined, "555").allows(555), true);
    assert.equal(moderatorList("1,2", "-1").allows(3), false);
  });
});

describe("L3: withdrawal ceilings", () => {
  test("over 2000 birr at once, or over 5000 birr in a day, is refused", async () => {
    const app = boot();
    const u = await funded(app, 500);
    app.wallet.adjust("real", u.id, 20_000 * BIRR, "test float", "t");
    assert.equal((await withdraw(app, u, 2001)).ok, false);
    assert.equal((await withdraw(app, u, 2000)).ok, true);
    await app.withdrawals.handleUpdate(cb(`reject:${(app.withdrawals.forPlayer(u.id)[0] as any).id}`, 111)); // frees pending slot, refund
    const w1 = (await withdraw(app, u, 2000)).withdrawal;
    assert.ok(w1);
    await app.withdrawals.cancel(u.id, w1.id);
    // two real ones paid, then the third in the same day is over the daily cap
    const mk = async (amt: number) => {
      const w = (await withdraw(app, u, amt)).withdrawal;
      assert.ok(w, "request " + amt);
      const r = ref();
      app.verify.answers.set(r, receipt({ amount: amt * BIRR, receiverName: "Abebe Kebede Alemu" }));
      await payOut(app, w.id, r);
      return app.withdrawals.get(w.id)!.status;
    };
    app.withdrawals["secondApprovalAbove" as never];
    (app.withdrawals as any).secondApprovalAbove = null;
    assert.equal(await mk(2000), "paid");
    assert.equal(await mk(2000), "paid");
    const third: any = await withdraw(app, u, 2000);
    assert.equal(third.ok, false, "daily cap");
  });
});

describe("L4: a crash between the debit and the saved request loses nothing", () => {
  test("saved-but-never-debited is dropped; closed-but-never-refunded is refunded once", async () => {
    const store = new MemoryStore();
    const a = boot({ store });
    const u = await funded(a, 500);
    const start = bal(a, u.id);
    // crash right after the request is saved, before the debit
    (a.wallet as any).withdraw = () => {
      throw new Error("power cut");
    };
    await withdraw(a, u, 100).catch(() => {});
    a.io.close();
    const b = boot({ store });
    assert.equal(b.withdrawals.forPlayer(u.id).length, 0, "phantom request dropped");
    assert.equal(bal(b, u.id), start);
    // crash after a reject closed the request but before the refund
    const w = (await withdraw(b, u, 100)).withdrawal;
    (b.wallet as any).refundWithdrawal = () => {
      throw new Error("power cut");
    };
    await b.withdrawals.handleUpdate(cb(`reject:${w.id}`, 111)).catch(() => {});
    assert.equal(b.withdrawals.get(w.id)!.status, "rejected");
    assert.equal(bal(b, u.id), start - 100 * BIRR, "refund missing before recovery");
    b.io.close();
    const c = boot({ store });
    assert.equal(bal(c, u.id), start, "refunded on boot");
    c.io.close();
    const d = boot({ store });
    assert.equal(bal(d, u.id), start, "and only once");
  });
});

// ───────────────────────── Group D: wallet ─────────────────────────

describe("H6 / C3: play money and real money are separate books", () => {
  test("faucet birr earned in play mode is not real balance when the mode flips", () => {
    const store = new MemoryStore();
    const play = new Wallet(store, { mode: "play" });
    play.faucet("0xabc0000000000000000000000000000000000001");
    assert.equal(play.balanceOf("0xabc0000000000000000000000000000000000001"), 500 * BIRR);
    const real = new Wallet(store, { mode: "real", depositHoldMs: 0 });
    assert.equal(real.balanceOf("0xabc0000000000000000000000000000000000001"), 0);
    assert.equal(real.withdraw("0xabc0000000000000000000000000000000000001", 100 * BIRR, "w1").ok, false);
    assert.equal(real.faucet("0xabc0000000000000000000000000000000000001").ok, false, "no faucet in real mode");
  });

  test("the old shared `wallet` key moves to the play book and real deposits are reported, not withdrawable", () => {
    const store = new MemoryStore();
    const id = "0xabc0000000000000000000000000000000000002";
    store.write("wallet", {
      balances: { [id]: 300 * BIRR }, escrows: {}, lastFaucet: {},
      txns: [{ id: "t1", profileId: id, kind: "deposit", amount: 200 * BIRR, balance: 200 * BIRR, ref: "d1", ts: 1 }, { id: "t2", profileId: id, kind: "faucet", amount: 100 * BIRR, balance: 300 * BIRR, ref: null, ts: 2 }],
    });
    const w = new Wallet(store, { mode: "real", depositHoldMs: 0 });
    assert.equal(w.balanceOf(id), 0, "nothing withdrawable in the real book");
    assert.equal(w.withdraw(id, 100 * BIRR, "w").ok, false);
    const report: any = store.read("walletLegacyReport", null);
    assert.ok(report?.profiles?.[id], "legacy real money listed for manual refund");
    assert.equal(store.read("wallet", null), null, "old key gone");
    assert.equal(new Wallet(store, { mode: "play" }).balanceOf(id), 300 * BIRR);
  });
});

describe("M2: a failed disk write never leaves memory ahead of disk", () => {
  test("FileStore rolls back and throws; the balance is unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-m2-"));
    let fail = false;
    const store = new FileStore(join(dir, "db.json"), { writeFile: (p, t) => { if (fail) throw new Error("disk full"); writeFileSync(p, t); } });
    const wallet = new Wallet(store, { mode: "real", depositHoldMs: 0 });
    const id = "0xabc0000000000000000000000000000000000003";
    wallet.deposit(id, 100 * BIRR, "d1");
    fail = true;
    assert.throws(() => wallet.deposit(id, 50 * BIRR, "d2"));
    assert.equal(wallet.balanceOf(id), 100 * BIRR, "memory rolled back");
    fail = false;
    wallet.deposit(id, 50 * BIRR, "d3");
    assert.equal(wallet.balanceOf(id), 150 * BIRR);
    assert.equal(new FileStore(join(dir, "db.json")).read<any>("wallet:real", null).balances[id], 150 * BIRR, "disk agrees");
  });
});

describe("M1 / L1 / L2: tamper-evident log, reconcile, fee report, capped history", () => {
  test("reconcile is clean after activity; editing the log or a balance is caught", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-m1-"));
    const file = join(dir, "log.jsonl");
    const store = new MemoryStore();
    const wallet = new Wallet(store, { mode: "real", depositHoldMs: 0, log: new FileTxnLog(file) });
    const [a, b] = ["0xabc0000000000000000000000000000000000004", "0xabc0000000000000000000000000000000000005"];
    wallet.deposit(a, 300 * BIRR, "d1");
    wallet.deposit(b, 300 * BIRR, "d2");
    const held = wallet.hold([a, b], 100 * BIRR);
    assert.ok(held.ok);
    wallet.settle(held.escrow.id, { winner: 0, draw: false });
    assert.equal((wallet.reconcile() as any).ok, true);
    assert.equal(wallet.reconcile().chain, "intact");
    // fees can leave only through a logged adjust with a reason
    const fees = wallet.feeReport("real");
    assert.equal(fees.balance, 20 * BIRR);
    assert.equal(wallet.adjust("real", "platform", -20 * BIRR, "", "admin").ok, false, "reason required");
    assert.equal(wallet.adjust("real", "platform", -20 * BIRR, "payout to owner", "admin").ok, true);
    assert.equal(wallet.feeReport("real").adjustments.length, 1);
    assert.equal((wallet.reconcile() as any).ok, true);
    // silent balance edit in the store (no log entry)
    const d: any = store.read("wallet:real", null);
    d.balances[a] += 1_000 * BIRR;
    const r: any = wallet.reconcile();
    assert.equal(r.ok, false);
    assert.equal(r.books.find((x: any) => x.book === "real").mismatches.length, 1);
    d.balances[a] -= 1_000 * BIRR;
    // edit a line of the log file: the chain breaks
    const lines = readFileSync(file, "utf8").trim().split("\n");
    lines[3] = lines[3].replace(/"amount":\d+/, '"amount":1');
    writeFileSync(file, lines.join("\n") + "\n");
    const w2 = new Wallet(store, { mode: "real", depositHoldMs: 0, log: new FileTxnLog(file) });
    assert.notEqual(w2.reconcile().chain, "intact");
    assert.equal((w2.reconcile() as any).ok, false);
  });

  test("L2: game history stays capped while deposits and withdrawals are always kept", () => {
    const store = new MemoryStore();
    const wallet = new Wallet(store, { mode: "play", hotTxns: 10 });
    const [a, b] = ["0xabc0000000000000000000000000000000000006", "0xabc0000000000000000000000000000000000007"];
    wallet.faucet(a);
    wallet.faucet(b);
    for (let i = 0; i < 40; i++) {
      const h = wallet.hold([a, b], 10 * BIRR);
      assert.ok(h.ok);
      wallet.settle(h.escrow.id, { winner: 0, draw: false });
    }
    const d: any = store.read("wallet:play", null);
    assert.ok(d.txns.filter((t: any) => t.profileId === a).length <= 10 + 1, "capped (plus the faucet)");
  });
});

describe("M5: fresh deposits can be staked but not withdrawn for 24 h", () => {
  test("withdraw refused inside the hold, allowed after it; staking is allowed", async () => {
    const clock = { t: Date.now() };
    const wallet = new Wallet(new MemoryStore(), { mode: "real", now: () => clock.t });
    const id = "0xabc0000000000000000000000000000000000008";
    wallet.deposit(id, 100 * BIRR, "d1");
    assert.equal(wallet.withdraw(id, 50 * BIRR, "w1").ok, false);
    clock.t += 23 * 3_600_000;
    assert.equal(wallet.withdraw(id, 50 * BIRR, "w1").ok, false);
    clock.t += 2 * 3_600_000;
    assert.equal(wallet.withdraw(id, 50 * BIRR, "w1").ok, true);
  });
});

// ───────────────────────── Group E: accounts and collusion ─────────────────────────

describe("H7: a stolen session can't cash out", () => {
  test("every withdrawal needs the password; wrong passwords lock out; never-deposited can't withdraw; guests can't", async () => {
    const app = boot();
    const u = await funded(app, 500);
    const no: any = await withdraw(app, u, 100, { password: undefined });
    assert.equal(no.ok, false);
    assert.equal(((await withdraw(app, u, 100, { password: "guess1 guess1" })) as any).ok, false);
    assert.equal(bal(app, u.id), 500 * BIRR);
    const yes: any = await withdraw(app, u, 100);
    assert.equal(yes.ok, true);
    // an account with a password but no deposit can't take out money (only wins, say)
    const win = user(app, "Chala", "Gemechu");
    app.wallet.adjust("real", win.id, 300 * BIRR, "seed winnings", "t");
    assert.equal(((await withdraw(app, win, 100)) as any).ok, false, "no credited deposit -> no payout");
    // lockout: many wrong passwords block even the right one for a minute
    const v = await funded(app, 500, "Dawit", "Haile");
    for (let i = 0; i < 6; i++) await withdraw(app, v, 100, { password: "wrongwrong" + i });
    assert.equal(((await withdraw(app, v, 100)) as any).ok, false, "locked out");
  });

  test("tokens die after 30 days; sign-out and password change drop live sockets", async () => {
    // expiry (identity with a fake clock)
    let now = 1_000_000;
    const id = new Identity(new MemoryStore(), () => now);
    const s = id.signup("Abebe Kebede", { username: "abebe", password: PW });
    assert.ok(id.byToken(s.token));
    now += 29 * 86_400_000;
    assert.ok(id.byToken(s.token));
    now += 2 * 86_400_000;
    assert.equal(id.byToken(s.token), null, "expired");

    // live sockets
    const app = boot();
    await new Promise<void>((r) => app.httpServer.listen(0, r));
    const url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
    const login = async () => (await (await fetch(url + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "abebe_x", password: PW }) })).json()) as any;
    const created: any = await (await fetch(url + "/api/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Abebe Kebede", username: "abebe_x", password: PW }) })).json();
    const t1 = created.token;
    const t2 = (await login()).token;
    const open = (token: string) => new Promise<Socket>((res, rej) => { const k = connect(url, { auth: { token }, transports: ["websocket"], reconnection: false }); k.on("connect", () => res(k)); k.on("connect_error", rej); });
    const [s1, s2] = [await open(t1), await open(t2)];
    let ended1 = false, ended2 = false;
    s1.on("session:ended", () => (ended1 = true));
    s2.on("session:ended", () => (ended2 = true));
    // change password with t1: t2's socket must be cut, t1's stays
    const pr = await fetch(url + "/api/me/password", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t1}` }, body: JSON.stringify({ current: PW, next: "another long pass 1", currentPassword: PW, newPassword: "another long pass 1" }) });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(pr.status, 200, "password change accepted");
    {
      assert.equal(ended2, true, "other device signed out");
      assert.equal(s2.connected, false);
      assert.equal(ended1, false);
      assert.equal(s1.connected, true);
    }
    // sign out t1: its socket is cut, and a stale socket can't act any more
    await fetch(url + "/api/logout", { method: "POST", headers: { authorization: `Bearer ${t1}` } });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(ended1, true);
    assert.equal(s1.connected, false);
    s1.close();
    s2.close();
    app.io.close();
  });
});

describe("H8: anti-collusion limits (default settings, real mode)", () => {
  test("a brand-new account and a guest can't stake real money through the lobby", async () => {
    const app = boot({ noStakeLimitOverride: true });
    const fresh = await funded(app, 500);
    const r: any = app.lobby.createRoom(fresh.id, "dots-and-boxes", 10 * BIRR);
    assert.equal(r.ok, false);
    assert.match(r.reason, /24 hours/);
    const g = guest(app);
    app.wallet.adjust("real", g.profile.id, 100 * BIRR, "seed", "t");
    assert.equal((app.lobby.createRoom(g.profile.id, "dots-and-boxes", 10 * BIRR) as any).ok, false);
  });

  test("pair cap (3/24h), daily cap (1000 birr) and the one-way flow alert", async () => {
    const alerts: string[] = [];
    const app: App & { stakeLimits: StakeLimits } = boot({ limits: { minAccountAgeMs: 0 }, alert: (t) => alerts.push(t) }) as never;
    app.stakeLimits = new StakeLimits(app.wallet, { createdAt: () => 0, hasPassword: () => true, alert: (t) => alerts.push(t) });
    const a = await funded(app, 500);
    const b = await funded(app, 500, "Chala", "Gemechu");
    app.wallet.adjust("real", a.id, 5_000 * BIRR, "float", "t");
    app.wallet.adjust("real", b.id, 5_000 * BIRR, "float", "t");
    const play = (winner: 0 | 1) => {
      const h = app.wallet.hold([a.id, b.id], 10 * BIRR);
      assert.ok(h.ok);
      const e = app.wallet.settle(h.escrow.id, { winner, draw: false })!;
      return app.stakeLimits.afterSettle(e);
    };
    for (let i = 0; i < 3; i++) {
      assert.equal(app.stakeLimits.check([a.id, b.id], 10 * BIRR), null, "match " + i);
      play(0);
    }
    assert.match(app.stakeLimits.check([a.id, b.id], 10 * BIRR)!, /3 staked matches/);
    assert.match(app.stakeLimits.check([b.id, a.id], 10 * BIRR)!, /3 staked matches/);
    // one-way flow (4th match forced by the wallet directly, as a limit-less path would) alerts
    play(0);
    assert.equal(alerts.length, 1, "one-way flow flagged");
    // daily cap by one player across partners
    const c = await funded(app, 500, "Dawit", "Haile");
    app.wallet.adjust("real", c.id, 5_000 * BIRR, "float", "t");
    const h = app.wallet.hold([a.id, c.id], 500 * BIRR);
    assert.ok(h.ok);
    app.wallet.settle(h.escrow.id, { winner: 0, draw: false });
    assert.match(app.stakeLimits.check([a.id], 500 * BIRR)!, /a day/);
  });

  test("the limit is enforced when the second player joins and when ready, not only on create", async () => {
    const app = boot({ limits: { minAccountAgeMs: 0, pairPerDay: 1 } });
    const a = await funded(app, 500);
    const b = await funded(app, 500, "Chala", "Gemechu");
    const room: any = app.lobby.createRoom(a.id, "dots-and-boxes", 10 * BIRR);
    assert.equal(room.ok, true);
    // burn the pair allowance behind the room's back
    const h = app.wallet.hold([a.id, b.id], 10 * BIRR);
    assert.ok(h.ok);
    app.wallet.settle(h.escrow.id, { winner: 0, draw: false });
    const joined: any = app.lobby.joinRoom(b.id, room.room.code);
    assert.equal(joined.ok, false, JSON.stringify(joined));
  });
});

describe("M8: only fair games can be staked", () => {
  test("bingo and tic-tac-toe are refused for stakes (play and real)", async () => {
    const app = boot({ limits: { minAccountAgeMs: 0 } });
    const a = await funded(app, 500);
    for (const g of ["bingo", "tic-tac-toe"]) assert.equal((app.lobby.createRoom(a.id, g, 10 * BIRR) as any).ok, false, g);
    assert.equal((app.lobby.createRoom(a.id, "bingo") as any).ok, true, "unstaked bingo room still fine");
  });
});

// ───────────────────────── Group A: end listeners ─────────────────────────

describe("M7: a throwing end listener can't stop the stake being paid", () => {
  test("settlement happens before any other 'end' listener runs", () => {
    const app = boot();
    const store = app.store;
    void store;
    const [a, b] = ["Alice", "Bob"].map((x) => app.identity.signup(x));
    app.wallet.deposit(a.profile.id, 200 * BIRR, "da");
    app.wallet.deposit(b.profile.id, 200 * BIRR, "db");
    const h = app.wallet.hold([a.profile.id, b.profile.id], 100 * BIRR);
    assert.ok(h.ok);
    const m = app.matches.create({ game: firstToThree, players: [a.profile.id, b.profile.id], durable: true });
    app.wallet.bind(h.escrow.id, m.id);
    app.matches.on("end", () => {
      throw new Error("a later listener blows up");
    });
    app.matches.on("end", () => {});
    // play it out; seat 0 wins
    try {
      while (!m.cur.outcome) {
        const seat: 0 | 1 = (m.cur.state as { turn: 0 | 1 }).turn;
        app.matches.move(m.players[seat], m.id, { type: seat === 0 ? "point" : "pass" });
      }
    } catch {
      /* the throwing listener may surface here; the money must be settled regardless */
    }
    assert.equal(app.wallet.escrow(h.escrow.id)?.status, "settled");
    assert.equal(app.wallet.balanceOf(m.players[0]), 100 * BIRR + 180 * BIRR);
  });
});
