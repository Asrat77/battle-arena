// Independent check of a finished match against the ledger. Shared by the
// server tests and the browser's Verify button, so no Node-only APIs here.
//
// Steps: replay the log, recompute the outcome and result hash, compare them
// with the match's result block, check the commitments published before play
// against the replayed (now revealed) hidden data, and check the whole chain.

import { canonical } from "./canonical";
import { type Block, verifyChain } from "./ledger";
import { resultHash } from "./record";
import { getGame } from "./registry";
import { replay, ReplayError } from "./replay";
import type { AnyGame, MatchRecord, Outcome, Seat } from "./types";

export type CheckName = "game" | "replay" | "outcome" | "resultBlock" | "resultHash" | "commitments" | "reveal" | "chain";

export interface Check {
  name: CheckName;
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  checks: Check[];
}

export interface CommitPayload {
  matchId: string;
  gameId: string;
  players: [string, string];
  commitments: Record<string, string>;
}

export interface ResultPayload {
  matchId: string;
  winner: Seat | null;
  ts: number;
  resultHash: string;
}

export interface VerifyInput {
  record: MatchRecord;
  /** What the server published at the end (e.g. both secrets and salts). */
  reveal?: Record<string, unknown>;
  blocks: Block[];
  publicKey: string;
  /** Override the registry lookup (test games are not registered). */
  game?: AnyGame;
}

export function findBlock<P>(blocks: Block[], kind: "commit" | "result", matchId: string): (Block & { payload: P }) | undefined {
  return blocks.find(
    (b) => b.kind === kind && (b.payload as { matchId?: unknown } | null)?.matchId === matchId,
  ) as (Block & { payload: P }) | undefined;
}

const same = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null);

export function verifyMatch(input: VerifyInput): VerifyReport {
  const { record, blocks, publicKey } = input;
  const checks: Check[] = [];
  const add = (name: CheckName, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const done = () => ({ ok: checks.every((c) => c.ok), checks });

  const chain = verifyChain(blocks, publicKey);
  const chainCheck: Check = chain.ok
    ? { name: "chain", ok: true, detail: `${blocks.length} blocks linked and signed` }
    : { name: "chain", ok: false, detail: `block ${chain.index}: ${chain.reason}` };

  const game = input.game ?? getGame(record.gameId);
  if (!game || game.id !== record.gameId) {
    add("game", false, `unknown game ${record.gameId}`);
    checks.push(chainCheck);
    return done();
  }
  add("game", true, game.name);

  // 1. Replay the log with the game's own rules.
  let state: unknown = null;
  let outcome: Outcome | null = null;
  try {
    const out = replay(game, record.seed, record.log);
    state = out.state;
    outcome = out.outcome;
    add("replay", true, `${record.log.length} log entries replayed`);
  } catch (err) {
    add("replay", false, err instanceof ReplayError ? err.message : String(err));
  }

  // 2. The replayed outcome must be the recorded one.
  if (outcome === null) add("outcome", false, "replay does not reach an outcome");
  else if (!same(outcome, record.outcome)) add("outcome", false, `replay gives ${canonical(outcome)}, record says ${canonical(record.outcome)}`);
  else add("outcome", true, outcome.draw ? "draw" : `seat ${outcome.winner} wins (${outcome.reason})`);

  // 3. The ledger's result block must match the record.
  const result = findBlock<ResultPayload>(blocks, "result", record.matchId);
  const hash = resultHash(record);
  if (!result) {
    add("resultBlock", false, "no result block for this match");
    add("resultHash", false, `computed ${hash}, nothing to compare`);
  } else {
    const winnerOk = result.payload.winner === record.outcome.winner;
    add("resultBlock", winnerOk, winnerOk ? `block ${result.index}` : `block ${result.index} says winner ${result.payload.winner}, record says ${record.outcome.winner}`);
    const hashOk = result.payload.resultHash === hash;
    add("resultHash", hashOk, hashOk ? hash : `computed ${hash}, block ${result.index} has ${result.payload.resultHash}`);
  }

  // 4. Commitments published before play must match the hidden data the replay reveals.
  const commit = findBlock<CommitPayload>(blocks, "commit", record.matchId);
  if (!game.commitments) add("commitments", true, "game has no hidden data");
  else if (state === null) add("commitments", false, "cannot check without a replay");
  else {
    const expected = game.commitments(state);
    const complete = ["0", "1"].every((seat) => seat in expected);
    if (commit) {
      const ok = same(commit.payload.commitments, expected);
      add("commitments", ok, ok ? `block ${commit.index}` : `block ${commit.index} commitments do not match the replayed secrets`);
    } else if (!complete) add("commitments", true, "match ended before every seat committed");
    else add("commitments", false, "no commit block for this match");
  }

  // 5. What the server revealed must be what the replay produces.
  if (input.reveal === undefined || !game.reveal) add("reveal", true, "nothing revealed");
  else if (state === null) add("reveal", false, "cannot check without a replay");
  else {
    const ok = same(input.reveal, game.reveal(state));
    add("reveal", ok, ok ? "revealed data matches the replay" : "revealed data differs from the replay");
  }

  checks.push(chainCheck);
  return done();
}
