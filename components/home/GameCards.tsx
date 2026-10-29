"use client";

// The game cards on Home. Quick match goes to the queue screen, the key
// opens a private room, and Rules opens the How to play sheet. Queue and live
// counts poll /api/games; the cards render straight away and the counts fill in.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Icon3D } from "@/components/ui/Icon3D";
import { GAME_CATALOG, type GameId } from "@/lib/gameCatalog";
import { api, type GameSummary } from "@/lib/api";
import { RulesSheet } from "./RulesSheet";

const POLL_MS = 5000;

const GAMES = GAME_CATALOG;

export function GameCards() {
  const [counts, setCounts] = useState<Record<string, GameSummary> | null>(null);
  const [failed, setFailed] = useState(false);
  const [rules, setRules] = useState<GameId | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const nudge = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * 360, behavior: "smooth" });
  const closeRules = useCallback(() => setRules(null), []);

  const load = useCallback(
    () =>
      api.games().then(
        (games) => {
          setCounts(Object.fromEntries(games.map((g) => [g.id, g])));
          setFailed(false);
        },
        () => setFailed(true),
      ),
    [],
  );

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="flex flex-col gap-3.5 md:gap-[22px] lg:min-h-0 lg:flex-1">
      <div className="hidden items-center gap-2.5 px-0.5 lg:flex">
        <h2 className="text-h2">Games</h2>
        <span className="chip font-mono tabular-nums">{GAMES.length}</span>
        <span className="flex-1" />
        <Button size="sm" aria-label="Previous games" onClick={() => nudge(-1)}>
          ‹
        </Button>
        <Button size="sm" aria-label="More games" onClick={() => nudge(1)}>
          ›
        </Button>
      </div>
      <div
        ref={strip}
        tabIndex={0}
        aria-label="Games"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3.5 md:gap-4 lg:flex lg:min-h-0 lg:flex-1 lg:snap-x lg:snap-mandatory lg:items-start lg:overflow-x-auto lg:overscroll-x-contain lg:pb-3 lg:[scrollbar-width:thin]"
      >
        {GAMES.map((g) => (
          <GameCard key={g.id} game={g} count={counts?.[g.id]} onRules={() => setRules(g.id)} />
        ))}
      </div>
      {failed && (
        <div role="alert" className="flex animate-slide items-center gap-3 rounded-[20px] bg-sf-2 p-3 shadow-edge">
          <Icon3D name="satellite" size={40} />
          <div className="flex flex-1 flex-col">
            <b className="text-small font-semibold">Can’t load games right now</b>
            <span className="text-small text-ink-2">Your profile is safe. Retrying in {POLL_MS / 1000} s.</span>
          </div>
          <Button size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      <RulesSheet game={rules} onClose={closeRules} />
    </div>
  );
}

function GameCard({
  game,
  count,
  onRules,
}: {
  game: (typeof GAMES)[number];
  count?: GameSummary;
  onRules: () => void;
}) {
  const quiet = count?.queue === 0;
  return (
    <section
      aria-labelledby={`game-${game.id}`}
      className="relative flex flex-col gap-3 overflow-hidden rounded-game bg-sf p-4 md:min-h-[300px] md:gap-3.5 lg:h-full lg:max-h-[560px] lg:w-[400px] lg:flex-none lg:snap-start lg:min-h-[380px] md:rounded-[32px] md:p-[22px] [.light_&]:shadow-[0_0_0_1px_rgb(var(--ln))]"
    >
      <Icon3D
        name={game.art}
        size={210}
        className="pointer-events-none absolute -right-3.5 -top-2.5 h-[150px] w-[150px] drop-shadow-[0_16px_24px_rgba(0,0,0,.5)] md:-right-5 md:-top-4 md:h-[210px] md:w-[210px]"
      />
      <div className="relative flex flex-col gap-1 pr-[120px] md:gap-1.5 md:pr-[150px]">
        <span className="eyebrow">{game.kicker}</span>
        <h2 id={`game-${game.id}`} className="text-[24px] font-semibold leading-[1.05] tracking-[-.04em] md:text-[32px] md:leading-none">
          {game.name}
        </h2>
        <span className="text-small text-ink-2 md:text-base">{game.blurb}</span>
      </div>
      <div className="hidden flex-1 md:block" />
      <div className="relative flex items-center gap-2.5 text-small text-ink-2" aria-live="polite">
        <span className="flex items-center gap-[5px]">
          <i className="block h-[7px] w-[7px] rounded-full bg-recorded" aria-hidden />
          <span className="font-mono tabular-nums">{count ? count.queue : "–"}</span> in queue
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="font-mono tabular-nums">{count ? count.live : "–"}</span> live
        </span>
        <span className="flex-1" />
        <button type="button" className="chip" onClick={onRules} aria-haspopup="dialog">
          <Icon3D name="manual" size={18} />
          Rules
        </button>
      </div>
      <div className="relative flex gap-2">
        <ButtonLink href={`/queue/${game.id}`} variant="act" icon="lightning" className="flex-1">
          Quick match
        </ButtonLink>
        <ButtonLink href={`/r/new?game=${game.id}`} icon="key" aria-label="Private room" className="px-4 md:px-5">
          <span className="hidden md:inline">Private room</span>
        </ButtonLink>
      </div>
      {quiet && (
        <span className="relative flex items-center gap-2 text-small text-ink-2">
          <Icon3D name="robot" size={24} />
          Nobody queued? A bot is offered after 10 seconds.
        </span>
      )}
    </section>
  );
}
