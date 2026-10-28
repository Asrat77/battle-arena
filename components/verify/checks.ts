// Plain words for the eight checks engine/verify.ts runs: a short title, the
// sentence the verdict uses when one fails, and a hash shortener for details.

import type { CheckName } from "@/engine/verify";

export const CHECK_TITLES: Record<CheckName, string> = {
  game: "Game",
  replay: "Replay",
  outcome: "Outcome",
  resultBlock: "Result block",
  resultHash: "Result hash",
  commitments: "Commitments",
  reveal: "Reveal",
  chain: "Chain",
};

const FAILURES: Record<CheckName, string> = {
  game: "this app doesn’t know the rules of this game.",
  replay: "the move log doesn’t replay legally.",
  outcome: "the replayed winner differs from the recorded one.",
  resultBlock: "the result block on the ledger doesn’t match this record.",
  resultHash: "the result hash differs from the one on the ledger.",
  commitments: "the secrets don’t match the commitments published before play.",
  reveal: "the revealed data differs from what the replay produces.",
  chain: "the ledger chain is broken or a block’s signature is wrong.",
};

/** "Check 5 failed: the result hash differs…" for the first failing check. */
export function failureSentence(checks: { name: CheckName; ok: boolean }[]): string {
  const i = checks.findIndex((c) => !c.ok);
  if (i < 0) return "";
  return `Check ${i + 1} failed: ${FAILURES[checks[i].name]}`;
}

/** Shorten long hex strings (hashes, ids) in a detail line to 7c1e…a94b. */
export function shortHashes(text: string): string {
  return text.replace(/\b[0-9a-f]{16,}\b/gi, (h) => `${h.slice(0, 4)}…${h.slice(-4)}`);
}
