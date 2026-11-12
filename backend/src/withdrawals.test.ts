// Telegram updates are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { VerifyEt, VerifyResult } from "./deposits";
import { moderatorList } from "./moderators";
import { MemoryStore } from "./store";
import { BIRR, Wallet } from "./wallet";
import {
  MIN_WITHDRAWAL,
  normalizeAccount,
  SECOND_APPROVAL_ABOVE,
  secondApprovalFromEnv,
  WITHDRAWAL_LIMITS,
  withdrawalLimitsFromEnv,
  Withdrawals,
  type TelegramApi,
} from "./withdrawals";

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

function setup(
  opts: { verify?: VerifyResult; mode?: "play" | "real"; payoutSenderName?: string; secondApprovalAbove?: number | null; mods?: string; limits?: Partial<typeof WITHDRAWAL_LIMITS>; store?: MemoryStore; now?: () => number } = {},
) {
  const store = opts.store ?? new MemoryStore();
  const wallet = new Wallet(store, { mode: opts.mode ?? "real", depositHoldMs: 0 });
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
    moderators: moderatorList(opts.mods ?? "1,2", CHAT),
    secondApprovalAbove: opts.secondApprovalAbove === undefined ? null : opts.secondApprovalAbove,
    now: opts.now ?? (() => T0),
    limits: opts.limits,
    nameOf: (id) => `Player ${id}`,
    onUpdate: (w) => updates.push(w.status),
  });
  if (wallet.mode === "real") wallet.deposit("p", 300 * BIRR, "dep1");
  return { wallet, withdrawals, tg, verifyCalls, updates, store };
}

const tap = (data: string, chat = CHAT, from = 1) => ({ update_id: 1, callback_query: { id: "cb", data, from: { id: from, username: from === 1 ? "mod" : `mod${from}` }, message: { chat: { id: chat } } } });
const reply = (to: number, text: string, chat = CHAT, from = 1) => ({
  update_id: 2,
  message: { chat: { id: chat }, text, from: { id: from, username: from === 1 ? "mod" : `mod${from}` }, reply_to_message: { message_id: to } },
});

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
    await withdrawals.handleUpdate({ update_id: 3, message: { chat: { id: CHAT }, from: { id: 1 }, text: "/pending" } });
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
    const wallet = new Wallet(store, { mode: "real", depositHoldMs: 0 });
    const seen: any[] = [];
    const withdrawals = new Withdrawals(store, wallet, {
      telegram: fakeTelegram().api,
      moderatorChat: CHAT,
      moderators: moderatorList("1", CHAT),
      alsoHandle: async (u) => void seen.push(u),
    });
    await withdrawals.handleUpdate(tap("dep-ok:abc"));
    await withdrawals.handleUpdate(tap("dep-ok:abc", "-999"));
    await withdrawals.handleUpdate(tap("dep-ok:abc", CHAT, 666));
    assert.equal(seen.length, 1, "only updates from listed moderators in the moderators' chat");
  });

  // M3: only listed moderators act, and big payouts need two of them.
  test("someone in the chat but not on the moderator list can't pay, reject or approve", async () => {
    const s = setup({ verify: ok() });
    const r = await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    assert.ok(r.ok);
    await s.withdrawals.handleUpdate(tap(`reject:${r.withdrawal.id}`, CHAT, 666));
    await s.withdrawals.handleUpdate(tap(`paid:${r.withdrawal.id}`, CHAT, 666));
    const w = s.withdrawals.get(r.withdrawal.id)!;
    assert.equal(w.status, "pending");
    assert.equal(w.pickedUpBy ?? null, null);
    assert.equal(s.wallet.balanceOf("p"), 200 * BIRR);
    assert.match(s.tg.calls.at(-1)!.params.text, /not on the moderator list/);
    // A listed moderator's prompt can't be answered by an outsider either.
    await s.withdrawals.handleUpdate(tap(`paid:${r.withdrawal.id}`));
    await s.withdrawals.handleUpdate(reply(s.withdrawals.get(r.withdrawal.id)!.promptMessageId!, "CHK1A2B3C4", CHAT, 666));
    assert.equal(s.withdrawals.get(r.withdrawal.id)!.status, "pending");
  });

  test("moderatorList: an explicit list, a one-to-one chat owner, or nobody in a group", () => {
    assert.ok(moderatorList("11, 22", "-100").allows(22));
    assert.ok(!moderatorList("11, 22", "-100").allows(33));
    assert.ok(moderatorList("", "5551").allows("5551"));
    assert.equal(moderatorList(undefined, "-100").count, 0);
    assert.ok(!moderatorList(undefined, "-100").allows(undefined));
  });

  test("above the limit, a second, different moderator must approve the payout", async () => {
    const s = setup({ verify: ok({ amount: 250 * BIRR }), secondApprovalAbove: 200 * BIRR });
    const w = await payWith(s, "CHK1A2B3C4", 250 * BIRR);
    assert.equal(w.status, "pending");
    assert.equal(w.approval!.by, "@mod");
    const approve = s.tg.calls.at(-1)!.params.reply_markup.inline_keyboard[0][0];
    assert.equal(approve.callback_data, `approve:${w.id}`);
    await s.withdrawals.handleUpdate(tap(`approve:${w.id}`, CHAT, 1));
    assert.equal(s.withdrawals.get(w.id)!.status, "pending", "the same moderator can't approve twice");
    assert.match(s.tg.sent().at(-1)!, /needs a different moderator/);
    await s.withdrawals.handleUpdate(tap(`approve:${w.id}`, CHAT, 2));
    const done = s.withdrawals.get(w.id)!;
    assert.equal(done.status, "paid");
    assert.equal(done.reference, "CHK1A2B3C4");
    assert.equal(done.closedBy, "@mod + @mod2");
    // Below the limit one moderator is enough.
    const small = setup({ verify: ok(), secondApprovalAbove: 200 * BIRR });
    assert.equal((await payWith(small, "CHK9Z8Y7X6")).status, "paid");
  });

  test("forced confirmations above the limit also need a second moderator", async () => {
    const s = setup({ secondApprovalAbove: 50 * BIRR, mods: "1" });
    const w = await payWith(s, "CHK1A2B3C4");
    await s.withdrawals.handleUpdate(tap(`force:${w.id}`));
    await s.withdrawals.handleUpdate(reply(s.withdrawals.get(w.id)!.forcePromptMessageId!, "checked the app history"));
    const waiting = s.withdrawals.get(w.id)!;
    assert.equal(waiting.status, "pending");
    assert.deepEqual(waiting.approval!.forced, { by: "@mod", reason: "checked the app history" });
    assert.match(s.tg.sent().at(-1)!, /Only one moderator is on TELEGRAM_MODERATORS/);
    // Reject still asks first, since a number was given.
    await s.withdrawals.handleUpdate(tap(`reject:${w.id}`));
    assert.equal(s.withdrawals.get(w.id)!.status, "pending");
  });

  test("secondApprovalFromEnv", () => {
    assert.equal(secondApprovalFromEnv(undefined), SECOND_APPROVAL_ABOVE);
    assert.equal(secondApprovalFromEnv("off"), null);
    assert.equal(secondApprovalFromEnv("2500"), 2500 * BIRR);
    assert.equal(secondApprovalFromEnv("nonsense"), SECOND_APPROVAL_ABOVE);
  });

  // L3: ceilings.
  test("one request and one day's requests have ceilings", async () => {
    let t = T0;
    const s = setup({ limits: { perRequest: 150 * BIRR, perDay: 250 * BIRR }, now: () => t });
    s.wallet.deposit("p", 1_000 * BIRR, "dep2");
    assert.match((await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 200 * BIRR }) as any).reason, /at once is 150 birr/);
    const a = await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 150 * BIRR });
    assert.ok(a.ok);
    await s.withdrawals.handleUpdate(tap(`paid:${a.withdrawal.id}`));
    // Rejected (refunded), so a second request is allowed.
    await s.withdrawals.handleUpdate(tap(`reject:${a.withdrawal.id}`));
    const b = await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 150 * BIRR });
    assert.ok(b.ok, "a returned request doesn't count toward the day");
    await s.withdrawals.cancel("p", b.withdrawal.id);
    assert.ok(s.withdrawals.summary("p").maxAmount === 150 * BIRR);
    const c = await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 150 * BIRR });
    assert.ok(c.ok);
    // c is still open, so it counts: 150 of 250 used today. Once paid it still counts until 24 hours have passed.
    assert.equal(s.withdrawals.summary("p").maxAmount, 100 * BIRR);
    s.store.write("withdrawals", s.store.read<any[]>("withdrawals", []).map((w) => (w.id === c.withdrawal.id ? { ...w, status: "paid" } : w)));
    assert.match((await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 150 * BIRR }) as any).reason, /250 birr a day; 100 birr left/);
    t += 24 * 60 * 60_000 + 1;
    assert.ok((await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 150 * BIRR })).ok, "a day later it's open again");
    assert.deepEqual(withdrawalLimitsFromEnv({ WITHDRAWAL_MAX_BIRR: "300", WITHDRAWAL_DAILY_MAX_BIRR: "x" }), { perRequest: 300 * BIRR });
  });

  // L4: a crash between the two writes loses nothing and pays nothing twice.
  test("recover drops a request that was never debited and refunds a closed one that wasn't", async () => {
    const store = new MemoryStore();
    const s = setup({ store });
    const a = await s.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    const b = await s.withdrawals.request("q", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    assert.ok(a.ok);
    assert.equal(b.ok, false, "q has no money");
    assert.equal(s.withdrawals.forPlayer("q").length, 0, "a refused debit leaves no request behind");
    const list = store.read<any[]>("withdrawals", []);
    // Simulate the two crashes: a saved request with no debit, and a cancel with no refund.
    list.push({ ...list[0], id: "nodebit1", profileId: "q" });
    list[0].status = "cancelled";
    store.write("withdrawals", list);
    assert.equal(s.wallet.balanceOf("p"), 200 * BIRR);

    const after = setup({ store });
    after.withdrawals.recover();
    assert.equal(after.withdrawals.get("nodebit1"), null);
    // 200 left after the request, +300 from the second setup's deposit, +100 missing refund.
    assert.equal(after.wallet.balanceOf("p"), 600 * BIRR);
    after.withdrawals.recover();
    assert.equal(after.wallet.txnFor("withdrawal-refund", a.withdrawal.id)!.amount, 100 * BIRR);
    assert.equal(store.read<any>("wallet:real", {}).txns.filter((t: any) => t.kind === "withdrawal-refund").length, 1, "recover is idempotent");
  });
});

test("the withdraw form's limit leaves out deposits still on hold (audit M5)", async () => {
  const store = new MemoryStore();
  const wallet = new Wallet(store, { mode: "real", now: () => T0 });
  const withdrawals = new Withdrawals(store, wallet, {
    telegram: fakeTelegram().api,
    moderatorChat: CHAT,
    verifyEt: null,
    moderators: moderatorList("1", CHAT),
    now: () => T0,
    nameOf: (id) => id,
  });
  wallet.deposit("p", 300 * BIRR, "dep1");
  const s = withdrawals.summary("p");
  assert.equal(s.maxAmount, 0);
  assert.equal(s.held, 300 * BIRR);
  const r = await withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /24 hours after they arrive/);
  assert.deepEqual(withdrawals.summary("p").requests, [], "the refused request is not kept");
  assert.equal(wallet.balanceOf("p"), 300 * BIRR);
});

// Audit H7: a stolen session alone can't cash out.
describe("withdrawals need the password and go to the depositor's name", () => {
  function guarded(verify?: VerifyResult, payer: { name: string; locked: boolean } | null = { name: "Abebe Bikila", locked: true }) {
    const store = new MemoryStore();
    const wallet = new Wallet(store, { mode: "real", depositHoldMs: 0 });
    const tg = fakeTelegram();
    const withdrawals = new Withdrawals(store, wallet, {
      telegram: tg.api,
      moderatorChat: CHAT,
      verifyEt: verify ? { verify: async () => verify, status: async () => verify } : null,
      moderators: moderatorList("1,2", CHAT),
      secondApprovalAbove: null,
      now: () => T0,
      confirmPassword: (_id, pw) => (pw === "right pass" ? { ok: true } : { ok: false, reason: "wrong password" }),
      payer: () => payer,
    });
    wallet.deposit("p", 300 * BIRR, "dep1");
    return { withdrawals, wallet, tg };
  }
  const ask = { bank: "telebirr", account: "0911223344", amount: 100 * BIRR };

  test("wrong or missing password: refused, nothing taken", async () => {
    const { withdrawals, wallet } = guarded();
    assert.deepEqual(await withdrawals.request("p", ask), { ok: false, reason: "wrong password" });
    assert.deepEqual(await withdrawals.request("p", { ...ask, password: "nope" }), { ok: false, reason: "wrong password" });
    assert.equal(wallet.balanceOf("p"), 300 * BIRR);
    assert.ok((await withdrawals.request("p", { ...ask, password: "right pass" })).ok);
  });

  test("no credited deposit yet (no locked payer name): refused", async () => {
    for (const payer of [null, { name: "Abebe Bikila", locked: false }]) {
      const { withdrawals } = guarded(undefined, payer);
      const r = await withdrawals.request("p", { ...ask, password: "right pass" });
      assert.equal(r.ok, false);
      assert.match((r as { reason: string }).reason, /make a deposit first/);
    }
  });

  test("the alert names the account holder, and a payout to another name isn't confirmed", async () => {
    const { withdrawals, tg } = guarded(ok({ receiverName: "Kebede Thief" }));
    const r = await withdrawals.request("p", { ...ask, password: "right pass" });
    assert.ok(r.ok);
    assert.match(tg.sent()[0], /Account holder must be: Abebe Bikila/);
    await withdrawals.handleUpdate(tap(`paid:${r.withdrawal.id}`));
    const prompt = tg.calls.filter((c) => c.method === "sendMessage").length + 99;
    await withdrawals.handleUpdate(reply(prompt, "CH12ABC345"));
    assert.equal(withdrawals.get(r.withdrawal.id)!.status, "pending");
    assert.match(tg.sent().at(-1)!, /paid to "Kebede Thief", not Abebe Bikila/);
  });

  test("a receipt without a receiver name isn't confirmed; the right name is", async () => {
    const missing = guarded(ok({ receiverName: null }));
    const r1 = await missing.withdrawals.request("p", { ...ask, password: "right pass" });
    assert.ok(r1.ok);
    await missing.withdrawals.handleUpdate(tap(`paid:${r1.withdrawal.id}`));
    await missing.withdrawals.handleUpdate(reply(101, "CH12ABC345"));
    assert.match(missing.tg.sent().at(-1)!, /doesn't show who received it/);

    const right = guarded(ok({ receiverName: "ABEBE BIKILA TESFAYE" }));
    const r2 = await right.withdrawals.request("p", { ...ask, password: "right pass" });
    assert.ok(r2.ok);
    await right.withdrawals.handleUpdate(tap(`paid:${r2.withdrawal.id}`));
    await right.withdrawals.handleUpdate(reply(101, "CH12ABC345"));
    assert.equal(right.withdrawals.get(r2.withdrawal.id)!.status, "paid");
  });
});
