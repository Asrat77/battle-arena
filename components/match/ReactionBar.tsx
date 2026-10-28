"use client";

// The reaction buttons in the match bottom bar, and the reactions floating up
// over the board. Players get clap, wow and GG; spectators also get the flame.

import { Icon3D } from "@/components/ui/Icon3D";
import { useToast } from "@/components/ui/Toast";
import { useReactions } from "@/lib/useReactions";
import { PLAYER_BAR, REACTION_ART as ALL, SPECTATOR_BAR } from "./reactions";

export function ReactionBar({ matchId, spectating }: { matchId: string; spectating: boolean }) {
  const { floating, react, blocked, ready } = useReactions(matchId);
  const toast = useToast();
  const slowDown = (retryAt: number) =>
    toast.show({
      icon: "hourglass",
      tone: "warn",
      duration: Math.max(1500, retryAt - Date.now()),
      body: <span className="font-semibold">Slow down, try again in {Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} s</span>,
    });

  return (
    <>
      <div role="group" aria-label="Reactions" className="flex flex-none items-center gap-1.5">
        {(spectating ? SPECTATOR_BAR : PLAYER_BAR).map((k) => {
          const r = ALL[k];
          return (
            <button
              key={k}
              type="button"
              aria-label={`React ${r.label}`}
              disabled={!ready || blocked}
              onClick={() => react(k, slowDown)}
              className="flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-sf font-mono text-[13px] font-bold text-ink transition-[transform,opacity] active:scale-90 disabled:opacity-40"
            >
              {r.icon ? <Icon3D name={r.icon} size={28} /> : "GG"}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="sr-only">
        {floating.map((f) => `${f.name} reacted ${ALL[f.key]?.label ?? f.key}.`).join(" ")}
      </div>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
        {floating.map((f) => {
          const r = ALL[f.key];
          // Spread overlapping reactions sideways so each stays visible.
          const dx = ((f.id * 37) % 5) * 36 - 72;
          return (
            <div
              key={f.id}
              className="absolute top-[42%] flex w-24 animate-floatup flex-col items-center gap-1"
              style={{ left: `calc(50% + ${dx}px)` }}
            >
              {r?.icon ? (
                <Icon3D name={r.icon} size={96} className="drop-shadow-[0_12px_20px_rgb(0_0_0/.5)]" />
              ) : (
                <span className="flex h-24 items-center font-mono text-[40px] font-bold text-accent">GG</span>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold bg-sf text-ink shadow-float ${f.mine ? "ring-2 ring-you" : ""}`}
              >
                {f.name}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
