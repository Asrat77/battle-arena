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

function setup(opts: { verify?: VerifyResult; mode?: "play" | "real" } = {}) {
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
    assert.equal(r.withdrawal.alertMessageId, 100);
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

  test("Paid, then a reply with the transaction number, closes it", async () => {
    const { withdrawals, tg, updates } = setup();
    const r = await withdrawals.request("p", { bank: "cbe", account: "1000123456789", amount: 60 * BIRR });
    assert.ok(r.ok);
    await withdrawals.handleUpdate(tap(`paid:${r.withdrawal.id}`));
    const prompt = withdrawals.get(r.withdrawal.id)!.promptMessageId!;
    assert.ok(prompt);
    assert.match(tg.sent().at(-1)!, /Reply to this message/);

    await withdrawals.handleUpdate(reply(prompt, "ft26314abcde"));
    const w = withdrawals.get(r.withdrawal.id)!;
    assert.equal(w.status, "paid");
    assert.equal(w.reference, "FT26314ABCDE");
    assert.equal(w.closedBy, "@mod");
    assert.deepEqual(updates, ["paid"]);
    const edit = tg.calls.find((c) => c.method === "editMessageText")!;
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
    const short = setup({ verify: { state: "verified", amount: 50 * BIRR, currency: "ETB", senderName: null, toUs: true } });
    const r = await short.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    assert.ok(r.ok);
    await short.withdrawals.handleUpdate(tap(`paid:${r.withdrawal.id}`));
    await short.withdrawals.handleUpdate(reply(short.withdrawals.get(r.withdrawal.id)!.promptMessageId!, "CHK1A2B3C4"));
    assert.equal(short.withdrawals.get(r.withdrawal.id)!.status, "pending");
    assert.match(short.tg.sent().at(-1)!, /was 50 birr, not 100/);
    assert.deepEqual(short.verifyCalls[0], { bank: "telebirr", reference: "CHK1A2B3C4", settlementAccount: "0911223344" });

    const good = setup({ verify: { state: "verified", amount: 100 * BIRR, currency: "ETB", senderName: null, toUs: true } });
    const g = await good.withdrawals.request("p", { bank: "telebirr", account: "0911223344", amount: 100 * BIRR });
    assert.ok(g.ok);
    await good.withdrawals.handleUpdate(tap(`paid:${g.withdrawal.id}`));
    await good.withdrawals.handleUpdate(reply(good.withdrawals.get(g.withdrawal.id)!.promptMessageId!, "CHK1A2B3C4"));
    assert.equal(good.withdrawals.get(g.withdrawal.id)!.status, "paid");
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
});
