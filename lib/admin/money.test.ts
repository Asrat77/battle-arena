import assert from "node:assert/strict";
import { test } from "node:test";
import { toCsv } from "./csv";
import {
  TXN_CSV_COLUMNS,
  addisDayEnd,
  addisDayStart,
  addisToday,
  balanceAfter,
  confirmMatches,
  feeDays,
  ledgerFilename,
  ledgerFiltered,
  ledgerQuery,
  legacyReason,
  legacyRows,
  liabilities,
  nameMatch,
  oldest,
  parseBirr,
  parseLedgerParams,
  pickTab,
  plainBirr,
  reasonError,
  reconcileSummary,
  signedAmount,
  waitBucket,
  DEPOSIT_TABS,
  HOUR,
} from "./money";
import type { TxnRow } from "./types";

const ok = (raw: string) => {
  const r = parseBirr(raw);
  assert.ok(r.ok, `${raw} should parse`);
  return r.santim;
};
const bad = (raw: string) => {
  const r = parseBirr(raw);
  assert.equal(r.ok, false, `${raw} should be refused`);
  return r.ok ? "" : r.error;
};

test("parseBirr turns birr text into whole santim", () => {
  assert.equal(ok("12.5"), 1250);
  assert.equal(ok("12.50"), 1250);
  assert.equal(ok("250"), 25000);
  assert.equal(ok("0.01"), 1);
  assert.equal(ok("  7.05 "), 705);
  assert.equal(ok("007"), 700);
  // Floating point would make 0.29 * 100 = 28.999…; integer maths does not.
  assert.equal(ok("0.29"), 29);
  assert.equal(ok("999999.99"), 99_999_999);
});

test("parseBirr refuses anything that is not a plain positive amount", () => {
  for (const raw of ["", "   ", "abc", "1.234", "-5", "+5", "1e3", "0", "0.00", "1,000", "12.", ".5x", "1 000", "NaN", "Infinity", "0x10"]) bad(raw);
  assert.match(bad("1.234"), /2 decimals/);
  assert.match(bad("-5"), /without a sign/);
  assert.match(bad("0.00"), /more than 0/);
});

test("parseBirr refuses more than 1,000,000 birr with a clear message", () => {
  assert.equal(ok("1000000"), 100_000_000);
  assert.match(bad("1000000.01"), /1,000,000 birr/);
  assert.match(bad("99999999"), /1,000,000 birr/);
});

test("plainBirr and confirmMatches", () => {
  assert.equal(plainBirr(25000), "250.00");
  assert.equal(plainBirr(1250), "12.50");
  assert.equal(plainBirr(7), "0.07");
  assert.ok(confirmMatches("250", 25000));
  assert.ok(confirmMatches("250.00", 25000));
  assert.ok(confirmMatches(" 250.00 ", 25000));
  assert.ok(!confirmMatches("250.0", 25000));
  assert.ok(!confirmMatches("2,50", 25000));
  assert.ok(!confirmMatches("251", 25000));
  assert.ok(confirmMatches("12.5", 1250));
  assert.ok(confirmMatches("12.50", 1250));
  assert.ok(!confirmMatches("12", 1250));
  assert.ok(confirmMatches("0.07", 7));
  assert.ok(!confirmMatches("", 25000));
  assert.ok(!confirmMatches("0", 0));
  assert.ok(!confirmMatches("-250", -25000));
});

test("signedAmount and balanceAfter", () => {
  assert.equal(signedAmount(500, "credit"), 500);
  assert.equal(signedAmount(500, "debit"), -500);
  assert.equal(balanceAfter(1000, 250, "credit"), 1250);
  assert.equal(balanceAfter(1000, 250, "debit"), 750);
  assert.equal(balanceAfter(100, 250, "debit"), -150);
});

test("reasonError counts trimmed characters", () => {
  assert.match(reasonError("too short")!, /at least 10/);
  assert.match(reasonError("   abc     ")!, /3 so far/);
  assert.equal(reasonError("Refund for ticket 42"), null);
  assert.match(reasonError("x".repeat(501))!, /500/);
  assert.equal(reasonError("abcde", 5, 300), null);
});

test("nameMatch compares words, case and order free", () => {
  assert.equal(nameMatch("Abebe Kebede", "ABEBE kebede"), "same");
  assert.equal(nameMatch("Abebe Kebede", "Kebede, Abebe"), "same");
  assert.equal(nameMatch("Abebe Kebede", "Abebe Kebede Tesfaye"), "partial");
  assert.equal(nameMatch("Abebe Kebede", "Almaz Kebede"), "different");
  assert.equal(nameMatch(null, "Abebe"), "unknown");
  assert.equal(nameMatch("  ", "Abebe"), "unknown");
  assert.equal(nameMatch("ሰላም ታደሰ", "ሰላም ታደሰ"), "same");
});

test("waitBucket: amber after 1 h, red after 6 h", () => {
  assert.equal(waitBucket(0), "ok");
  assert.equal(waitBucket(HOUR - 1), "ok");
  assert.equal(waitBucket(HOUR), "amber");
  assert.equal(waitBucket(6 * HOUR - 1), "amber");
  assert.equal(waitBucket(6 * HOUR), "red");
  assert.equal(oldest([]), null);
  assert.equal(oldest([{ createdAt: 5 }, { createdAt: 2 }, { createdAt: 9 }]), 2);
});

test("feeDays zero-fills 30 UTC days ending today", () => {
  const now = Date.UTC(2026, 10, 16, 1, 0); // 16 Nov 01:00 UTC
  const days = feeDays({ "2026-11-16": { fees: 300, matches: 2 }, "2026-10-17": { fees: 100, matches: 1 }, "2026-10-16": { fees: 9, matches: 9 } }, now);
  assert.equal(days.length, 30);
  assert.equal(days[0].day, "2026-10-18");
  assert.equal(days[29].day, "2026-11-16");
  assert.deepEqual(days[29], { day: "2026-11-16", fees: 300, matches: 2 });
  assert.equal(days.reduce((s, d) => s + d.fees, 0), 300, "days outside the window are left out");
  assert.equal(feeDays(null, now, 3).map((d) => d.fees).join(), "0,0,0");
});

test("reconcileSummary", () => {
  const book = (b: "real" | "play", mism = 0, esc = 0) => ({
    book: b,
    ok: mism + esc === 0,
    txns: 1,
    total: 0,
    held: 0,
    mismatches: Array.from({ length: mism }, (_, i) => ({ profileId: `p${i}`, stored: 1, logged: 2 })),
    escrows: Array.from({ length: esc }, (_, i) => ({ id: `e${i}`, status: "held", off: 5 })),
  });
  const good = reconcileSummary({ ok: true, chain: "intact", books: [book("play"), book("real")] });
  assert.equal(good.ok, true);
  assert.equal(good.headline, "Books balance");
  assert.deepEqual(good.problems, []);
  const off = reconcileSummary({ ok: false, chain: { at: 12, reason: "hash mismatch" }, books: [book("play"), book("real", 2, 1)] });
  assert.equal(off.ok, false);
  assert.equal(off.headline, "Books do not balance");
  assert.equal(off.mismatches, 2);
  assert.equal(off.escrowProblems, 1);
  assert.deepEqual(off.problems, ["The log's hash chain breaks at entry 12: hash mismatch", "Real money: 2 balances differ from the log", "Real money: 1 escrow doesn't add up"]);
});

test("legacyRows reads the stored report and is safe on odd shapes", () => {
  const r = legacyRows({
    migratedAt: 99,
    profiles: { a: { deposited: 20000, withdrawn: 5000, refunded: 0, balance: 15000 }, b: { deposited: 50000, withdrawn: 10000, refunded: 1000, balance: 0 }, c: "junk" },
  });
  assert.equal(r.migratedAt, 99);
  assert.deepEqual(
    r.rows.map((x) => [x.profileId, x.netIn]),
    [
      ["b", 41000],
      ["a", 15000],
      ["c", 0],
    ],
  );
  assert.equal(legacyReason(r.rows[1]), "Legacy real money from before the book split: deposited 200.00, withdrawn 50.00, refunded 0.00 birr.");
  assert.ok(/legacy/i.test(legacyReason(r.rows[1])) && legacyReason(r.rows[1]).length >= 10);
  assert.deepEqual(legacyRows(null), { migratedAt: null, rows: [] });
  assert.deepEqual(legacyRows("x"), { migratedAt: null, rows: [] });
});

test("liabilities: money in from outside vs where it sits", () => {
  const l = liabilities({
    playerBalances: 7000,
    platformBalance: 500,
    heldInEscrow: 2000,
    deposits: { amount: 10000 },
    withdrawals: { paid: { amount: 1000 }, pending: { amount: 500 } },
    adjustments: { net: 1000 },
  });
  assert.deepEqual(l, { cameIn: 10000, heldNow: 10000, difference: 0 });
});

test("addis days map to UTC ms (UTC+3)", () => {
  assert.equal(addisDayStart("2026-11-15"), Date.UTC(2026, 10, 14, 21));
  assert.equal(addisDayEnd("2026-11-15"), Date.UTC(2026, 10, 15, 21) - 1);
  assert.equal(addisDayStart("2026-02-30"), null);
  assert.equal(addisDayStart("15/11/2026"), null);
  assert.equal(addisToday(Date.UTC(2026, 10, 15, 22)), "2026-11-16");
  assert.equal(addisToday(Date.UTC(2026, 10, 15, 20)), "2026-11-15");
});

test("parseLedgerParams and ledgerQuery", () => {
  const p = parseLedgerParams((k) => ({ tab: "adjustments", kind: "fee,adjust,bogus,fee", profileId: " platform ", from: "2026-11-01", to: "nope", q: "abc", page: "3", status: "held" })[k] ?? null);
  assert.deepEqual(p, { tab: "adjustments", kinds: ["fee", "adjust"], profileId: "platform", from: "2026-11-01", to: "", q: "abc", status: "held", page: 2 });
  assert.deepEqual(ledgerQuery(p, "real"), { book: "real", kind: "adjust", profileId: "platform", from: Date.UTC(2026, 9, 31, 21), q: "abc" });
  const d = parseLedgerParams(() => null);
  assert.equal(d.tab, "transactions");
  assert.equal(d.page, 0);
  assert.equal(d.status, "all");
  assert.deepEqual(ledgerQuery({ ...d, kinds: ["win", "fee"], to: "2026-11-15" }, "play"), { book: "play", kind: "win,fee", to: Date.UTC(2026, 10, 15, 21) - 1 });
  assert.equal(ledgerFiltered(d), false);
  assert.equal(ledgerFiltered({ ...d, from: "2026-11-01" }), true);
});

test("ledger CSV rows and filename", () => {
  const row: TxnRow = { seq: 4, ts: Date.UTC(2026, 10, 15), book: "real", id: "t1", profileId: "platform", name: "Platform", username: null, kind: "adjust", amount: -12345, balance: 100, ref: null, note: "=fees out", by: "admin:Asrat" };
  const csv = toCsv([row], TXN_CSV_COLUMNS);
  const line = csv.split("\r\n")[1];
  assert.equal(line, "2026-11-15T00:00:00.000Z,4,real,t1,platform,Platform,,adjust,-123.45,1,,'=fees out,admin:Asrat");
  const now = Date.UTC(2026, 10, 16);
  assert.equal(ledgerFilename({ tab: "transactions", kinds: [], profileId: "", from: "", to: "", q: "" }, "real", now), "ledger-real-2026-11-16.csv");
  assert.equal(ledgerFilename({ tab: "adjustments", kinds: ["win"], profileId: "abc", from: "2026-11-01", to: "", q: "x" }, "play", now), "ledger-play-2026-11-16-adjust-player-2026-11-01_to_now-search.csv");
});

test("pickTab defaults to the queue while it has rows", () => {
  assert.equal(pickTab("credited", DEPOSIT_TABS, "review", 3), "credited");
  assert.equal(pickTab(null, DEPOSIT_TABS, "review", 3), "review");
  assert.equal(pickTab(null, DEPOSIT_TABS, "review", null), "review");
  assert.equal(pickTab(null, DEPOSIT_TABS, "review", 0), "all");
  assert.equal(pickTab("bogus", DEPOSIT_TABS, "review", 0), "all");
});
