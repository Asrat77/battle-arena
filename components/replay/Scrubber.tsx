"use client";

// Media-style controls for a replay: first, prev, play/pause, next, last, a
// slider and a speed chip. ← → step and Space plays while focus is not in a
// text field. Playing stops by itself at the last step.

import { useEffect, useRef } from "react";

const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
/** Time per step at 1×. */
const STEP_MS = 1100;

export function Scrubber({
  pos,
  last,
  onSeek,
  playing,
  onPlaying,
  speed,
  onSpeed,
  label,
}: {
  pos: number;
  /** Highest step (the log length). */
  last: number;
  onSeek(pos: number): void;
  playing: boolean;
  onPlaying(playing: boolean): void;
  speed: Speed;
  onSpeed(speed: Speed): void;
  /** "Step 3 of 10 · Round 2" */
  label: string;
}) {
  const at = Math.min(Math.max(pos, 0), last);
  const seek = (p: number) => onSeek(Math.min(Math.max(p, 0), last));

  useEffect(() => {
    if (!playing) return;
    if (at >= last) {
      onPlaying(false);
      return;
    }
    const t = setTimeout(() => onSeek(at + 1), STEP_MS / speed);
    return () => clearTimeout(t);
  }, [playing, at, last, speed, onSeek, onPlaying]);

  // Keyboard shortcuts read the latest values through a ref so the listener
  // is attached once.
  const keys = useRef({ at, last, playing, seek, onPlaying });
  keys.current = { at, last, playing, seek, onPlaying };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (el?.closest("input:not([type=range]), textarea, select, [contenteditable=true]")) return;
      const k = keys.current;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (el?.matches("input[type=range]")) return; // the slider handles its own arrows
        e.preventDefault();
        k.onPlaying(false);
        k.seek(k.at + (e.key === "ArrowLeft" ? -1 : 1));
      } else if (e.key === " " && !el?.closest("button, a")) {
        e.preventDefault();
        toggle(k);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (k = keys.current) => {
    if (k.playing) return k.onPlaying(false);
    if (k.at >= k.last) k.seek(0);
    k.onPlaying(true);
  };

  const step = (p: number) => {
    onPlaying(false);
    seek(p);
  };

  return (
    <div className="card flex flex-col gap-3" data-testid="scrubber">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold" aria-live="polite">
          {label}
        </span>
        <span className="flex items-center gap-1.5 text-small text-ink-3">
          <span className="hidden items-center gap-1.5 md:flex">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>step
            <Kbd>Space</Kbd>play
          </span>
          <button
            type="button"
            className="chip !h-6 font-mono"
            onClick={() => onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
            aria-label={`Playback speed ${speed}×, change`}
          >
            {speed}×
          </button>
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(last, 0)}
        value={at}
        onChange={(e) => step(Number(e.target.value))}
        aria-label="Replay position"
        aria-valuetext={label}
        className="h-6 w-full cursor-pointer accent-accent"
      />
      <div className="flex items-center justify-center gap-2.5">
        <Ctl label="First step" onClick={() => step(0)} disabled={at === 0}>
          |◂
        </Ctl>
        <Ctl label="Previous step" onClick={() => step(at - 1)} disabled={at === 0}>
          ◂
        </Ctl>
        <Ctl label={playing ? "Pause" : "Play"} onClick={() => toggle()} disabled={last === 0} primary>
          {playing ? "❚❚" : "▶"}
        </Ctl>
        <Ctl label="Next step" onClick={() => step(at + 1)} disabled={at >= last}>
          ▸
        </Ctl>
        <Ctl label="Last step" onClick={() => step(last)} disabled={at >= last}>
          ▸|
        </Ctl>
      </div>
    </div>
  );
}

function Ctl({
  label,
  primary,
  children,
  ...rest
}: { label: string; primary?: boolean; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex flex-none items-center justify-center rounded-2xl font-mono font-semibold transition-transform duration-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 ${
        primary ? "h-14 w-14 bg-action text-[18px] text-action-ink" : "h-12 w-12 bg-sf-2 text-[16px] text-ink"
      }`}
      {...rest}
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md bg-sf-2 px-1.5 font-mono text-[11px] text-ink-2 shadow-edge">{children}</kbd>;
}
