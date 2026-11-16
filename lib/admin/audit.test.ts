import assert from "node:assert/strict";
import test from "node:test";
import { actionLabel, auditFacts, auditSummary, auditTargetHref, parseAuditFilter } from "./audit";

test("summaries read as one line with money in birr", () => {
  assert.equal(auditSummary({ action: "wallet-adjust", detail: { book: "real", amount: 25000, reason: "Lost deposit restored" } }), "+250.00 ETB · Lost deposit restored");
  assert.equal(auditSummary({ action: "wallet-adjust", detail: { book: "play", amount: -500, reason: "Test chips" } }), "−5.00 play · Test chips");
  assert.equal(auditSummary({ action: "deposit-resolve", detail: { approve: true, amount: 10000, reason: "Receipt checked" } }), "Approved 100.00 ETB · Receipt checked");
  assert.equal(auditSummary({ action: "deposit-resolve", detail: { approve: false, reason: "Wrong payer" } }), "Rejected · Wrong payer");
  assert.equal(auditSummary({ action: "signin-failed" }), "Wrong admin token");
  assert.equal(auditSummary({ action: "signin" }), "");
});

test("targets link to the player, the wallet or the deposit", () => {
  assert.equal(auditTargetHref({ action: "wallet-adjust", target: "abc" }), "/admin/players/abc");
  assert.equal(auditTargetHref({ action: "wallet-adjust", target: "platform" }), "/admin/wallet");
  assert.equal(auditTargetHref({ action: "deposit-resolve", target: "d1" }), "/admin/deposits?tab=all&open=d1");
  assert.equal(auditTargetHref({ action: "signin", target: "x" }), null);
  assert.equal(auditTargetHref({ action: "wallet-adjust" }), null);
});

test("labels, filters and facts", () => {
  assert.equal(actionLabel("wallet-adjust"), "Balance adjusted");
  assert.equal(actionLabel("new-thing"), "New thing");
  assert.equal(parseAuditFilter("failed"), "failed");
  assert.equal(parseAuditFilter("nope"), "all");
  assert.deepEqual(auditFacts({ action: "deposit-resolve", detail: { amount: 5000, profileId: "p1", reason: "", by: null } }), [
    { label: "amount", value: "50.00 ETB" },
    { label: "profile id", value: "p1" },
  ]);
});
