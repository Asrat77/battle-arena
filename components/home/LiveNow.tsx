"use client";

// "Live now" on Home: in-progress matches from GET /api/live, refreshed every
// 10 s, each with a Watch link so anyone can spectate from the lobby.

import { useEffect, useState } from "react";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { ButtonLink } from "@/components/ui/Button";
import { BotTag, LiveChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon3D } from "@/components/ui/Icon3D";
import { api, type LiveMatch } from "@/lib/api";

const POLL_MS = 10_000;

import { GAME_ICONS as ART } from "@/lib/gameCatalog";

export function LiveNow({ className = "" }: { className?: string }) {
  const [rows, setRows] = useState<LiveMatch[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.live().then(
        (live) => alive && (setRows(live), setNow(Date.now())),
        () => {},
      );
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <section aria-labelledby="live-now" className={`flex flex-col gap-2.5 ${className}`}>
      <div className="flex items-center gap-2.5 px-0.5">
        <h2 id="live-now" className="text-h2">
          Live now
        </h2>
        {rows && rows.length > 0 && <LiveChip count={rows.length} />}
      </div>
      {rows === null ? null : rows.length === 0 ? (
        <div className="rounded-game bg-sf [.light_&]:shadow-[0_0_0_1px_rgb(var(--ln))]">
          <EmptyState icon="binoculars" title="Nothing live right now">
            Start a match and it shows up here for others to watch.
          </EmptyState>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((m) => (
            <li
              key={m.matchId}
              className="flex items-center gap-3 rounded-[20px] bg-sf p-3 [.light_&]:shadow-[0_0_0_1px_rgb(var(--ln))]"
            >
              <Icon3D name={ART[m.gameId] ?? "lightning"} size={40} className="flex-none" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-1.5 text-small font-semibold">
                  <Player p={m.players[0]} />
                  <span className="text-ink-2">vs</span>
                  <Player p={m.players[1]} />
                </div>
                <span className="text-small text-ink-2">
                  {m.gameName} · <span className="font-mono tabular-nums">{elapsed(now - m.startedAt)}</span> in ·{" "}
                  <span className="font-mono tabular-nums">{m.spectators}</span> watching
                </span>
              </div>
              <ButtonLink href={`/match/${m.matchId}`} icon="binoculars" size="sm">
                Watch
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Player({ p }: { p?: { profileId: string; name: string } }) {
  if (!p) return null;
  const bot = p.profileId === "bot";
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar3D id={p.profileId} bot={bot} size="sm" className="!h-6 !w-6 !rounded-lg" />
      <span className="truncate">{p.name}</span>
      {bot && <BotTag />}
    </span>
  );
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
