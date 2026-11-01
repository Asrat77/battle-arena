"use client";

// /t/<id>: the bracket. Semifinals and the final as cards, with a Play link
// to your own live match and Watch/Replay for the rest. Open tournaments show
// the seats, with Join / Leave and, for the host, Add bots.

import { PlayerLink } from "@/components/profile/PlayerSheet";
import { useState } from "react";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon3D } from "@/components/ui/Icon3D";
import { type TournamentEntrant, type TournamentState } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTournament } from "@/lib/useTournament";
import { GAME_ICONS, Name, StateChip } from "./shared";
import { Page } from "@/components/ui/Page";
import { Bracket } from "./Bracket";

export function TournamentScreen({ id }: { id: string }) {
  const { phase, busy, send, retry } = useTournament(id);
  const { profile } = useSession();
  const [error, setError] = useState<string | null>(null);

  if (phase.kind === "loading") {
    return (
      <p className="py-16 text-center text-ink-2" role="status">
        Loading the bracket…
      </p>
    );
  }
  if (phase.kind !== "ready") {
    const missing = phase.kind === "missing";
    return (
      <EmptyState
        icon={missing ? "err404" : "satellite"}
        title={missing ? "No such tournament" : "Couldn’t load the bracket"}
        action={
          missing ? (
            <ButtonLink href="/tournaments" variant="act" icon="trophy">
              All tournaments
            </ButtonLink>
          ) : (
            <Button icon="refresh" onClick={retry}>
              Try again
            </Button>
          )
        }
      />
    );
  }

  const t = phase.t;
  const me = profile?.id;
  const joined = Boolean(me) && t.entrants.some((e) => e.id === me);
  const isHost = Boolean(me) && t.host === me;
  const act = async (event: "tournament:join" | "tournament:leave" | "tournament:start") => {
    setError(await send(event));
  };

  return (
    <Page width="wide" className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <Icon3D name={GAME_ICONS[t.gameId] ?? "controller"} size={44} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="eyebrow">Tournament</span>
          <h1 className="text-h2 truncate">{t.name}</h1>
          <span className="text-small text-ink-2">
            {t.gameName} · {t.size} players · {t.bestOf === 3 ? "Best of 3" : "Single game"}
            {t.visibility === "link" ? " · Link only" : ""}
          </span>
        </div>
        <StateChip state={t.state} />
      </header>

      {t.champion && <Champion champion={t.champion} you={me} />}

      {t.state === "open" ? (
        <Lobby t={t} joined={joined} isHost={isHost} signedIn={Boolean(me)} busy={busy} act={act} />
      ) : (
        <Bracket t={t} you={me} />
      )}

      {error && (
        <p role="alert" className="text-small text-mismatch">
          {error}
        </p>
      )}
      <ButtonLink href="/tournaments" variant="ghost" block>
        All tournaments
      </ButtonLink>
    </Page>
  );
}

function Champion({ champion, you }: { champion: TournamentEntrant; you?: string }) {
  const mine = !champion.bot && champion.id === you;
  return (
    <div className="card flex items-center gap-3 !bg-pending-soft" role="status">
      <Icon3D name="trophy" size={56} className="animate-bob" />
      <div className="flex min-w-0 flex-col">
        <span className="eyebrow">Champion</span>
        <PlayerLink id={champion.id} bot={champion.bot || mine} className="truncate">
          <b className="truncate text-lg">{mine ? "You won the tournament!" : champion.name}</b>
        </PlayerLink>
        {mine && <span className="text-small text-ink-2">+30 bonus points and the Champion badge.</span>}
      </div>
      <Avatar3D id={champion.id} bot={champion.bot} className="ml-auto" />
    </div>
  );
}

function Lobby({
  t,
  joined,
  isHost,
  signedIn,
  busy,
  act,
}: {
  t: TournamentState;
  joined: boolean;
  isHost: boolean;
  signedIn: boolean;
  busy: boolean;
  act(e: "tournament:join" | "tournament:leave" | "tournament:start"): void;
}) {
  const seats = Array.from({ length: t.size }, (_, i) => t.entrants[i]);
  return (
    <section className="flex flex-col gap-3" aria-label="Entrants">
      <p className="text-ink-2">
        {t.entrants.length}/{t.size} players. It starts when the bracket is full{isHost ? ", or start it early and bots take the empty seats" : ""}.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {seats.map((e, i) => (
          <li key={i} className="card flex items-center gap-3 !py-3">
            {e ? (
              <PlayerLink id={e.id} bot={e.bot} className="flex items-center gap-3">
                <Avatar3D id={e.id} bot={e.bot} size="sm" />
                <Name name={e.name} bot={e.bot} />
              </PlayerLink>
            ) : (
              <>
                <span className="h-[34px] w-[34px] rounded-[11px] border-2 border-dashed border-sf-3" />
                <span className="text-ink-3">Open seat</span>
              </>
            )}
          </li>
        ))}
      </ul>
      {signedIn && !joined && (
        <Button variant="act" block icon="swords" loading={busy} onClick={() => act("tournament:join")}>
          Join
        </Button>
      )}
      {isHost && (
        <Button variant="act" block icon="robot" loading={busy} onClick={() => act("tournament:start")}>
          Start now with bots
        </Button>
      )}
      {joined && (
        <Button variant="ghost" block loading={busy} onClick={() => act("tournament:leave")}>
          Leave
        </Button>
      )}
    </section>
  );
}
