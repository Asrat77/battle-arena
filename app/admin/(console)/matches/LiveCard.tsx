"use client";

// "Live now": every match being played at the moment, from GET matches/live,
// refreshed every 15 s without a skeleton flash (the query keeps the old rows).
// The running time ticks every second. Empty reads as one slim line.

import { Button, ButtonLink } from "@/components/admin/Button";
import { CopyButton } from "@/components/admin/CopyButton";
import { Icon } from "@/components/admin/icons";
import { Skeleton } from "@/components/admin/Skeleton";
import { StatusPill } from "@/components/admin/StatusPill";
import { type AdminQuery } from "@/lib/admin/api";
import { num, plural } from "@/lib/admin/format";
import { liveElapsed } from "@/lib/admin/matches";
import type { LiveMatchRow } from "@/lib/admin/types";
import { useEffect, useState } from "react";
import { Seat, StakePill } from "./MatchParts";

/** Wall clock that ticks every second while mounted. */
function useSecond(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function LiveRow({ m, now, onOpen }: { m: LiveMatchRow; now: number; onOpen(id: string): void }) {
  return (
    <li className="flex flex-col gap-2.5 px-4 py-3 lg:flex-row lg:items-center lg:gap-4">
      <div className="flex min-w-0 items-center gap-2 lg:w-[150px] lg:flex-none">
        <StatusPill tone="live">{m.gameName}</StatusPill>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {m.players.map((p, i) => (
          <span key={`${p.profileId}-${i}`} className="flex items-center gap-3">
            {i > 0 && <span className="font-mono text-[11px] uppercase text-ink-3">vs</span>}
            <Seat p={p} winner={false} />
          </span>
        ))}
      </div>
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Running time</dt>
          <dd className="num inline-flex items-center gap-1 font-normal text-ink">
            <Icon name="clock" size={14} className="text-ink-3" />
            {liveElapsed(m.startedAt, now)}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Moves</dt>
          <dd>
            <span className="num font-normal text-ink">{num(m.moves)}</span> {plural(m.moves, "move", "moves")}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Spectators</dt>
          <dd>
            <span className="num font-normal text-ink">{num(m.spectators)}</span> watching
          </dd>
        </div>
        {m.room && (
          <div>
            <dt className="sr-only">Room code</dt>
            <dd>
              <CopyButton value={m.room} label="Copy room code">
                {m.room}
              </CopyButton>
            </dd>
          </div>
        )}
        <div>
          <dt className="sr-only">Stake</dt>
          <dd>
            <StakePill stake={m.stake} />
          </dd>
        </div>
      </dl>
      <div className="flex gap-2 lg:flex-none">
        <Button size="sm" variant="ghost" onClick={() => onOpen(m.matchId)}>
          Details
        </Button>
        <ButtonLink href={`/match/${encodeURIComponent(m.matchId)}`} target="_blank" rel="noopener noreferrer" size="sm" variant="secondary" iconRight="external">
          Watch
        </ButtonLink>
      </div>
    </li>
  );
}

export function LiveCard({ query, onOpen }: { query: AdminQuery<{ rows: LiveMatchRow[] }>; onOpen(id: string): void }) {
  const { data, error, reload } = query;
  const now = useSecond();
  const rows = data?.rows ?? [];

  if (!data && !error) {
    return (
      <section aria-label="Live now" aria-busy className="mb-4 rounded-[10px] border border-line bg-sf px-4 py-3 lg:mb-5">
        <Skeleton className="h-4 w-48" />
      </section>
    );
  }
  if (!data && error) {
    return (
      <section aria-label="Live now" role="alert" className="mb-4 flex items-center gap-3 rounded-[10px] border border-mismatch/40 bg-mismatch-soft px-4 py-2.5 text-[13px] text-mismatch lg:mb-5">
        <Icon name="alert" size={16} /> Couldn&apos;t load live matches: {error.message}
        <button type="button" onClick={reload} className="ml-auto font-medium underline underline-offset-2">
          Retry
        </button>
      </section>
    );
  }
  if (rows.length === 0) {
    return (
      <section aria-label="Live now" className="mb-4 flex items-center gap-2.5 rounded-[10px] border border-line bg-sf px-4 py-2.5 text-[13px] text-ink-2 lg:mb-5">
        <span className="h-1.5 w-1.5 rounded-full bg-ink-3" aria-hidden />
        <span className="label">Live now</span>
        <span>No live matches right now</span>
      </section>
    );
  }
  return (
    <section aria-label="Live now" className="mb-4 rounded-[10px] border border-line bg-sf lg:mb-5">
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
        <span className="relative h-1.5 w-1.5 rounded-full bg-current ping text-recorded" aria-hidden />
        <h2 className="label">Live now</h2>
        <span className="num text-[12px] text-ink-3">{rows.length}</span>
        <span className="ml-auto text-[12px] text-ink-3">updates every 15 s</span>
      </header>
      <ul className="divide-y divide-line">
        {rows.map((m) => (
          <LiveRow key={m.matchId} m={m} now={now} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}
