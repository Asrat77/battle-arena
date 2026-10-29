"use client";

import { useRef, useState } from "react";
import type { AdapterPlayer } from "@/components/match/adapter";
import { Avatar3D, avatarFor } from "@/components/ui/Avatar3D";
import { Icon3D } from "@/components/ui/Icon3D";
import { usePickedAvatar } from "@/lib/avatars";
import type { Seat, Viewer } from "@/engine/types";
import { available, type DotsView } from "@/engine/games/dotsAndBoxes";
import { KEY_HINT_CLASS, useHotkeys } from "@/lib/useHotkeys";
import { edgeCell, edgeLabel, edgeMid, isHorizontal, nextEdge, type Dir } from "./geometry";
import { playerInitials } from "./initials";

const ARROWS: Record<string, Dir> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

/** A claimed box shows the owner's picture (the robot for a bot), or initials without player ids. */
function BoxMark({ player, initials, index, tone }: { player?: AdapterPlayer; initials: string; index: number; tone: string }) {
  const picked = usePickedAvatar(player?.id ?? "", !player || Boolean(player.bot));
  const { animal } = avatarFor(player?.id ?? "", player?.bot, picked);
  const loading = player && !player.bot && picked === undefined;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute flex items-center justify-center animate-pop ${tone}`}
      style={{ left: `${(index % 5) * 20 + 2}%`, top: `${Math.floor(index / 5) * 20 + 2}%`, width: "16%", height: "16%" }}
    >
      {!player ? <b className="mono text-[clamp(10px,3.2vw,18px)]">{initials}</b> : !loading && <Icon3D name={animal} size={64} className="h-[84%] w-[84%]" />}
    </span>
  );
}

export function DotsBoard({ view, seat, names, players, disabled = false, onMove }: {
  view: DotsView;
  seat: Viewer;
  names: [string, string];
  players?: [AdapterPlayer, AdapterPlayer];
  disabled?: boolean;
  onMove?(edge: number): void;
}) {
  const left: Seat = seat === "spectator" ? 0 : seat;
  const right: Seat = left === 0 ? 1 : 0;
  const over = view.moves === 60;
  const interactive = !disabled && !over && seat !== "spectator" && seat === view.turn && Boolean(onMove);
  const initials = playerInitials(names);
  const tone = (s: Seat) => (s === left ? "text-you" : "text-opp");
  const stroke = (s: Seat) => (s === left ? "rgb(var(--you))" : "rgb(var(--opp))");
  const fill = (s: Seat) => (s === left ? "var(--you-s)" : "var(--opp-s)");
  const label = (s: Seat) => (s === seat ? "You" : names[s]);

  // Desktop keyboard play: arrows move an aiming line, Enter or Space draws it.
  // With a line focused, the arrows move the focus and the browser clicks on Enter.
  const free = available(view.edges);
  const [aim, setAim] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [keys, setKeys] = useState(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const aimed = aim !== null && view.edges[aim] === null ? aim : null;
  const stop = aimed ?? free[0] ?? null;
  const preview = interactive ? (focused ?? hover ?? (keys ? aimed : null)) : null;

  useHotkeys((e) => {
    const dir = ARROWS[e.key];
    if (dir) {
      const next = stop === null ? null : !keys && focused === null ? stop : nextEdge(view.edges, stop, dir);
      if (next === null) return true;
      setAim(next); setKeys(true);
      if (document.activeElement && buttons.current.includes(document.activeElement as HTMLButtonElement)) buttons.current[next]?.focus();
      return true;
    }
    if ((e.key === "Enter" || e.key === " ") && aimed !== null && keys) { onMove?.(aimed); setKeys(false); return true; }
    if (e.key === "Escape" && keys) { setKeys(false); return true; }
    return false;
  }, interactive);

  const status = view.last?.captured.length
    ? `${label(view.last.seat)} claimed ${view.last.captured.length} ${view.last.captured.length === 1 ? "box" : "boxes"}${over ? "" : " · go again"}`
    : over ? "All boxes claimed"
    : interactive ? "Choose a gap between dots"
    : disabled ? "Board at this replay step"
    : `${names[view.turn]} is drawing a line`;

  return (
    <section className="mx-auto flex w-full max-w-[460px] flex-col gap-3" aria-label="Dots and Boxes board">
      <div className="card flex items-center gap-2 !px-3.5 !py-3">
        {([left, right] as const).map((s, i) => (
          <div key={s} className={`flex min-w-0 flex-1 items-center gap-2 ${i ? "flex-row-reverse text-right" : ""}`}>
            {players
              ? <Avatar3D id={players[s].id} bot={players[s].bot} size="sm" seat={s === left ? "you" : "opp"} className="!h-8 !w-8 !rounded-[10px]" />
              : <span className={`mono grid h-7 w-7 flex-none place-items-center rounded-full text-[11px] font-semibold ${s === left ? "bg-you-soft" : "bg-opp-soft"} ${tone(s)}`} aria-hidden>{initials[s]}</span>}
            <span className="min-w-0">
              <b className="block truncate text-small font-semibold">{label(s)}</b>
              <span className="eyebrow">{!over && view.turn === s ? "To move" : "Boxes"}</span>
            </span>
            <span className={`mono text-[28px] font-semibold ${i ? "mr-auto" : "ml-auto"} ${tone(s)}`} aria-label={`${view.scores[s]} boxes`}>{view.scores[s]}</span>
          </div>
        ))}
      </div>
      <div className="relative aspect-square w-full rounded-board bg-sf p-5 shadow-edge sm:p-6">
        <div className="absolute inset-5 sm:inset-6">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {view.boxes.map((owner, i) => {
              if (owner === null) return null;
              const x = (i % 5) * 20, y = Math.floor(i / 5) * 20;
              const fresh = view.last?.captured.includes(i);
              return (
                <g key={i}>
                  <rect x={x + 2} y={y + 2} width="16" height="16" rx="3" fill={fill(owner)} stroke={fresh ? "rgb(var(--acc))" : stroke(owner)} strokeOpacity={fresh ? 1 : 0.35} strokeWidth=".8" />
                </g>
              );
            })}
            {view.edges.map((owner, i) => {
              const { r, c } = edgeCell(i), h = isHorizontal(i);
              const line = { x1: c * 20, y1: r * 20, x2: (c + (h ? 1 : 0)) * 20, y2: (r + (h ? 0 : 1)) * 20, strokeLinecap: "round" as const };
              if (owner === null) return i === preview ? <line key={i} {...line} stroke={stroke(left)} strokeOpacity=".5" strokeWidth="2.2" /> : <line key={i} {...line} stroke="rgb(var(--ink3) / .3)" strokeWidth="1" />;
              const last = view.last?.edge === i;
              return (
                <g key={i}>
                  {last && <line {...line} stroke="rgb(var(--acc) / .4)" strokeWidth="5" />}
                  <line {...line} stroke={stroke(owner)} strokeWidth={last ? 2.4 : 1.8} />
                </g>
              );
            })}
            {Array.from({ length: 36 }, (_, i) => <circle key={i} cx={(i % 6) * 20} cy={Math.floor(i / 6) * 20} r="2" fill="rgb(var(--ink2))" />)}
          </svg>
          {view.boxes.map((owner, i) => owner === null ? null : <BoxMark key={i} index={i} player={players?.[owner]} initials={initials[owner]} tone={tone(owner)} />)}
          {onMove && seat !== "spectator" && view.edges.map((owner, i) => {
            const mid = edgeMid(i), h = isHorizontal(i);
            return (
              <button
                key={i}
                ref={(el) => { buttons.current[i] = el; }}
                type="button"
                tabIndex={i === stop ? 0 : -1}
                aria-label={`${edgeLabel(i)}, ${owner === null ? "empty" : `drawn by ${names[owner]}`}`}
                disabled={!interactive || owner !== null}
                onClick={() => { setAim(i); setKeys(false); onMove(i); }}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={(e) => { setAim(i); setFocused(e.currentTarget.matches(":focus-visible") ? i : null); }}
                onBlur={() => setFocused(null)}
                className="absolute rounded-full bg-transparent outline-none disabled:cursor-default"
                style={{
                  left: `${mid.x}%`, top: `${mid.y}%`, transform: "translate(-50%, -50%)",
                  width: h ? "calc(20% - 22px)" : 28, height: h ? 28 : "calc(20% - 22px)",
                }}
              />
            );
          })}
        </div>
      </div>
      {disabled && <p className="min-h-6 text-center text-small font-semibold text-ink-2" aria-live="polite">{status}</p>}
      <p className="text-center text-small text-ink-3">
        <span className="mono">{view.moves}/60</span> lines · <span className="mono">{view.scores[0] + view.scores[1]}/25</span> boxes
        {interactive && <span className={`${KEY_HINT_CLASS} ml-2`}>· arrows aim, Enter draws</span>}
      </p>
    </section>
  );
}
