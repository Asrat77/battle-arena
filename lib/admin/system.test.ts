import assert from "node:assert/strict";
import test from "node:test";
import { budgetShare, healthChecks, overall } from "./system";
import type { SystemInfo } from "./types";

const base = (): SystemInfo => ({
  time: 0, uptimeMs: 1000, node: "v22",
  store: { kind: "postgres", pendingWrites: 0, lastError: null },
  database: "ok",
  wallet: { mode: "real", config: {} as SystemInfo["wallet"]["config"], logEntries: 120, chain: "intact" },
  ledger: { blocks: 50, pending: 0 },
  verifyBudget: { used: { day: 10, month: 100 }, limits: { daily: 100, monthly: 1000 } },
  telegram: { configured: true, moderatorChat: true, moderators: 2 },
  deposits: { enabled: true, accounts: 2 },
  withdrawals: { enabled: true, minAmount: 1, perRequest: 1, perDay: 1, secondApprovalAbove: null },
  admin: { liveSessions: 1, auditEntries: 3 },
  counts: { profiles: 1, matches: 1, deposits: 1, withdrawals: 1, tournaments: 1, liveMatches: 0, sockets: 0 },
});

const state = (s: SystemInfo, id: string) => healthChecks(s).find((c) => c.id === id)?.state;

test("a healthy system is all ok", () => {
  assert.equal(overall(healthChecks(base())), "ok");
});

test("storage: failed save and dead database are alerts, unsaved writes a warning", () => {
  const a = base();
  a.store.lastError = "connection reset";
  assert.equal(state(a, "store"), "alert");
  const b = base();
  b.database = "error";
  assert.equal(state(b, "store"), "alert");
  const c = base();
  c.store.pendingWrites = 1;
  assert.equal(state(c, "store"), "warn");
  assert.match(healthChecks(c)[0].text, /^1 write not saved/);
  const d = base();
  d.store.kind = "memory";
  assert.equal(state(d, "store"), "warn");
});

test("a broken wallet chain is an alert", () => {
  const s = base();
  s.wallet.chain = { at: 7, reason: "hash mismatch" };
  assert.equal(state(s, "chain"), "alert");
  assert.equal(overall(healthChecks(s)), "alert");
});

test("telegram matters only when money flows need it", () => {
  const s = base();
  s.telegram = { configured: false, moderatorChat: false, moderators: 0 };
  assert.equal(state(s, "telegram"), "alert");
  s.deposits.enabled = false;
  s.withdrawals.enabled = false;
  assert.equal(state(s, "telegram"), "off");
  const t = base();
  t.telegram.moderators = 0;
  assert.equal(state(t, "telegram"), "warn");
});

test("verify budget thresholds", () => {
  assert.equal(budgetShare(5, null), null);
  assert.equal(budgetShare(5, 10), 0.5);
  const s = base();
  s.verifyBudget = { used: { day: 80, month: 0 }, limits: { daily: 100, monthly: null } };
  assert.equal(state(s, "verify"), "warn");
  s.verifyBudget = { used: { day: 100, month: 0 }, limits: { daily: 100, monthly: null } };
  assert.equal(state(s, "verify"), "alert");
  s.verifyBudget = null;
  assert.equal(state(s, "verify"), "off");
});
