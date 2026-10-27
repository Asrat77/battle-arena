"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type MatchSummary } from "@/lib/api";
import { usePlayerNames } from "@/lib/usePlayerNames";

export function MatchHistory({ profileId }: { profileId: string }) {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const names = usePlayerNames(matches ? [...new Set(matches.flatMap((m) => m.players))] : undefined);

  useEffect(() => {
    api.matches(profileId).then(setMatches, () => setMatches([]));
  }, [profileId]);

  return (
    <section className="card">
      <h2 className="mb-2 font-semibold">Match history</h2>
      {matches?.length === 0 && <p className="text-sm text-gray-500">No matches yet.</p>}
      <ul className="divide-y divide-gray-100 text-sm">
        {matches?.map((m) => {
          const seat = m.players.indexOf(profileId);
          const opponent = m.players[seat === 0 ? 1 : 0];
          const result = m.outcome.draw ? "Draw" : m.outcome.winner === seat ? "Won" : "Lost";
          return (
            <li key={m.matchId} className="flex items-center gap-3 py-2">
              <span className="w-10 font-medium">{result}</span>
              <span className="flex-1">
                vs {names[opponent] ?? "…"} <span className="text-xs text-gray-500">· {m.outcome.reason}</span>
              </span>
              <span className="text-xs text-gray-500">{m.status === "recorded" ? `block #${m.resultIndex}` : "pending"}</span>
              <Link href={`/replay/${m.matchId}`} className="underline">
                Replay
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
