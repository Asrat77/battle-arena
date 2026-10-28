import assert from "node:assert/strict";
import { test } from "node:test";
import { failureSentence, shortHashes } from "./checks";

test("failure sentence names the first failing check by number", () => {
  assert.equal(failureSentence([{ name: "game", ok: true }, { name: "replay", ok: true }]), "");
  assert.equal(
    failureSentence([
      { name: "game", ok: true },
      { name: "replay", ok: true },
      { name: "outcome", ok: true },
      { name: "resultBlock", ok: true },
      { name: "resultHash", ok: false },
      { name: "chain", ok: false },
    ]),
    "Check 5 failed: the result hash differs from the one on the ledger.",
  );
});

test("long hex strings are shortened, short numbers are not", () => {
  const hash = "7c1e09ab".padEnd(60, "0") + "a94b";
  assert.equal(shortHashes(`computed ${hash}, block 42 has ${hash}`), "computed 7c1e…a94b, block 42 has 7c1e…a94b");
  assert.equal(shortHashes("97 blocks linked and signed"), "97 blocks linked and signed");
});
