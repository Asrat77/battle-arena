"use client";

// Four-player brackets: open ones to join, running ones to watch, finished
// ones to look back on. Any signed-in player can open one.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Signup } from "@/components/home/Signup";
import { CreateTournament } from "@/components/tournament/CreateTournament";
import { GAME_ICONS, StateChip } from "@/components/tournament/shared";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon3D } from "@/components/ui/Icon3D";
import { Segmented } from "@/components/ui/Segmented";
import { api, type TournamentState } from "@/lib/api";
import { useSession } from "@/lib/session";

type Filter = "all" | "crack-the-code" | "gebeta";

const FILTERS: { value: Filter; label: string; icon?: "vault" | "mancala" }[] = [
  { value: "all", label: "All" },
  { value: "crack-the-code", label: "Code", icon: "vault" },
  { value: "gebeta", label: "Gebeta", icon: "mancala" },
];

const REFRESH_MS = 5000;

export default function TournamentsPage() {
  const { ready, profile } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const [list, setList] = useState<TournamentState[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.tournaments(filter === "all" ? undefined : filter).then(
      (l) => {
        setList(l);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [filter]);

  useEffect(() => {
    setList(null);
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!ready) return null;
  if (!profile) return <Signup />;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-h2">Tournaments</h1>
        <Button variant="act" size="sm" icon="plus" onClick={() => setCreating(true)}>
          Create
        </Button>
      </header>
      <Segmented<Filter> label="Game" value={filter} onChange={setFilter} options={FILTERS} />

      {failed && !list ? (
        <EmptyState
          icon="satellite"
          title="Couldn’t load tournaments"
          action={
            <Button icon="refresh" onClick={load}>
              Try again
            </Button>
          }
        />
      ) : !list ? (
        <p className="py-10 text-center text-ink-2" role="status">
          Loading…
        </p>
      ) : list.length === 0 ? (
        <EmptyState
          icon="trophy"
          title="No tournaments yet"
          action={
            <Button variant="act" icon="plus" onClick={() => setCreating(true)}>
              Create one
            </Button>
          }
        >
          Open a four-player bracket and let bots fill the empty seats.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.map((t) => (
            <li key={t.id}>
              <Row t={t} you={profile.id} />
            </li>
          ))}
        </ul>
      )}
      <CreateTournament open={creating} onClose={() => setCreating(false)} defaultGame={filter === "all" ? undefined : filter} />
    </div>
  );
}

function Row({ t, you }: { t: TournamentState; you: string }) {
  const joined = t.entrants.some((e) => e.id === you);
  return (
    <Link href={t.link} className="card flex items-center gap-3 no-underline">
      <Icon3D name={GAME_ICONS[t.gameId] ?? "controller"} size={40} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <b className="truncate font-semibold">{t.gameName}</b>
          <StateChip state={t.state} />
          {joined && <span className="chip bg-you-soft text-you">You’re in</span>}
        </span>
        <span className="text-small text-ink-2">
          {t.state === "finished" && t.champion ? `Champion: ${t.champion.name}` : `${t.entrants.length}/${t.size} players`}
        </span>
      </span>
      <span className="flex -space-x-2">
        {t.entrants.map((e, i) => (
          <Avatar3D key={`${e.id}-${i}`} id={e.id} bot={e.bot} size="sm" />
        ))}
      </span>
    </Link>
  );
}
