// Top-down ship sprites and shot marks for the Battleship sea. Everything is
// drawn in sea units: one square is 100×100, a ship lies along +x with its bow
// on the right and is turned 90° for "v" placements (bow at the bottom).

import type { ReactNode } from "react";
import { FLEET, SIZE, type Placement, type ShipId } from "@/engine/games/battleship";

export const UNIT = 100;

type Look = "afloat" | "wreck" | "ghost" | "bad";

interface Paint {
  rim: string;
  edge: string;
  deck: string;
  deckHi: string;
  plank: string;
  block: string;
  roof: string;
  gun: string;
  gunTop: string;
  barrel: string;
  stack: string;
  sub: string;
  subHi: string;
}

const STEEL: Paint = {
  rim: "#1f2830", edge: "#566370", deck: "#8d9aa7", deckHi: "#b4c0cb", plank: "rgb(255 255 255 / .10)",
  block: "#cfd7de", roof: "#eef2f5", gun: "#45505c", gunTop: "#7c8996", barrel: "#262e36", stack: "#353c44",
  sub: "#26313d", subHi: "#3e4c5c",
};
const WRECK: Paint = {
  rim: "#120c0a", edge: "#3b2b24", deck: "#4c3a31", deckHi: "#5f4a3e", plank: "rgb(0 0 0 / .18)",
  block: "#5c4c44", roof: "#6c5a50", gun: "#2c221d", gunTop: "#3f322b", barrel: "#160f0c", stack: "#1b1411",
  sub: "#2a211d", subHi: "#3a2e28",
};

/** Hull outline from stern x0 to bow tip x1, `half` wide either side of the centre line. */
function hull(x0: number, x1: number, half: number) {
  const t = 50 - half, b = 50 + half;
  const s = x0 + Math.min(26, (x1 - x0) * 0.12);
  const p = x1 - Math.min(78, (x1 - x0) * 0.32);
  const c = p + (x1 - p) * 0.55;
  return `M ${x0} 50 C ${x0} ${t + half * 0.35} ${x0 + 5} ${t} ${s} ${t} L ${p} ${t} C ${c} ${t} ${x1 - 5} ${50 - half * 0.42} ${x1} 50 `
    + `C ${x1 - 5} ${50 + half * 0.42} ${c} ${b} ${p} ${b} L ${s} ${b} C ${x0 + 5} ${b} ${x0} ${b - half * 0.35} ${x0} 50 Z`;
}

function Turret({ x, face, p, r = 12, twin = true }: { x: number; face: 1 | -1; p: Paint; r?: number; twin?: boolean }) {
  const len = r * 2.3;
  const bx = face === 1 ? x : x - len;
  return (
    <g>
      {twin ? (
        <>
          <rect x={bx} y={44} width={len} height={4} rx={2} fill={p.barrel} />
          <rect x={bx} y={52} width={len} height={4} rx={2} fill={p.barrel} />
        </>
      ) : <rect x={bx} y={48} width={len} height={4.5} rx={2} fill={p.barrel} />}
      <circle cx={x} cy={50} r={r} fill={p.gun} stroke={p.rim} strokeWidth={2} />
      <circle cx={x - face * 1.5} cy={50} r={r - 4.5} fill={p.gunTop} />
      <circle cx={x - face * 3} cy={46} r={2.6} fill="#fff" fillOpacity={0.3} />
    </g>
  );
}

function Block({ x0, x1, h, p }: { x0: number; x1: number; h: number; p: Paint }) {
  return (
    <g>
      <rect x={x0} y={50 - h / 2} width={x1 - x0} height={h} rx={7} fill={p.block} stroke={p.rim} strokeWidth={2} />
      <rect x={x0 + 5} y={50 - h / 2 + 4} width={x1 - x0 - 10} height={h / 2 - 4} rx={4} fill={p.roof} opacity={0.75} />
    </g>
  );
}

function Stack({ x, p, rx = 11 }: { x: number; p: Paint; rx?: number }) {
  return (
    <g>
      <ellipse cx={x} cy={50} rx={rx} ry={rx * 0.72} fill={p.stack} stroke={p.rim} strokeWidth={2} />
      <ellipse cx={x + 1} cy={50} rx={rx * 0.55} ry={rx * 0.38} fill="#0b0d10" />
    </g>
  );
}

function Planks({ x0, x1 }: { x0: number; x1: number }) {
  return <g stroke="currentColor" strokeWidth={1.2}>{[42, 50, 58].map((y) => <line key={y} x1={x0} x2={x1} y1={y} y2={y} />)}</g>;
}

function Warship({ w, half, p, tint, children }: { w: number; half: number; p: Paint; tint: string; children: ReactNode }) {
  return (
    <>
      <path d={hull(10, w - 6, half)} fill={p.edge} stroke={p.rim} strokeWidth={2.5} />
      <path d={hull(17, w - 17, half - 6)} fill={p.deck} />
      <path d={hull(24, w - 40, half - 13)} fill={p.deckHi} opacity={0.55} />
      <g style={{ color: p.plank }}><Planks x0={30} x1={w - 60} /></g>
      <path d={`M ${w - 72} ${50 - half + 9} L ${w - 52} 50 L ${w - 72} ${50 + half - 9}`} fill="none" stroke={tint} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={20} y={45} width={9} height={10} rx={2} fill={tint} />
      {children}
    </>
  );
}

function Submarine({ p, tint }: { p: Paint; tint: string }) {
  const body = "M 20 50 C 20 35 42 31 82 31 L 222 31 C 264 31 287 40 293 50 C 287 60 264 69 222 69 L 82 69 C 42 69 20 65 20 50 Z";
  return (
    <>
      <path d="M 34 50 L 6 33 L 14 50 L 6 67 Z" fill={p.sub} stroke={p.rim} strokeWidth={2} />
      <path d={body} fill={p.sub} stroke={p.rim} strokeWidth={2.5} />
      <path d="M 70 37 C 120 34 220 34 262 40" fill="none" stroke={p.subHi} strokeWidth={5} strokeLinecap="round" />
      <line x1={60} x2={262} y1={50} y2={50} stroke="#fff" strokeOpacity={0.1} strokeWidth={1.5} strokeDasharray="10 7" />
      <ellipse cx={176} cy={50} rx={30} ry={10} fill={p.subHi} stroke={p.rim} strokeWidth={2} />
      <ellipse cx={170} cy={47} rx={18} ry={4} fill="#fff" fillOpacity={0.12} />
      <circle cx={188} cy={50} r={3} fill={p.barrel} />
      <path d="M 244 39 L 258 50 L 244 61" fill="none" stroke={tint} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function Body({ id, p, tint }: { id: ShipId; p: Paint; tint: string }) {
  switch (id) {
    case "battleship":
      return (
        <Warship w={400} half={27} p={p} tint={tint}>
          <Turret x={86} face={-1} p={p} r={14} />
          <Block x0={128} x1={232} h={30} p={p} />
          <Stack x={170} p={p} rx={12} />
          <circle cx={212} cy={50} r={7} fill={p.gun} stroke={p.rim} strokeWidth={1.5} />
          <line x1={205} x2={219} y1={50} y2={50} stroke={p.roof} strokeWidth={2} />
          <Turret x={270} face={1} p={p} r={14} />
          <Turret x={316} face={1} p={p} r={13} />
        </Warship>
      );
    case "cruiser":
      return (
        <Warship w={300} half={24} p={p} tint={tint}>
          <Turret x={64} face={-1} p={p} r={12} />
          <Block x0={98} x1={170} h={26} p={p} />
          <Stack x={124} p={p} rx={10} />
          <circle cx={156} cy={50} r={8} fill="none" stroke={p.gun} strokeWidth={3} />
          <line x1={148} x2={164} y1={50} y2={50} stroke={p.gun} strokeWidth={2} />
          <Turret x={214} face={1} p={p} r={12} />
        </Warship>
      );
    case "destroyer":
      return (
        <Warship w={200} half={21} p={p} tint={tint}>
          <rect x={40} y={43} width={18} height={14} rx={3} fill={p.gun} stroke={p.rim} strokeWidth={1.5} />
          <Block x0={66} x1={112} h={22} p={p} />
          <Stack x={84} p={p} rx={8} />
          <Turret x={136} face={1} p={p} r={10} twin={false} />
        </Warship>
      );
    case "submarine":
      return <Submarine p={p} tint={tint} />;
  }
}

/** Where a ship's local frame goes on the sea. */
export function shipTransform(at: Placement) {
  const x = (at.cell % SIZE) * UNIT, y = Math.floor(at.cell / SIZE) * UNIT;
  return at.dir === "h" ? `translate(${x} ${y})` : `translate(${x + UNIT} ${y}) rotate(90)`;
}

function Wake({ w }: { w: number }) {
  return (
    <g className="sea-wake" fill="none" stroke="var(--sea-foam)" strokeLinecap="round">
      <path d="M 14 38 Q 0 33 -14 26" strokeWidth={4} />
      <path d="M 14 62 Q 0 67 -14 74" strokeWidth={4} />
      <path d="M 8 50 L -10 50" strokeWidth={6} strokeOpacity={0.6} />
      <path d={`M ${w - 10} 44 Q ${w - 24} 26 ${w - 44} 21`} strokeWidth={3} />
      <path d={`M ${w - 10} 56 Q ${w - 24} 74 ${w - 44} 79`} strokeWidth={3} />
    </g>
  );
}

function Scorch({ w }: { w: number }) {
  return (
    <g>
      {[0.22, 0.5, 0.78].map((f, i) => <ellipse key={f} cx={w * f} cy={i % 2 ? 46 : 55} rx={16} ry={10} fill="#000" fillOpacity={0.35} />)}
      <path d={`M ${w * 0.35} 34 L ${w * 0.4} 50 L ${w * 0.36} 66`} fill="none" stroke="#000" strokeOpacity={0.5} strokeWidth={3} />
      {[0.3, 0.62].map((f) => (
        <g key={f} transform={`translate(${w * f} 50)`}>
          <g className="sea-bubble" style={{ animationDelay: `${f * 3}s` }}>
            <circle cx={0} cy={0} r={4} fill="none" stroke="var(--sea-foam)" strokeWidth={1.5} />
            <circle cx={10} cy={6} r={2.5} fill="none" stroke="var(--sea-foam)" strokeWidth={1.2} />
          </g>
        </g>
      ))}
    </g>
  );
}

/**
 * One ship on the sea. `look`: afloat (with a wake), wreck (burnt, sinking),
 * ghost (being dragged) or bad (cannot go here).
 */
export function ShipSprite({ ship, at, look = "afloat", tint, selected = false }: {
  ship: number; at: Placement; look?: Look; tint: string; selected?: boolean;
}) {
  const { id, size } = FLEET[ship];
  const w = size * UNIT;
  const paint = look === "wreck" ? WRECK : STEEL;
  return (
    <g transform={shipTransform(at)} opacity={look === "ghost" ? 0.72 : look === "bad" ? 0.6 : look === "wreck" ? 0.88 : 1}>
      {look === "afloat" && <Wake w={w} />}
      {selected && <rect x={4} y={10} width={w - 8} height={80} rx={40} fill="none" stroke="rgb(var(--acc))" strokeWidth={5} strokeDasharray="14 10" />}
      <g className={look === "afloat" ? "sea-bob" : undefined}>
        <Body id={id} p={paint} tint={look === "wreck" ? "#5a463c" : tint} />
        {look === "wreck" && <Scorch w={w} />}
        {look === "bad" && <path d={hull(10, w - 6, 27)} fill="rgb(var(--bad))" fillOpacity={0.55} />}
      </g>
    </g>
  );
}

/** A ship on its own, for rosters: fills the box it is given, bow right. */
export function ShipIcon({ ship, sunk = false, tint, className = "" }: { ship: number; sunk?: boolean; tint: string; className?: string }) {
  const w = FLEET[ship].size * UNIT;
  return (
    <svg viewBox={`0 18 ${w} 64`} className={className} aria-hidden>
      <g opacity={sunk ? 0.55 : 1}><Body id={FLEET[ship].id} p={sunk ? WRECK : STEEL} tint={sunk ? "#5a463c" : tint} /></g>
      {sunk && <path d={`M 30 30 L ${w - 30} 70 M 30 70 L ${w - 30} 30`} stroke="rgb(var(--bad))" strokeWidth={10} strokeLinecap="round" />}
    </svg>
  );
}

const center = (cell: number) => ({ x: (cell % SIZE) * UNIT + 50, y: Math.floor(cell / SIZE) * UNIT + 50 });

/** A splash where a shot found only water. `fresh` plays the landing. */
export function MissMark({ cell, fresh = false }: { cell: number; fresh?: boolean }) {
  const { x, y } = center(cell);
  return (
    <g transform={`translate(${x} ${y})`}>
      {fresh && (
        <g>
          <circle className="sea-splash" r={40} fill="none" stroke="var(--sea-foam)" strokeWidth={5} />
          <circle className="sea-splash" style={{ animationDelay: ".15s" }} r={28} fill="none" stroke="var(--sea-foam)" strokeWidth={4} />
        </g>
      )}
      <g className={fresh ? "sea-land" : undefined}>
        <circle r={24} fill="none" stroke="var(--sea-foam)" strokeWidth={3} strokeOpacity={0.55} />
        <circle r={13} fill="none" stroke="var(--sea-foam)" strokeWidth={3} strokeOpacity={0.8} />
        <circle r={6} fill="#fff" fillOpacity={0.95} />
      </g>
    </g>
  );
}

/** A hit: burning while the ship is afloat, smoking once it has sunk. */
export function HitMark({ cell, glow, sunk = false, fresh = false }: { cell: number; glow: string; sunk?: boolean; fresh?: boolean }) {
  const { x, y } = center(cell);
  const flame = "M 0 -30 C 9 -18 20 -10 18 4 C 17 18 8 26 0 26 C -8 26 -17 18 -18 4 C -20 -10 -9 -18 0 -30 Z";
  return (
    <g transform={`translate(${x} ${y})`}>
      {fresh && <circle className="sea-boom" r={46} fill="#ffb238" fillOpacity={0.55} />}
      <circle r={48} fill={`url(#${glow})`} opacity={sunk ? 0.3 : 1} />
      {!sunk && <circle r={33} fill="none" stroke="#ff5a1f" strokeWidth={3} strokeOpacity={0.75} strokeDasharray="6 6" />}
      <g transform="translate(-4 -14)"><circle className="sea-smoke" r={12} fill="#3b3631" /></g>
      <g transform="translate(8 -10)"><circle className="sea-smoke" style={{ animationDelay: "1.1s" }} r={10} fill="#4a443e" /></g>
      {sunk ? (
        <g>
          <circle r={9} fill="#ff7a1a" fillOpacity={0.75} />
          <circle r={4} fill="#ffd36b" />
        </g>
      ) : (
        <g className={fresh ? "sea-land" : undefined}>
          <g transform="scale(1.3)">
            <g className="sea-flicker">
              <path d={flame} fill="#ff5a1f" />
              <path d={flame} transform="scale(.68) translate(0 6)" fill="#ffa31a" />
              <path d={flame} transform="scale(.38) translate(0 14)" fill="#fff1a8" />
            </g>
          </g>
        </g>
      )}
    </g>
  );
}

/** The glow behind hits; render once inside each sea's <defs> with that sea's id. */
export function GlowDef({ id }: { id: string }) {
  return (
    <radialGradient id={id}>
      <stop offset="0" stopColor="#ffb02c" stopOpacity={0.95} />
      <stop offset="0.45" stopColor="#ff4d1f" stopOpacity={0.55} />
      <stop offset="1" stopColor="#ff3d1f" stopOpacity={0} />
    </radialGradient>
  );
}

/** Aim ring over a square. */
export function Reticle({ cell }: { cell: number }) {
  const { x, y } = center(cell);
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <g className="sea-reticle">
        <circle r={36} fill="none" stroke="rgb(var(--acc))" strokeWidth={4} strokeDasharray="22 12" />
      </g>
      <circle r={5} fill="rgb(var(--acc))" />
      {[0, 90, 180, 270].map((a) => <line key={a} transform={`rotate(${a})`} x1={14} x2={28} y1={0} y2={0} stroke="rgb(var(--acc))" strokeWidth={4} strokeLinecap="round" />)}
    </g>
  );
}
