"use client";

import { useMemo, useState } from "react";
import type { GameAdapter, ReplayStepProps } from "@/components/match/adapter";
import { dotsAndBoxes, rules, TURN_MS, type DotsMove, type DotsView } from "@/engine/games/dotsAndBoxes";
import { replay } from "@/engine/replay";
import type { Seat, Viewer } from "@/engine/types";
import { GAME_ICONS } from "@/lib/gameCatalog";
import { playerInitials } from "./initials";

const label = (e: number) => e < 30 ? `Horizontal line, row ${Math.floor(e / 5) + 1}, column ${e % 5 + 1}` : `Vertical line, row ${Math.floor((e - 30) / 6) + 1}, column ${(e - 30) % 6 + 1}`;

export function DotsBoard({ view, seat, names, disabled, onMove }: { view: DotsView; seat: Viewer; names: [string, string]; disabled?: boolean; onMove?: (edge: number) => void }) {
  const left: Seat = seat === "spectator" ? 0 : seat;
  const right: Seat = left === 0 ? 1 : 0;
  const color = (s: Seat) => s === left ? "rgb(var(--you))" : "rgb(var(--opp))";
  const softColor = (s: Seat) => s === left ? "var(--you-s)" : "var(--opp-s)";
  const initials = playerInitials(names);
  const canPlay = !disabled && seat !== "spectator" && seat === view.turn && view.moves < 60;
  return <section className="dots-palette mx-auto flex w-full max-w-[460px] flex-col gap-3" aria-label="Dots and Boxes board">
    <div className="card flex items-center justify-between gap-2 text-center font-semibold"><span className="min-w-0 truncate text-you">{seat === left ? "You" : names[left]}</span><span className="mono whitespace-nowrap text-xl" aria-label={`${view.scores[left]} to ${view.scores[right]}`}><span className="text-you">{view.scores[left]}</span> – <span className="text-opp">{view.scores[right]}</span></span><span className="min-w-0 truncate text-opp">{seat === right ? "You" : names[right]}</span></div>
    <div className="relative aspect-square w-full rounded-board bg-sf p-3 shadow-edge">
      <div className="absolute inset-3">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {view.boxes.map((owner, i) => owner === null ? null : <g key={i}><rect x={(i % 5) * 20 + 1} y={Math.floor(i / 5) * 20 + 1} width="18" height="18" rx="2" fill={softColor(owner)} stroke={view.last?.captured.includes(i) ? "rgb(var(--acc))" : "none"} strokeWidth=".7" /><text x={(i % 5) * 20 + 10} y={Math.floor(i / 5) * 20 + 13} textAnchor="middle" fill={color(owner)} fontSize={initials[owner].length > 2 ? "5.5" : "8"} fontWeight="bold">{initials[owner]}</text></g>)}
          {view.edges.map((owner, i) => { const h = i < 30, n = h ? i : i - 30, r = Math.floor(n / (h ? 5 : 6)), c = n % (h ? 5 : 6); return <line key={i} x1={c * 20} y1={r * 20} x2={(c + (h ? 1 : 0)) * 20} y2={(r + (h ? 0 : 1)) * 20} stroke={owner === null ? "rgb(var(--ink2) / .22)" : color(owner)} strokeWidth={view.last?.edge === i ? 2.2 : owner === null ? 1 : 1.6} strokeLinecap="round" />; })}
          {Array.from({ length: 36 }, (_, i) => <circle key={i} cx={(i % 6) * 20} cy={Math.floor(i / 6) * 20} r="2" fill="rgb(var(--ink))" />)}
        </svg>
        {view.edges.map((owner, i) => { const h = i < 30, n = h ? i : i - 30, r = Math.floor(n / (h ? 5 : 6)), c = n % (h ? 5 : 6); return <button key={i} type="button" aria-label={`${label(i)}, ${owner === null ? "empty" : `drawn by ${names[owner]}`}`} disabled={!canPlay || owner !== null || !onMove} onClick={() => onMove?.(i)} className="absolute rounded-full bg-transparent hover:bg-accent/30 focus-visible:bg-accent/30 disabled:cursor-default" style={h ? { left: `calc(${c * 20}% + 12px)`, top: `calc(${r * 20}% - 12px)`, width: "calc(20% - 24px)", height: 24 } : { left: `calc(${c * 20}% - 12px)`, top: `calc(${r * 20}% + 12px)`, width: 24, height: "calc(20% - 24px)" }} />; })}
      </div>
    </div>
    <p className="min-h-6 text-center text-small font-semibold text-ink-2" aria-live="polite">{view.last?.captured.length ? `${view.last.seat === seat ? "You" : names[view.last.seat]} claimed ${view.last.captured.length} ${view.last.captured.length === 1 ? "box" : "boxes"}${view.moves < 60 ? " · go again" : ""}` : view.moves === 60 ? "All boxes claimed" : canPlay ? "Choose a gap between dots" : `${names[view.turn]} is drawing a line`}</p>
    <p className="text-center text-small text-ink-3"><span className="text-you">{initials[left]} · {names[left]}</span>　 <span className="text-opp">{initials[right]} · {names[right]}</span> · {view.moves}/60 lines</p>
  </section>;
}
const LiveBoard: GameAdapter<DotsView, DotsMove>["Board"] = ({ view, seat, names, onMove, disabled, error }) => {
  const [sent, setSent] = useState<{ view: DotsView; error: unknown } | null>(null);
  return <DotsBoard view={view} seat={seat} names={names} disabled={disabled || (sent?.view === view && sent?.error === error)} onMove={(edge) => { setSent({ view, error }); onMove({ edge }); }} />;
};
function ReplayStep({ log, step, seed, names }: ReplayStepProps) {
  const result = useMemo(() => { try { return { view: replay(dotsAndBoxes, seed, log.slice(0, step)).state as DotsView, error: null }; } catch (e) { return { view: null, error: String(e) }; } }, [log, step, seed]);
  return <div data-testid="replay-step">{result.view && <DotsBoard view={result.view} seat="spectator" names={names} disabled />}{result.error && <p role="alert">{result.error}</p>}</div>;
}
export const dotsAdapter: GameAdapter<DotsView, DotsMove> = {
  id: "dots-and-boxes", icon: GAME_ICONS["dots-and-boxes"], Board: LiveBoard, ReplayStep,
  status: (v, seat, names) => v.moves === 60 ? "Match over" : v.last?.captured.length ? `${v.last.seat === seat ? "You claimed" : `${names[v.last.seat]} claimed`} ${v.last.captured.length} ${v.last.captured.length === 1 ? "box" : "boxes"} · go again` : v.turn === seat ? "Your turn · draw a line" : `${names[v.turn]} is drawing a line`,
  timer: (v) => ({ total: TURN_MS, owner: v.turn }),
  describeMove: (m) => `draws ${label(m.edge).toLowerCase()}`,
  rules: { title: "Dots and Boxes", art: GAME_ICONS["dots-and-boxes"], lines: rules }, hasHiddenInfo: false,
};
