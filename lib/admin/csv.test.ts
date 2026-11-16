import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, toCsv } from "./csv";

test("cells are quoted only when needed", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("two\nlines"), '"two\nlines"');
  assert.equal(csvCell(" padded"), '" padded"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(12.5), "12.5");
  assert.equal(csvCell(-3), "-3");
  assert.equal(csvCell(Number.NaN), "");
  assert.equal(csvCell(true), "true");
  assert.equal(csvCell("አበበ"), "አበበ");
});

test("text that looks like a formula is defused", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("+1+1"), "'+1+1");
  assert.equal(csvCell("-2"), "'-2");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("\tcmd"), "'\tcmd");
  assert.equal(csvCell("a=b"), "a=b");
});

test("rows become CSV with a header line", () => {
  const rows = [
    { name: "Abebe, K", amount: 1250 },
    { name: "=evil", amount: -5 },
  ];
  const csv = toCsv(rows, [
    { header: "Name", value: (r) => r.name },
    { header: "Amount (ETB)", value: (r) => r.amount / 100 },
  ]);
  assert.equal(csv, 'Name,Amount (ETB)\r\n"Abebe, K",12.5\r\n\'=evil,-0.05\r\n');
  assert.equal(toCsv([], [{ header: "x", value: () => 1 }]), "x\r\n");
});
