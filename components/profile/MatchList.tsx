"use client";

// A profile's match list: the full history with "Load more", or a short
// preview (limit) for the Overview tab.

import Link from "next/link";
import { useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { RecordChip } from "@/components/ui/Chip";
import { Icon3D } from "@/components/ui/Icon3D";
import { getGame } from "@/engine/registry";
import type { MatchSummary, PlayerRewards } from "@/lib/api";
import { GAME_ICONS } from "@/lib/gameCatalog";
import { shortId, usePlayerNames } from "@/lib/usePlayerNames";

const PAGE = 10;

type Result = "Won" | "Lost" | "Draw";

export function resultFor(m: MatchSummary, profileId: string): Result {
  if (m.outcome.draw) return "Draw";
  return m.outcome.winner === m.players.indexOf(profileId) ? "Won" : "Lost";
}

export function MatchList({ profileId, matches, rewards, own, limit, onMore, heading = true }: { profileId: string; matches: MatchSummary[]; rewards: PlayerRewards; own: boolean; limit?: number; onMore?: () => void; heading?: boolean }) {
  const [count, setCount] = useState(limit ?? PAGE);
  const shown = matches.slice(0, count);
  const names = usePlayerNames(shown.length ? [...new Set(shown.flatMap((m) => m.players))] : undefined);
  const points = new Map(rewards.history.map((h) => [h.matchId, h.points]));

  return (
    <section aria-labelledby={`history-heading${limit ? "-recent" : ""}`} className="flex flex-col gap-2.5">
      {heading && (
        <h2 id={`history-heading${limit ? "-recent" : ""}`} className="eyebrow px-0.5">
          {limit ? "Recent matches" : "Match history"}
        </h2>
      )}
      {matches.length === 0 ? (
        <div className="card flex flex-col items-center gap-2.5 !p-4 text-center">
          <Icon3D name="controller" size={72} />
          <b className="text-[17px] font-semibold">No matches yet</b>
          <span className="text-small text-ink-2">
            {own ? "Your first finished match puts points, a rank and your first badge here." : "Finished matches will show up here."}
          </span>
          {own && (
            <ButtonLink href="/" variant="sec" icon="lightning" block>
              Play a match
            </ButtonLink>
          )}
        </div>
      ) : (
        <>
          <ul className="card !px-3.5 !py-1">
            {shown.map((m) => {
              const opponent = m.players[m.players.indexOf(profileId) === 0 ? 1 : 0];
              const pts = points.get(m.matchId);
              return (
                <li key={m.matchId} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                  <Icon3D name={GAME_ICONS[m.gameId] ?? "controller"} size={34} />
                  <Link href={`/replay/${m.matchId}`} className="min-w-0 flex-1 hover:underline">
                    <p className="truncate">
                      <b className="font-semibold">{resultFor(m, profileId)}</b> vs {names[opponent] ?? shortId(opponent)}
                    </p>
                    <p className="truncate text-small text-ink-2">
                      {getGame(m.gameId)?.name ?? m.gameId}
                      {pts !== undefined && ` · +${pts}`}
                    </p>
                  </Link>
                  <RecordChip state={m.status} block={m.resultIndex} />
                </li>
              );
            })}
          </ul>
          {limit !== undefined && matches.length > limit && onMore ? (
            <button type="button" className="self-center text-small text-ink-2 underline" onClick={onMore}>
              See all {matches.length} matches
            </button>
          ) : limit === undefined && matches.length > count && (
            <button type="button" className="self-center text-small text-ink-2 underline" onClick={() => setCount((c) => c + PAGE)}>
              Showing {count} of {matches.length} · Load more
            </button>
          )}
        </>
      )}
    </section>
  );
}

