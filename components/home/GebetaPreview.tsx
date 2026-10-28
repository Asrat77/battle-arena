"use client";

// Signed out, under the name field: two bots play real Gebeta on the shared
// board with the live sowing animation, so a first-time visitor sees a game
// before they join. Runs the engine locally, nothing goes to the server. It
// pauses off screen, and with reduced motion it starts paused and steps on tap.

import { useEffect, useMemo, useRef, useState } from "react";
import { moveLine } from "@/components/gebeta/adapter";
import { GebetaBoard, type BoardPlayer } from "@/components/gebeta/GebetaBoard";
import { gebetaStatus } from "@/components/gebeta/status";
import { useSowing } from "@/components/gebeta/useSowing";
import { Button } from "@/components/ui/Button";
import { gebeta, type GebetaState } from "@/engine/games/gebeta";
import { createRng } from "@/engine/rng";
import type { Rng } from "@/engine/types";

/** Breather after a move settles, so each one reads on its own. */
const PAUSE_MS = 700;
/** How long the final score stays up before a new round. */
const END_MS = 3_500;

const PLAYERS: [BoardPlayer, BoardPlayer] = [
  { id: "preview-selam", name: "Selam", bot: true },
  { id: "preview-dawit", name: "Dawit", bot: true },
];
const NAMES: [string, string] = [PLAYERS[0].name, PLAYERS[1].name];

interface Round {
  n: number;
  state: GebetaState;
  rng: Rng;
}

const newRound = (n: number): Round => {
  const seed = `landing-preview-${n}`;
  return { n, state: gebeta.setup({ seed }), rng: createRng(seed) };
};

function advance(r: Round): Round {
  if (r.state.over) return newRound(r.n + 1);
  const seat = r.state.turn;
  const move = gebeta.bot(gebeta.view(r.state, seat), seat, r.rng);
  return { ...r, state: gebeta.apply(r.state, seat, move) };
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function GebetaPreview() {
  const [round, setRound] = useState(() => newRound(0));
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [inView, setInView] = useState(false);
  const box = useRef<HTMLElement>(null);

  // useSowing plans a move whenever the view object changes, so keep it stable.
  const view = useMemo(() => gebeta.view(round.state, "spectator"), [round.state]);
  const { frame, moment, skip } = useSowing(view);
  const settled = !frame && !moment;

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return setInView(true);
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !inView || !settled) return;
    const t = setTimeout(() => setRound(advance), round.state.over ? END_MS : PAUSE_MS);
    return () => clearTimeout(t);
  }, [playing, inView, settled, round]);

  const callout =
    moment &&
    (moment.kind === "capture"
      ? { text: `+${moment.n} captured`, at: "center" as const, key: moment.key }
      : { text: `${NAMES[moment.mover]} goes again`, at: moment.mover, key: moment.key });

  const line = view.moves === 0 ? "New game · 4 seeds in every pit" : moveLine(view, NAMES);

  return (
    <section
      ref={box}
      aria-labelledby="preview-title"
      className="relative mx-auto mt-6 flex max-w-[960px] flex-col gap-4 px-1.5 pb-10 md:mt-14 md:px-0"
      data-testid="gebeta-preview"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow">Preview · Gebeta, two bots</span>
          <h2 id="preview-title" className="text-h2">
            A round of Gebeta, sown seed by seed.
          </h2>
          <p className="m-0 max-w-[560px] text-small text-ink-2">
            Last seed in your own store and you go again. Last seed in an empty pit on your side takes the pit
            opposite. Most seeds in store wins.
          </p>
        </div>
        <div className="flex gap-2">
          {!playing && (
            <Button size="sm" disabled={!settled} onClick={() => setRound(advance)}>
              Next move
            </Button>
          )}
          <Button size="sm" aria-pressed={!playing} onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause" : "Play"}
          </Button>
        </div>
      </div>

      <GebetaBoard
        pits={frame?.pits ?? view.pits}
        stores={frame?.stores ?? view.stores}
        seat={0}
        players={PLAYERS}
        spectating
        size="sm"
        last={view.last}
        hit={frame?.hit}
        flash={moment?.spots}
        glow={moment ? moment.mover : null}
        callout={callout}
        onSkip={frame ? skip : undefined}
        className="w-full"
      />
      <p className="min-h-[18px] text-center font-mono text-[12.5px] font-semibold tabular-nums text-ink-2">
        {view.over ? `${gebetaStatus(view, "spectator", NAMES)} · next round soon` : line}
      </p>
    </section>
  );
}
