"use client";

// Step through a finished match by replaying its log with the game's own
// rules, then verify it against the ledger.

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { RoundHistory } from "@/components/ctc/RoundHistory";
import { VerifyPanel } from "@/components/VerifyPanel";
import type { CtcState } from "@/engine/games/crackTheCode";
import { getGame } from "@/engine/registry";
import { initial, step, type MatchState } from "@/engine/replay";
import type { LogEntry } from "@/engine/types";
import { api, type StoredMatch } from "@/lib/api";
import { usePlayerNames } from "@/lib/usePlayerNames";

function describe(entry: LogEntry, labels: [string, string]): string {
  if (entry.seat === "system") {
    return entry.move.type === "timeout" ? "Timer ran out" : `${labels[entry.move.seat]} forfeits`;
  }
  const move = entry.move as { type?: string; code?: string };
  if (move?.type === "secret") return `${labels[entry.seat]} locks a secret`;
  if (move?.type === "guess") return `${labels[entry.seat]} guesses ${move.code}`;
  return `${labels[entry.seat]} plays ${JSON.stringify(entry.move)}`;
}

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [match, setMatch] = useState<StoredMatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState(0);
  const names = usePlayerNames(match?.record.players);

  useEffect(() => {
    api.match(id).then(
      (m) => {
        setMatch(m);
        setPos(m.record.log.length);
      },
      (e) => setError(e.message),
    );
  }, [id]);

  const game = match ? getGame(match.record.gameId) : undefined;

  // states[i] = state after the first i log entries.
  const states = useMemo(() => {
    if (!match || !game) return [];
    const { seed, log } = match.record;
    const out: MatchState<unknown>[] = [initial(game, seed)];
    try {
      log.forEach((entry, i) => out.push(step(game, seed, out[i], entry, i)));
    } catch {
      // A broken log stops here; Verify reports why.
    }
    return out;
  }, [match, game]);

  if (error) return <p className="text-sm text-red-600">{error === "match in progress" ? "This match is still being played." : error}</p>;
  if (!match) return <p className="text-sm text-gray-500">Loading replay…</p>;

  const { record } = match;
  const labels: [string, string] = [names[record.players[0]] ?? "…", names[record.players[1]] ?? "…"];
  const last = states.length - 1;
  const at = Math.min(pos, last);
  const cur = states[at];
  const result = record.outcome.draw ? `Draw (${record.outcome.reason})` : `${labels[record.outcome.winner!]} wins (${record.outcome.reason})`;
  const secrets = (match.reveal as { secrets?: [string | null, string | null] }).secrets;

  return (
    <div className="space-y-4">
      <section className="card space-y-1">
        <h1 className="font-semibold">
          Replay: {game?.name ?? record.gameId}, {labels[0]} vs {labels[1]}
        </h1>
        <p className="text-sm">{result}</p>
        {secrets && (
          <p className="text-sm">
            Secrets: {labels[0]} <span className="font-mono">{secrets[0] ?? "none"}</span>, {labels[1]}{" "}
            <span className="font-mono">{secrets[1] ?? "none"}</span>
          </p>
        )}
        <p className="text-xs text-gray-500">
          {match.status === "recorded" ? (
            <>
              Recorded in <Link className="underline" href={`/ledger#block-${match.resultIndex}`}>block #{match.resultIndex}</Link>
            </>
          ) : (
            "Ledger: pending"
          )}
          {match.commitIndex !== null && (
            <>
              {" "}· commitments in <Link className="underline" href={`/ledger#block-${match.commitIndex}`}>block #{match.commitIndex}</Link>
            </>
          )}
        </p>
        <p className="mono text-gray-500">result hash {match.resultHash}</p>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-outline" onClick={() => setPos(0)} disabled={at === 0}>
            ⏮
          </button>
          <button className="btn-outline" onClick={() => setPos(at - 1)} disabled={at === 0}>
            ◀ Prev
          </button>
          <button className="btn-outline" onClick={() => setPos(at + 1)} disabled={at >= last}>
            Next ▶
          </button>
          <button className="btn-outline" onClick={() => setPos(last)} disabled={at >= last}>
            ⏭
          </button>
          <span className="text-sm text-gray-600">
            Move {at} of {record.log.length}
          </span>
        </div>
        <input type="range" min={0} max={Math.max(last, 0)} value={at} onChange={(e) => setPos(Number(e.target.value))} className="w-full" />
        <p className="text-sm">{at === 0 ? "Match starts" : describe(record.log[at - 1], labels)}</p>
        {cur && record.gameId === "crack-the-code" ? (
          <>
            {(cur.state as CtcState).pending.some(Boolean) && (
              <p className="text-xs text-gray-500">
                Waiting to resolve:{" "}
                {(cur.state as CtcState).pending.map((code, s) => (code ? `${labels[s]} guessed ${code}` : null)).filter(Boolean).join(", ")}
              </p>
            )}
            <RoundHistory history={(cur.state as CtcState).history} seat="spectator" names={labels} />
          </>
        ) : (
          cur && <pre className="mono whitespace-pre-wrap">{JSON.stringify(cur.state, null, 2)}</pre>
        )}
      </section>

      <VerifyPanel match={match} />
    </div>
  );
}
