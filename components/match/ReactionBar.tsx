"use client";

// The reaction buttons in the match bottom bar, and the reactions floating up
// over the board. Players get clap, wow, laugh and GG; spectators also get the flame.

import { useRef, useState } from "react";
import { Icon3D } from "@/components/ui/Icon3D";
import { useToast } from "@/components/ui/Toast";
import { useReactions } from "@/lib/useReactions";
import { PLAYER_BAR, REACTION_ART as ALL, SPECTATOR_BAR } from "./reactions";

export function ReactionBar({ matchId, spectating }: { matchId: string; spectating: boolean }) {
  const { floating, react, blocked, ready } = useReactions(matchId);
  const toast = useToast();
  // The button just pressed pops, and a short "Sent" shows under the group.
  const [sent, setSent] = useState<{ key: string; n: number } | null>(null);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const send = (k: string) => {
    react(k, slowDown);
    setSent((s) => ({ key: k, n: (s?.n ?? 0) + 1 }));
    clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSent(null), 900);
    navigator.vibrate?.(15);
  };
  const slowDown = (retryAt: number) =>
    toast.show({
      icon: "hourglass",
      tone: "warn",
      duration: Math.max(1500, retryAt - Date.now()),
      body: <span className="font-semibold">Slow down, try again in {Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} s</span>,
    });

  return (
    <>
      <div role="group" aria-label="Send a reaction" className="relative flex flex-none items-center gap-1.5">
        <span aria-hidden className="mr-0.5 hidden text-[11px] font-semibold uppercase tracking-wide text-ink-3 sm:block">
          React
        </span>
        {(spectating ? SPECTATOR_BAR : PLAYER_BAR).map((k) => {
          const r = ALL[k];
          return (
            <button
              key={k}
              type="button"
              aria-label={`React ${r.label}`}
              title={`Send ${r.label}`}
              disabled={!ready || blocked}
              onClick={() => send(k)}
              className="flex h-11 w-11 flex-none flex-col items-center justify-center rounded-[14px] bg-sf font-mono text-[13px] font-bold text-ink transition-[transform,opacity] active:scale-90 disabled:opacity-40 sm:h-[52px] sm:w-14"
            >
              <span key={sent?.key === k ? sent.n : 0} className={sent?.key === k ? "animate-callout" : undefined}>
                {r.icon ? <Icon3D name={r.icon} size={28} /> : "GG"}
              </span>
              <span aria-hidden className="hidden font-sans text-[10px] font-semibold leading-none text-ink-3 sm:mt-0.5 sm:block">
                {r.short}
              </span>
            </button>
          );
        })}
        {sent && (
          <span aria-hidden className="absolute -top-5 left-0 animate-slide text-[11px] font-semibold text-accent">
            Sent
          </span>
        )}
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
