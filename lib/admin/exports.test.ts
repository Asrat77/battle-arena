import assert from "node:assert/strict";
import test from "node:test";
import { toCsv } from "./csv";
import { AUDIT_CSV_COLUMNS, DEPOSIT_CSV_COLUMNS, exportFilename } from "./exports";
import type { AdminDeposit, AuditEntry } from "./types";

test("export file names carry the filters and the day", () => {
  const at = Date.UTC(2026, 10, 16, 12);
  assert.equal(exportFilename("deposits", ["review"], at), "deposits-review-2026-11-16.csv");
  assert.equal(exportFilename("audit", [null, false, "Wallet adjust"], at), "audit-wallet-adjust-2026-11-16.csv");
  assert.equal(exportFilename("withdrawals", [], at), "withdrawals-2026-11-16.csv");
});

test("a deposit exports birr as numbers and keeps formula-looking names safe", () => {
  const d = {
    id: "d1", profileId: "p1", bank: "telebirr", reference: "ABC123", status: "credited", amount: 25050, reason: null, createdAt: 0, closedAt: null,
    payerName: "=cmd()", player: { id: "p1", name: "Abel", username: "abel" },
  } as unknown as AdminDeposit;
  const csv = toCsv([d], DEPOSIT_CSV_COLUMNS);
  assert.match(csv, /250\.5/);
  assert.match(csv, /'=cmd\(\)/);
  assert.equal(csv.split("\r\n")[0].split(",")[0], "deposit id");
});

test("an audit row exports its detail as one JSON cell", () => {
  const e: AuditEntry = { id: "a1", ts: 0, actor: "Asrat", action: "wallet-adjust", target: "p1", detail: { amount: 100, reason: "fix, typo" }, ip: "1.2.3.4" };
  const csv = toCsv([e], AUDIT_CSV_COLUMNS);
  assert.ok(csv.includes('"{""amount"":100,""reason"":""fix, typo""}"'));
});
