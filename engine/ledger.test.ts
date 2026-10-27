import assert from "node:assert/strict";
import { test } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { type Block, type BlockKind, GENESIS_PREV_HASH, sealBlock, verifyChain } from "./ledger";

const privateKey = bytesToHex(secp256k1.utils.randomPrivateKey());
const publicKey = bytesToHex(secp256k1.getPublicKey(privateKey));

function buildChain(n: number): Block[] {
  const kinds: BlockKind[] = ["commit", "result", "badge", "mint"];
  const chain: Block[] = [];
  for (let i = 0; i < n; i++) {
    chain.push(
      sealBlock(
        {
          index: i,
          prevHash: i ? chain[i - 1].hash : GENESIS_PREV_HASH,
          ts: 1_700_000_000_000 + i,
          kind: kinds[i % kinds.length],
          payload: { matchId: `m${i}`, winner: i % 2, nested: { a: [1, 2, i] } },
        },
        privateKey,
      ),
    );
  }
  return chain;
}

const clone = (chain: Block[]): Block[] => JSON.parse(JSON.stringify(chain));

test("a sealed chain verifies", () => {
  assert.deepEqual(verifyChain(buildChain(6), publicKey), { ok: true });
  assert.deepEqual(verifyChain([], publicKey), { ok: true });
});

test("editing any field of any past block fails at that index", () => {
  const chain = buildChain(6);
  const edits: Array<[string, (b: Block) => void]> = [
    ["payload", (b) => ((b.payload as { winner: number }).winner = 7)],
    ["nested payload", (b) => ((b.payload as { nested: { a: number[] } }).nested.a.push(9))],
    ["ts", (b) => (b.ts += 1)],
    ["kind", (b) => (b.kind = b.kind === "mint" ? "badge" : "mint")],
    ["index", (b) => (b.index += 1)],
    ["prevHash", (b) => (b.prevHash = "f".repeat(64))],
    ["hash", (b) => (b.hash = "a".repeat(64))],
    ["sig", (b) => (b.sig = `${b.sig.slice(0, -2)}${b.sig.endsWith("00") ? "01" : "00"}`)],
  ];
  for (let i = 0; i < chain.length; i++) {
    for (const [field, edit] of edits) {
      const tampered = clone(chain);
      edit(tampered[i]);
      const result = verifyChain(tampered, publicKey);
      assert.equal(result.ok, false, `edit ${field} at ${i} went unnoticed`);
      assert.equal(!result.ok && result.index, i, `edit ${field} at ${i} reported wrong index`);
    }
  }
});

test("re-hashing an edited block still fails on its signature", () => {
  const chain = buildChain(3);
  const forged = sealBlock({ ...chain[1], payload: { matchId: "m1", winner: 1 } }, bytesToHex(secp256k1.utils.randomPrivateKey()));
  const result = verifyChain([chain[0], forged, chain[2]], publicKey);
  assert.deepEqual(result, { ok: false, index: 1, reason: "bad signature" });
});

test("removing or reordering blocks is detected", () => {
  const chain = buildChain(4);
  assert.equal((verifyChain([chain[0], chain[2], chain[3]], publicKey) as { index: number }).index, 1);
  assert.equal((verifyChain([chain[1], chain[0]], publicKey) as { index: number }).index, 0);
});

test("payload key order does not change the hash", () => {
  const a = sealBlock({ index: 0, prevHash: GENESIS_PREV_HASH, ts: 1, kind: "result", payload: { x: 1, y: 2 } }, privateKey);
  const b = sealBlock({ index: 0, prevHash: GENESIS_PREV_HASH, ts: 1, kind: "result", payload: { y: 2, x: 1 } }, privateKey);
  assert.equal(a.hash, b.hash);
});
