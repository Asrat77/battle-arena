// Puts matches on the ledger: a commit block once every seat has committed,
// a result block when the match ends. Finished records are kept in the store
// and served by GET /api/matches/:id for replay and Verify.

import { EventEmitter } from "node:events";
import { Router } from "express";
import { resultHash } from "../../engine/record";
import type { CommitPayload, ResultPayload } from "../../engine/verify";
import type { MatchRecord } from "../../engine/types";
import type { Ledger } from "./ledger";
import type { Match, MatchRuntime } from "./matches";
import type { Store } from "./store";

const MATCHES = "matches";

export interface StoredMatch {
  record: MatchRecord;
  reveal: Record<string, unknown>;
  commitments: Record<string, string>;
  resultHash: string;
  /** "pending" until the result block is sealed. */
  status: "pending" | "recorded";
  commitIndex: number | null;
  resultIndex: number | null;
}

/** Emits "recorded" (stored) once a match's result block is on the ledger. */
export class Recorder extends EventEmitter {
  /** Commit blocks sealed for matches that have not ended yet. */
  private commitIndex = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly ledger: Ledger,
    private readonly matches: MatchRuntime,
  ) {
    super();
    matches.on("commit", (m: Match) => this.commit(m));
    matches.on("end", (m: Match, record: MatchRecord | null) => {
      if (record) this.finish(m, record);
    });
  }

  get(matchId: string): StoredMatch | null {
    return this.all()[matchId] ?? null;
  }

  forPlayer(profileId: string): StoredMatch[] {
    return Object.values(this.all())
      .filter((s) => s.record.players.includes(profileId))
      .sort((a, b) => b.record.endedAt - a.record.endedAt);
  }

  private all(): Record<string, StoredMatch> {
    return this.store.read<Record<string, StoredMatch>>(MATCHES, {});
  }

  private save(matchId: string, change: (s: StoredMatch) => StoredMatch) {
    const all = this.all();
    if (!all[matchId]) return;
    this.store.write(MATCHES, { ...all, [matchId]: change(all[matchId]) });
  }

  private commit(m: Match) {
    const payload: CommitPayload = { matchId: m.id, gameId: m.game.id, players: m.players, commitments: m.commitments };
    void this.ledger.append("commit", payload).then((block) => {
      // The match may have ended (and been stored) while the block was pending.
      if (this.get(m.id)) this.save(m.id, (s) => ({ ...s, commitIndex: block.index }));
      else this.commitIndex.set(m.id, block.index);
      this.matches.broadcast(m, "match:committed", { matchId: m.id, commitments: m.commitments, ledgerIndex: block.index });
    });
  }

  private finish(m: Match, record: MatchRecord) {
    const hash = resultHash(record);
    const stored: StoredMatch = {
      record,
      reveal: m.game.reveal?.(m.cur.state) ?? {},
      commitments: m.commitments,
      resultHash: hash,
      status: "pending",
      commitIndex: this.commitIndex.get(m.id) ?? null,
      resultIndex: null,
    };
    this.commitIndex.delete(m.id);
    this.store.write(MATCHES, { ...this.all(), [m.id]: stored });

    const payload: ResultPayload = { matchId: m.id, winner: record.outcome.winner, ts: record.endedAt, resultHash: hash };
    void this.ledger.append("result", payload).then((block) => {
      this.save(m.id, (s) => ({ ...s, status: "recorded", resultIndex: block.index }));
      this.matches.broadcast(m, "match:recorded", { matchId: m.id, ledgerIndex: block.index });
      this.emit("recorded", this.get(m.id));
    });
  }
}

export function matchRoutes(recorder: Recorder, matches: MatchRuntime): Router {
  const router = Router();

  router.get("/api/matches", (req, res) => {
    const player = typeof req.query.player === "string" ? req.query.player : "";
    if (!player) {
      res.status(400).json({ error: "player is required" });
      return;
    }
    res.json(
      recorder.forPlayer(player).map(({ record, status, resultIndex }) => ({
        matchId: record.matchId,
        gameId: record.gameId,
        players: record.players,
        bot: record.bot,
        outcome: record.outcome,
        endedAt: record.endedAt,
        status,
        resultIndex,
      })),
    );
  });

  // The record (seed, full log, reveal) is only served once the match is over.
  router.get("/api/matches/:id", (req, res) => {
    const stored = recorder.get(req.params.id);
    if (stored) {
      res.json(stored);
      return;
    }
    if (matches.get(req.params.id)) {
      res.status(409).json({ error: "match in progress" });
      return;
    }
    res.status(404).json({ error: "match not found" });
  });

  return router;
}
