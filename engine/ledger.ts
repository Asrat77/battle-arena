// Hash-chained, server-signed ledger blocks. Shared by the server (which
// seals blocks) and the browser (which checks chain integrity), so this file
// must stay free of Node-only APIs.
import { secp256k1 } from "@noble/curves/secp256k1";
import { hexToBytes } from "@noble/hashes/utils";
import { hashValue } from "./hash";

export type BlockKind = "commit" | "result" | "badge" | "mint";

export interface Block {
  index: number;
  prevHash: string;
  ts: number;
  kind: BlockKind;
  payload: unknown;
  hash: string;
  sig: string;
}

export type UnsealedBlock = Omit<Block, "hash" | "sig">;

export type ChainCheck = { ok: true } | { ok: false; index: number; reason: string };

export const GENESIS_PREV_HASH = "0".repeat(64);

export function blockHash(block: UnsealedBlock): string {
  const { index, prevHash, ts, kind, payload } = block;
  return hashValue({ index, prevHash, ts, kind, payload });
}

export function sealBlock(block: UnsealedBlock, privateKey: string): Block {
  const hash = blockHash(block);
  const sig = secp256k1.sign(hexToBytes(hash), hexToBytes(privateKey)).toCompactHex();
  return { ...block, hash, sig };
}

export function verifyBlockSig(block: Block, publicKey: string): boolean {
  try {
    return secp256k1.verify(hexToBytes(block.sig), hexToBytes(block.hash), hexToBytes(publicKey));
  } catch {
    return false;
  }
}

// Checks every block in order: position, link to the previous block, hash of
// its contents, and the server signature. Reports the first broken index.
export function verifyChain(blocks: Block[], publicKey: string): ChainCheck {
  let prevHash = GENESIS_PREV_HASH;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.index !== i) return { ok: false, index: i, reason: "index out of sequence" };
    if (block.prevHash !== prevHash) return { ok: false, index: i, reason: "prevHash does not match previous block" };
    if (block.hash !== blockHash(block)) return { ok: false, index: i, reason: "hash does not match contents" };
    if (!verifyBlockSig(block, publicKey)) return { ok: false, index: i, reason: "bad signature" };
    prevHash = block.hash;
  }
  return { ok: true };
}
