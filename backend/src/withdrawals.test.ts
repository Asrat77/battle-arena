// Telegram updates are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { VerifyEt, VerifyResult } from "./deposits";
import { MemoryStore } from "./store";
import { BIRR, Wallet } from "./wallet";
import { MIN_WITHDRAWAL, normalizeAccount, Withdrawals, type TelegramApi } from "./withdrawals";

const CHAT = "-100123";

function fakeTelegram() {
  const calls: { method: string; params: any }[] = [];
  let nextId = 100;
  const api: TelegramApi = {
    async call(method, params) {
      calls.push({ method, params });
      return method === "sendMessage" ? { message_id: nextId++ } : true;
    },
  };
  return { api, calls, sent: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.params.text as string) };
}

const T0 = 1_700_000_000_000;
const ok = (over: Partial<Extract<VerifyResult, { state: "verified" }>> = {}): VerifyResult => ({
  state: "verified",
  amount: 100 * BIRR,
  currency: "ETB",
  senderName: "Battle Arena PLC",
  itemStatus: "success",
  paidAt: T0 + 60_000,
  toUs: true,
  ...over,
});

function setup(opts: { verify?: VerifyResult; mode?: "play" | "real"; payoutSenderName?: string } = {}) {
  const store = new MemoryStore();
  const wallet = new Wallet(store, { mode: opts.mode ?? "real" });
  const tg = fakeTelegram();
  const verifyCalls: any[] = [];
  const verifyEt: VerifyEt | null = opts.verify
    ? { verify: async (i) => (verifyCalls.push(i), opts.verify!), status: async () => opts.verify! }
    : null;
  const updates: string[] = [];
  const withdrawals = new Withdrawals(store, wallet, {
    telegram: tg.api,
    moderatorChat: CHAT,
    verifyEt,
    payoutSenderName: opts.payoutSenderName ?? null,
    now: () => T0,
    nameOf: (id) => `Player ${id}`,
    onUpdate: (w) => updates.push(w.status),
  });
  if (wallet.mode === "real") wallet.deposit("p", 300 * BIRR, "dep1");
  return { wallet, withdrawals, tg, verifyCalls, updates };
}

const tap = (data: string, chat = CHAT) => ({ update_id: 1, callback_query: { id: "cb", data, from: { username: "mod" }, message: { chat: { id: chat } } } });
const reply = (to: number, text: string, chat = CHAT) => ({ update_id: 2, message: { chat: { id: chat }, text, from: { username: "mod" }, reply_to_message: { message_id: to } } });

describe("withdrawals", () => {
  test("a request takes the money and alerts moderators with buttons", async () => {
    const { wallet, withdrawals, tg } = setup();
    const r = await withdrawals.request("p", { bank: "telebirr", account: "+251 911 223 344", amount: 100 * BIRR });
    assert.ok(r.ok);
    assert.equal(r.withdrawal.account, "0911223344");
    assert.equal(withdrawals.get(r.withdrawal.id)!.alertMessageId, 100);
    assert.equal(r.withdrawal.cancellable, true);
    assert.equal("alertMessageId" in r.withdrawal, false, "moderator fields stay server-side");
    assert.equal(wallet.balanceOf("p"), 200 * BIRR);
    const alert = tg.calls[0];
    assert.equal(alert.params.chat_id, CHAT);
    assert.match(alert.params.text, /100 birr/);
    assert.match(alert.params.text, /Telebirr 0911223344/);
    assert.match(alert.params.text, /Player p/);
    assert.deepEqual(
      alert.params.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data),
      [`paid:${r.withdrawal.id}`, `reject:${r.withdrawal.id}`],
    );
  });

  test("Paid, then a reply with a verified transaction number, closes it", async () => {
    const { withdrawals, tg, updates } = setup({ verify: ok({ amount: 60 * BIRR }) });
    const r = await withdrawals.request("p", { bank: "cbe", account: "1000123456789", amount: 60 * BIRR });
    assert.ok(r.ok);
    await withdrawals.handleUpdate(tap(`paid:${r.withdrawal.id}`));
    const prompt = withdrawals.get(r.withdrawal.id)!.promptMessageId!;
    assert.ok(prompt);
    assert.match(tg.sent().at(-1)!, /Reply to this message/);

    await withdrawals.handleUpdate(reply(prompt, "ft2631-4abcde"));
    const w = withdrawals.get(r.withdrawal.id)!;
    assert.equal(w.status, "paid");
    assert.equal(w.reference, "FT26314ABCDE");
    assert.equal(w.closedBy, "@mod");
    assert.deepEqual(updates, ["paid"]);
    const edit = tg.calls.filter((c) => c.method === "editMessageText").at(-1)!;
    assert.match(edit.params.text, /Paid by @mod/);
    assert.deepEqual(edit.params.reply_markup.inline_keyboard, []);
  });

  test("Reject refunds the wallet", async () => {
    const { wallet, withdrawals, updates } = setup();
    const r = await withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    assert.ok(r.ok);
    await withdrawals.handleUpdate(tap(`reject:${r.withdrawal.id}`));
    assert.equal(withdrawals.get(r.withdrawal.id)!.status, "rejected");
    assert.equal(wallet.balanceOf("p"), 300 * BIRR);
    assert.deepEqual(updates, ["rejected"]);
    // A second tap does nothing.
    await withdrawals.handleUpdate(tap(`reject:${r.withdrawal.id}`));
    assert.equal(wallet.balanceOf("p"), 300 * BIRR);
  });

  test("updates from any other chat are ignored", async () => {
    const { wallet, withdrawals } = setup();
    const r = await withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    assert.ok(r.ok);
    await withdrawals.handleUpdate(tap(`reject:${r.withdrawal.id}`, "999"));
    assert.equal(withdrawals.get(r.withdrawal.id)!.status, "pending");
    assert.equal(wallet.balanceOf("p"), 200 * BIRR);
  });

  test("with verify.et, the payout must reach the player's account for the full amount", async () => {
    const short = setup({ verify: ok({ amount: 50 * BIRR }) });
    const r = await short.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    assert.ok(r.ok);
    await short.withdrawals.handleUpdate(tap(`paid:${r.withdrawal.id}`));
    await short.withdrawals.handleUpdate(reply(short.withdrawals.get(r.withdrawal.id)!.promptMessageId!, "CHK1A2B3C4"));
    assert.equal(short.withdrawals.get(r.withdrawal.id)!.status, "pending");
    assert.match(short.tg.sent().at(-1)!, /was 50 birr, not 100/);
    assert.deepEqual(short.verifyCalls[0], { bank: "telebirr", reference: "CHK1A2B3C4", settlementAccount: "0911223344" });

    const good = setup({ verify: ok() });
    const g = await good.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    assert.ok(g.ok);
    await good.withdrawals.handleUpdate(tap(`paid:${g.withdrawal.id}`));
    await good.withdrawals.handleUpdate(reply(good.withdrawals.get(g.withdrawal.id)!.promptMessageId!, "CHK1A2B3C4"));
    assert.equal(good.withdrawals.get(g.withdrawal.id)!.status, "paid");
  });

  // H4: payout proof must be this payout, not any old transfer.
  async function payWith(s: ReturnType<typeof setup>, ref: string, amount = 100 * BIRR) {
    const r = await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount });
    assert.ok(r.ok);
    await s.withdrawals.handleUpdate(tap(`paid:${r.withdrawal.id}`));
    await s.withdrawals.handleUpdate(reply(s.withdrawals.get(r.withdrawal.id)!.promptMessageId!, ref));
    return s.withdrawals.get(r.withdrawal.id)!;
  }

  test("a payout number can close only one withdrawal", async () => {
    const s = setup({ verify: ok({ amount: 100 * BIRR }) });
    assert.equal((await payWith(s, "CHK1A2B3C4")).status, "paid");
    const second = await payWith(s, "chk1-a2b3c4");
    assert.equal(second.status, "pending");
    assert.match(s.tg.sent().at(-1)!, /already used for withdrawal/);
  });

  test("a transfer made before the request doesn't count", async () => {
    const s = setup({ verify: ok({ paidAt: T0 - 60 * 60_000 }) });
    const w = await payWith(s, "CHK1A2B3C4");
    assert.equal(w.status, "pending");
    assert.match(s.tg.sent().at(-1)!, /made before the player asked/);
    const noDate = setup({ verify: ok({ paidAt: null }) });
    assert.equal((await payWith(noDate, "CHK1A2B3C4")).status, "pending");
  });

  test("a failed receipt status or a sender other than us doesn't count", async () => {
    const failed = setup({ verify: ok({ itemStatus: "failed" }) });
    assert.equal((await payWith(failed, "CHK1A2B3C4")).status, "pending");
    const other = setup({ verify: ok({ senderName: "Someone Else" }), payoutSenderName: "Battle Arena PLC" });
    assert.equal((await payWith(other, "CHK1A2B3C4")).status, "pending");
    assert.match(other.tg.sent().at(-1)!, /sent by "Someone Else"/);
    const ours = setup({ verify: ok(), payoutSenderName: "Battle Arena PLC" });
    assert.equal((await payWith(ours, "CHK1A2B3C4")).status, "paid");
  });

  test("without verify.et, Paid alone never closes a request", async () => {
    const s = setup();
    const w = await payWith(s, "anything-at-all");
    assert.equal(w.status, "pending");
    assert.match(s.tg.sent().at(-1)!, /verify\.et isn't set up/);
  });

  // H5: a real payout verify.et can't confirm has a way out that isn't a refund.
  test("confirm paid anyway records who and why, and never refunds", async () => {
    const s = setup();
    const w = await payWith(s, "CHK1A2B3C4");
    const force = s.tg.calls.at(-1)!.params.reply_markup.inline_keyboard[0][0];
    assert.equal(force.callback_data, `force:${w.id}`);
    await s.withdrawals.handleUpdate(tap(`force:${w.id}`));
    const prompt = s.withdrawals.get(w.id)!.forcePromptMessageId!;
    await s.withdrawals.handleUpdate(reply(prompt, "ok"));
    assert.equal(s.withdrawals.get(w.id)!.status, "pending", "a reason is required");
    await s.withdrawals.handleUpdate(reply(prompt, "saw it in the telebirr app history"));
    const done = s.withdrawals.get(w.id)!;
    assert.equal(done.status, "paid");
    assert.equal(done.reference, "CHK1A2B3C4");
    assert.deepEqual(done.forced, { by: "@mod", reason: "saw it in the telebirr app history" });
    assert.equal(s.wallet.balanceOf("p"), 200 * BIRR);
    assert.match(s.tg.calls.filter((c) => c.method === "editMessageText").at(-1)!.params.text, /Not checked by verify\.et/);
  });

  test("after a payout number was given, Reject asks again before refunding", async () => {
    const s = setup();
    const w = await payWith(s, "CHK1A2B3C4");
    await s.withdrawals.handleUpdate(tap(`reject:${w.id}`));
    assert.equal(s.withdrawals.get(w.id)!.status, "pending");
    assert.match(s.tg.sent().at(-1)!, /Reject only if NO money was sent/);
    await s.withdrawals.handleUpdate(tap(`reject!:${w.id}`));
    assert.equal(s.withdrawals.get(w.id)!.status, "rejected");
    assert.equal(s.wallet.balanceOf("p"), 300 * BIRR);
  });

  test("the player can cancel until a moderator taps Paid", async () => {
    const s = setup();
    const a = await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    assert.ok(a.ok);
    assert.deepEqual(await s.withdrawals.cancel("someone-else", a.withdrawal.id), { ok: false, reason: "no such withdrawal" });
    assert.deepEqual(await s.withdrawals.cancel("p", a.withdrawal.id), { ok: true });
    assert.equal(s.wallet.balanceOf("p"), 300 * BIRR);
    assert.equal(s.withdrawals.get(a.withdrawal.id)!.status, "cancelled");
    assert.deepEqual(s.updates, ["cancelled"]);
    // Taps on a cancelled request do nothing but say so.
    await s.withdrawals.handleUpdate(tap(`reject:${a.withdrawal.id}`));
    assert.equal(s.wallet.balanceOf("p"), 300 * BIRR);
    assert.match(s.tg.sent().at(-1)!, /cancelled by the player/);

    const b = await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    assert.ok(b.ok, "a new request is allowed after cancelling");
    await s.withdrawals.handleUpdate(tap(`paid:${b.withdrawal.id}`));
    assert.deepEqual(await s.withdrawals.cancel("p", b.withdrawal.id), { ok: false, reason: "a moderator is already sending it" });
    assert.equal(s.withdrawals.forPlayer("p")[0].cancellable, false);
  });

  test("refuses bad input, a short balance, a second open request, and play mode", async () => {
    const { withdrawals } = setup();
    assert.equal((await withdrawals.request("p", { bank: "boa", account: "1", amount: 100 * BIRR })).ok, false);
    assert.equal((await withdrawals.request("p", { bank: "telebirr", account: "12345", amount: 100 * BIRR })).ok, false);
    assert.equal((await withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: MIN_WITHDRAWAL - 1 })).ok, false);
    assert.deepEqual(await withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 1_000 * BIRR }), {
      ok: false,
      reason: "insufficient balance",
    });
    assert.ok((await withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 50 * BIRR })).ok);
    assert.deepEqual(await withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 50 * BIRR }), {
      ok: false,
      reason: "you already have a withdrawal waiting",
    });
    assert.deepEqual(await setup({ mode: "play" }).withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 50 * BIRR }), {
      ok: false,
      reason: "withdrawals are off",
    });
  });

  test("/pending lists open requests", async () => {
    const { withdrawals, tg } = setup();
    await withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 70 * BIRR });
    await withdrawals.handleUpdate({ update_id: 3, message: { chat: { id: CHAT }, text: "/pending" } });
    assert.match(tg.sent().at(-1)!, /70 birr/);
  });

  test("normalizeAccount", () => {
    assert.equal(normalizeAccount("telebirr", "0911-22-33-44"), "0911223344");
    assert.equal(normalizeAccount("telebirr", "251711223344"), "0711223344");
    assert.equal(normalizeAccount("telebirr", "0811223344"), null);
    assert.equal(normalizeAccount("cbe", "1000 1234 56789"), "1000123456789");
    assert.equal(normalizeAccount("cbe", "123"), null);
  });
  test("other moderator buttons (deposit reviews) are passed on, not taken as withdrawal taps", async () => {
    const store = new MemoryStore();
    const wallet = new Wallet(store, { mode: "real" });
    const seen: any[] = [];
    const withdrawals = new Withdrawals(store, wallet, {
      telegram: fakeTelegram().api,
      moderatorChat: CHAT,
      alsoHandle: async (u) => void seen.push(u),
    });
    await withdrawals.handleUpdate(tap("dep-ok:abc"));
    await withdrawals.handleUpdate(tap("dep-ok:abc", "-999"));
    assert.equal(seen.length, 1, "only updates from the moderators' chat");
  });
});
