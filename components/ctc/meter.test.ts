import assert from "node:assert/strict";
import { test } from "node:test";
import { meterText } from "./Meter";

test("meter text reads exact and other-spot digits", () => {
  assert.equal(meterText(0, 0), "No digits in the code");
  assert.equal(meterText(1, 3), "1 in the right spot, 2 more in the code");
  assert.equal(meterText(0, 2), "2 in the code");
  assert.equal(meterText(2, 2), "2 in the right spot");
  assert.equal(meterText(4, 4), "All 4 in the right spot");
});
