"use client";

// The bracket as one column per round, so 8 and 16 players read left to right.
// Desktop shows every round at once; on a phone the row scrolls sideways and
// opens on the round being played.

import Link from "next/link";
import { useEffect, useRef } from "react";
import { PlayerLink } from "@/components/profile/PlayerSheet";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Icon3D } from "@/components/ui/Icon3D";
import type { BracketMatch, TournamentState } from "@/lib/api";
import { Name } from "./shared";

export function Bracket({ t, you }: { t: TournamentState; you?: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const current = Math.max(
    0,
    t.rounds.findIndex((r) => r.matches.some((m) => m.state !== "done")),
  );
  const last = t.rounds.length - 1;
  const focus = t.state === "finished" ? last : current;

  useEffect(() => {
    const row = rowRef.current;
    const el = row?.children[focus] as HTMLElement | undefined;
    if (!row || !el) return;
    row.scrollLeft += el.getBoundingClientRect().left - row.getBoundingClientRect().left - 16;
  }, [focus, t.id]);

  return (
    <div
      ref={rowRef}
      aria-label="Bracket"
      className="-mx-4 flex scroll-pl-4 snap-x snap-proximity gap-4 overflow-x-auto px-4 pb-3 md:mx-0 md:px-0 md:pb-0"
    >
      {t.rounds.map((r, ri) => (
        <section
          key={r.name}
          aria-label={r.name}
          className="flex w-[17.5rem] shrink-0 snap-start flex-col gap-2 md:min-w-[14rem] md:flex-1 md:shrink"
        >
          <h2 className="eyebrow flex items-center gap-2">
            {r.name}
            {ri === focus && t.state === "running" && <span className="chip bg-pending-soft text-pending">Now</span>}
          </h2>
          <div className="flex flex-1 flex-col justify-around gap-2">
            {r.matches.map((m, i) => (
              <MatchCell key={i} m={m} you={you} bestOf={t.bestOf} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MatchCell({ m, you, bestOf }: { m: BracketMatch; you?: string; bestOf: 1 | 3 }) {
  const mine = Boolean(you) && m.players.some((p) => p && !p.bot && p.id === you);
  const series = bestOf === 3;
  const href = m.matchId ? (m.state === "done" ? `/replay/${m.matchId}` : `/match/${m.matchId}`) : null;
  const action = m.state === "done" ? "Replay" : mine ? "Play" : "Watch";
  return (
    <div
      className={`card flex flex-col gap-1.5 !p-2.5 ${mine ? "ring-2 ring-[rgb(var(--you))]" : ""}`}
      aria-label={mine ? "Your match" : undefined}
    >
      <ul className="flex flex-col gap-1">
        {m.players.map((p, i) => {
          const won = Boolean(p) && m.winner?.seed === p?.seed;
          return (
            <li key={i} className={`flex items-center gap-2 ${m.state === "done" && !won ? "opacity-60" : ""}`}>
              {p ? (
                <PlayerLink id={p.id} bot={p.bot} className="flex min-w-0 flex-1 items-center gap-2">
                  <Avatar3D id={p.id} bot={p.bot} size="sm" seat={!p.bot && p.id === you ? "you" : undefined} />
                  <Name name={p.name} bot={p.bot} />
                </PlayerLink>
              ) : (
                <>
                  <span className="h-[34px] w-[34px] shrink-0 rounded-[11px] border-2 border-dashed border-sf-3" />
                  <span className="flex-1 text-ink-3">To be decided</span>
                </>
              )}
              {won && <Icon3D name="crown" size={20} label="Winner" />}
              {series && p && m.matchId && (
                <b className="w-5 text-right tabular-nums" aria-label={`${m.score[i]} game wins`}>
                  {m.score[i]}
                </b>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2 text-small text-ink-2">
        <span>
          {m.state === "pending" && "Waiting"}
          {m.state === "playing" && (series ? `Game ${m.games.length}` : m.matchIds.length > 1 ? "Rematch" : "In play")}
          {m.state === "done" && (m.decidedBy === "coin flip" ? "Coin flip" : series ? `Won ${Math.max(...m.score)}-${Math.min(...m.score)}` : "Played")}
        </span>
        {href && (
          <Link href={href} className={`btn btn-sm ml-auto ${mine && m.state === "playing" ? "btn-act" : "btn-sec"}`}>
            {action}
          </Link>
        )}
      </div>
    </div>
  );
}
