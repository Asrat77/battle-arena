"use client";

// One 8×8 sea: animated water, grid, coordinates, ships, wrecks and shot marks.
// Interaction is layered on top by the caller (`overlay`, in HTML) so the same
// sea serves placement, the target board and the player's own waters.

import { useId, type ReactNode, type Ref } from "react";
import { COLS, FLEET, SIZE, shipCells, type Fleet, type Shot, type SunkShip } from "@/engine/games/battleship";
import { GlowDef, HitMark, MissMark, ShipSprite, UNIT } from "./sprites";

const VIEW = SIZE * UNIT;

export interface SeaProps {
  /** Ships to draw afloat (or as wrecks once sunk). Null hides the fleet. */
  fleet?: Fleet | null;
  /** Ships of this sea that are sunk, drawn as wrecks. */
  wrecks: readonly SunkShip[];
  /** Shots that landed on this sea. */
  shots: readonly Shot[];
  /** Square of the newest shot on this sea, with a key that changes per shot. */
  fresh?: { cell: number; key: number } | null;
  tint: string;
  compact?: boolean;
  label: string;
  /** Extra SVG layers above the ships (ghosts, reticle). */
  layers?: ReactNode;
  /** HTML layer above the sea, sized to the 8×8 grid (buttons). */
  overlay?: ReactNode;
  seaRef?: Ref<HTMLDivElement>;
  /** Per-ship tweaks while placing: hide the one being dragged, outline the selected one. */
  shipStyle?: (ship: number) => { hidden?: boolean; selected?: boolean };
  /** Shakes the sea, e.g. when the viewer's own ship is hit. */
  shake?: boolean;
  className?: string;
}

export function Sea({ fleet, wrecks, shots, fresh, tint, compact = false, label, layers, overlay, seaRef, shipStyle, shake = false, className = "" }: SeaProps) {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const ids = { glow: `${uid}-glow`, water: `${uid}-water`, waves: `${uid}-waves`, shade: `${uid}-shade`, clip: `${uid}-clip`, rim: `${uid}-rim` };
  const sunkIds = new Set(wrecks.map((w) => w.ship));
  const wreckCells = new Set(wrecks.flatMap((w) => shipCells(w.at, FLEET[w.ship].size) ?? []));
  const labelClass = `mono select-none text-center font-semibold ${compact ? "text-[9px] sm:text-[10px]" : "text-[10px] sm:text-[11px]"}`;

  return (
    <div className={`rounded-[22px] p-1.5 sm:p-2 ${className}`} style={{ background: "var(--sea-frame)" }}>
      <div className={`grid ${compact ? "grid-cols-[12px_minmax(0,1fr)] gap-0.5" : "grid-cols-[14px_minmax(0,1fr)] gap-1 sm:grid-cols-[16px_minmax(0,1fr)]"}`}>
        <span aria-hidden />
        <div className="grid grid-cols-8" aria-hidden style={{ color: "var(--sea-label)" }}>
          {COLS.split("").map((c) => <span key={c} className={labelClass}>{c}</span>)}
        </div>
        <div className="grid grid-rows-8" aria-hidden style={{ color: "var(--sea-label)" }}>
          {Array.from({ length: SIZE }, (_, r) => <span key={r} className={`${labelClass} flex items-center justify-center`}>{r + 1}</span>)}
        </div>
        <div ref={seaRef} className={`relative aspect-square w-full overflow-hidden rounded-[16px] ${shake ? "animate-shake" : ""}`}>
          <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="absolute inset-0 h-full w-full" role="img" aria-label={label}>
            <defs>
              <radialGradient id={ids.water} cx="50%" cy="42%" r="75%">
                <stop offset="0" stopColor="var(--sea-glow)" />
                <stop offset="0.55" stopColor="var(--sea-mid)" />
                <stop offset="1" stopColor="var(--sea-deep)" />
              </radialGradient>
              <pattern id={ids.waves} width={200} height={90} patternUnits="userSpaceOnUse">
                <path d="M 0 30 Q 25 18 50 30 T 100 30 T 150 30 T 200 30" fill="none" stroke="var(--sea-crest)" strokeWidth={4} strokeLinecap="round" />
                <path d="M -50 75 Q -25 63 0 75 T 50 75 T 100 75 T 150 75 T 200 75 T 250 75" fill="none" stroke="var(--sea-crest)" strokeWidth={3} strokeLinecap="round" />
              </pattern>
              <radialGradient id={ids.shade} cx="50%" cy="50%" r="72%">
                <stop offset="0.7" stopColor="#000" stopOpacity={0} />
                <stop offset="1" stopColor="#000" stopOpacity={0.28} />
              </radialGradient>
              <filter id={ids.rim} x="-10%" y="-20%" width="120%" height="150%">
                <feDropShadow dx={0} dy={7} stdDeviation={5} style={{ floodColor: "var(--sea-shadow)" }} />
              </filter>
              <GlowDef id={ids.glow} />
            </defs>

            <rect width={VIEW} height={VIEW} fill={`url(#${ids.water})`} />
            <g className="sea-drift">
              <rect x={0} y={0} width={VIEW + 400} height={VIEW + 100} fill={`url(#${ids.waves})`} />
            </g>
            <g className="sea-shimmer">
              {[[180, 210, 120], [560, 160, 90], [420, 560, 140], [130, 640, 80]].map(([cx, cy, r]) => (
                <ellipse key={cx} cx={cx} cy={cy} rx={r} ry={r * 0.45} fill="var(--sea-glow)" fillOpacity={0.18} />
              ))}
            </g>
            <g stroke="var(--sea-line)" strokeWidth={2}>
              {Array.from({ length: SIZE - 1 }, (_, i) => (i + 1) * UNIT).map((v) => (
                <g key={v}>
                  <line x1={v} x2={v} y1={0} y2={VIEW} />
                  <line y1={v} y2={v} x1={0} x2={VIEW} />
                </g>
              ))}
            </g>
            <rect width={VIEW} height={VIEW} fill={`url(#${ids.shade})`} />

            <g filter={`url(#${ids.rim})`}>
              {wrecks.map((w) => <ShipSprite key={`w${w.ship}`} ship={w.ship} at={w.at} look="wreck" tint={tint} />)}
              {fleet?.map((at, ship) => {
                const style = shipStyle?.(ship);
                return sunkIds.has(ship) || style?.hidden ? null : <ShipSprite key={ship} ship={ship} at={at} tint={tint} selected={style?.selected} />;
              })}
            </g>

            {shots.map((s) => {
              const isFresh = fresh?.cell === s.cell;
              return s.hit
                ? <HitMark key={isFresh ? `f${fresh!.key}` : s.cell} cell={s.cell} glow={ids.glow} sunk={wreckCells.has(s.cell)} fresh={isFresh} />
                : <MissMark key={isFresh ? `f${fresh!.key}` : s.cell} cell={s.cell} fresh={isFresh} />;
            })}
            {layers}
          </svg>
          {overlay}
        </div>
      </div>
    </div>
  );
}
