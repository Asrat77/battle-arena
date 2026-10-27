"use client";

import Link from "next/link";
import { use } from "react";
import { Countdown } from "@/components/Countdown";
import { CtcPlay } from "@/components/ctc/CtcPlay";
import type { CtcView } from "@/engine/games/crackTheCode";
import { getGame } from "@/engine/registry";
import { useSession } from "@/lib/session";
import { useMatch } from "@/lib/useMatch";
import { usePlayerNames } from "@/lib/usePlayerNames";

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { profile, ready } = useSession();
  const { start, view, end, commit, ledger, error, missing, move, leave } = useMatch<CtcView>(id);
  const names = usePlayerNames(start?.players);

  if (ready && !profile) return <p className="text-sm">Sign up on the <Link href="/" className="underline">home page</Link> first.</p>;
  if (missing)
    return (
      <p className="text-sm">
        This match is not live. <Link href={`/replay/${id}`} className="underline">Open its replay</Link>.
      </p>
    );
  if (!start || !view) return <p className="text-sm text-gray-500">Connecting to match…</p>;

  const game = getGame(start.gameId);
  const seat = start.seat;
  const label = (s: 0 | 1) => `${names[start.players[s]] ?? "…"}${s === seat ? " (you)" : ""}`;
  const labels: [string, string] = [label(0), label(1)];

  const result = end
    ? end.outcome.draw
      ? `Draw (${end.outcome.reason})`
      : `${labels[end.outcome.winner!]} wins (${end.outcome.reason})`
    : null;
  const secrets = (end?.reveal as { secrets?: [string | null, string | null] } | undefined)?.secrets;

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center gap-3">
        <h1 className="flex-1 font-semibold">
          {game?.name ?? start.gameId}: {labels[0]} vs {labels[1]}
        </h1>
        {!end && <Countdown deadline={view.deadline} />}
        {!end && seat !== "spectator" && (
          <button className="btn-outline" onClick={() => confirm("Forfeit this match?") && leave()}>
            Forfeit
          </button>
        )}
      </section>

      <section className="card">
        {start.gameId === "crack-the-code" ? (
          <CtcPlay view={view.view} seat={seat} labels={labels} onMove={move} />
        ) : (
          <pre className="mono whitespace-pre-wrap">{JSON.stringify(view.view, null, 2)}</pre>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      {end && (
        <section className="card space-y-2" data-testid="match-end">
          <h2 className="text-lg font-semibold">{result}</h2>
          {secrets && (
            <p className="text-sm">
              Secrets revealed: {labels[0]} <span className="font-mono">{secrets[0] ?? "none"}</span>, {labels[1]}{" "}
              <span className="font-mono">{secrets[1] ?? "none"}</span>
            </p>
          )}
          <p className="text-sm">
            Ledger:{" "}
            {ledger.state === "recorded" ? (
              <span className="text-green-700">recorded in block #{ledger.ledgerIndex}</span>
            ) : (
              <span className="text-amber-600">pending…</span>
            )}
          </p>
          <div className="flex gap-2">
            <Link href={`/replay/${id}`} className="btn">
              Replay and verify
            </Link>
            <Link href="/" className="btn-outline">
              Home
            </Link>
          </div>
        </section>
      )}

      <section className="card text-sm">
        <h2 className="font-semibold">Commitments</h2>
        {commit || Object.keys(start.commitments).length ? (
          <ul className="mt-1 space-y-1">
            {Object.entries(commit?.commitments ?? start.commitments).map(([s, hash]) => (
              <li key={s}>
                {labels[Number(s) as 0 | 1]}: <span className="mono text-gray-600">{hash}</span>
              </li>
            ))}
            {commit && <li className="text-xs text-gray-500">Published in block #{commit.ledgerIndex} before the first guess.</li>}
          </ul>
        ) : (
          <p className="text-gray-500">Published once both secrets are locked.</p>
        )}
      </section>
    </div>
  );
}
