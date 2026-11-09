"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AdapterPlayer } from "@/components/match/adapter";
import { cellName, CELLS, FLEET, other, SIZE, type BattleshipMove, type BattleshipView, type Fleet } from "@/engine/games/battleship";
import type { Seat, Viewer } from "@/engine/types";
import { KEY_HINT_CLASS, useHotkeys } from "@/lib/useHotkeys";
import { FleetPlanner } from "./FleetPlanner";
import { Sea } from "./Sea";
import { accuracy, lastShot, replyShot, type ShotWords } from "./status";
import { Reticle, ShipIcon } from "./sprites";

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -SIZE, ArrowDown: SIZE };
const TINT = { you: "rgb(var(--you))", opp: "rgb(var(--opp))" };

/** The callout for the newest shot, cleared once its animation has played. */
function useCallout(view: BattleshipView, seat: Viewer, names: [string, string]) {
  const total = view.shots[0].length + view.shots[1].length;
  const [shown, setShown] = useState<{ key: number; words: ShotWords } | null>(null);
  const first = useRef(true);
  useEffect(() => {
    // Not on first paint: a refresh mid-match should not replay an old shot.
    if (first.current) { first.current = false; return; }
    const words = lastShot(view, seat, names);
    if (!words) return;
    setShown({ key: total, words });
    const t = setTimeout(() => setShown(null), 1900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);
  return shown;
}

export function BattleshipBoard({ view, seat, names, disabled = false, onMove, deadline, fleets }: {
  view: BattleshipView;
  seat: Viewer;
  names: [string, string];
  /** Accepted for parity with other boards; the match frame already shows the players. */
  players?: [AdapterPlayer, AdapterPlayer];
  disabled?: boolean;
  onMove?(m: BattleshipMove): void;
  /** Placement deadline, so a layout on screen is sent before the server places a random one. */
  deadline?: number | null;
  /** Fleets to show whatever the view says (replays). */
  fleets?: [Fleet | null, Fleet | null];
}) {
  const left: Seat = seat === "spectator" ? 0 : seat;
  const right = other(left);
  const tint = (s: Seat) => (s === left ? TINT.you : TINT.opp);
  const fleetOf = (s: Seat) => fleets?.[s] ?? view.fleets?.[s] ?? (s === seat ? view.myFleet : null);
  const callout = useCallout(view, seat, names);
  const total = view.shots[0].length + view.shots[1].length;

  const firing = !disabled && view.phase === "battle" && seat !== "spectator" && view.turn === seat && Boolean(onMove);
  const fired = new Set(seat === "spectator" ? [] : view.shots[seat].map((s) => s.cell));

  // Desktop keyboard play: arrows move the aim over the enemy sea, Enter or Space fires.
  const [aim, setAim] = useState(27);
  const [keys, setKeys] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const target = firing ? (hover ?? (keys ? aim : null)) : null;

  useHotkeys((e) => {
    const step = STEP[e.key];
    if (step) {
      const col = aim % SIZE;
      const edge = (step === -1 && col === 0) || (step === 1 && col === SIZE - 1);
      const next = !keys || edge ? aim : Math.min(CELLS - 1, Math.max(0, aim + step));
      setAim(next); setKeys(true);
      if (document.activeElement && buttons.current.includes(document.activeElement as HTMLButtonElement)) buttons.current[next]?.focus();
      return true;
    }
    if ((e.key === "Enter" || e.key === " ") && keys && !fired.has(aim)) { onMove?.({ type: "fire", cell: aim }); setKeys(false); return true; }
    if (e.key === "Escape" && keys) { setKeys(false); return true; }
    return false;
  }, firing);

  if (view.phase === "placing" && seat !== "spectator" && !view.placed[seat] && !disabled && onMove) {
    return <FleetPlanner tint={TINT.you} deadline={deadline} onLock={(fleet) => onMove({ type: "place", fleet })} />;
  }

  /** The sea that belongs to seat `s`: its own ships, and the shots the other seat fired at it. */
  const seaOf = (s: Seat, opts: { compact?: boolean; aimable?: boolean }) => {
    const shooter = other(s);
    const fresh = view.last?.seat === shooter ? { cell: view.last.cell, key: total } : null;
    const lastHit = fresh && view.shots[shooter][view.shots[shooter].length - 1]?.hit;
    const afloat = FLEET.length - view.sunk[s].length;
    const words = callout && view.last?.seat === shooter ? callout : null;
    const desc = `${s === seat ? "Your" : `${names[s]}’s`} waters: ${afloat} of ${FLEET.length} ships afloat, ${view.shots[shooter].length} shots taken`;
    return (
      <Sea
        fleet={fleetOf(s)}
        wrecks={view.sunk[s]}
        shots={view.shots[shooter]}
        fresh={fresh}
        tint={tint(s)}
        compact={opts.compact}
        label={desc}
        shake={Boolean(lastHit && s === seat)}
        layers={opts.aimable && target !== null && !fired.has(target) ? <Reticle cell={target} /> : null}
        overlay={
          <>
            {opts.aimable && seat !== "spectator" && onMove && (
              <div className="absolute inset-0 grid grid-cols-8 grid-rows-8" role="group" aria-label={`${names[s]}’s waters: pick a square to fire at`}>
                {Array.from({ length: CELLS }, (_, cell) => {
                  const shot = view.shots[shooter].find((x) => x.cell === cell);
                  return (
                    <button
                      key={cell}
                      ref={(el) => { buttons.current[cell] = el; }}
                      type="button"
                      className={`outline-offset-[-3px] ${firing && !shot ? "cursor-crosshair" : "cursor-default"}`}
                      aria-label={`${cellName(cell)}, ${shot ? (shot.hit ? "hit" : "miss") : "open water"}`}
                      disabled={!firing || Boolean(shot)}
                      onClick={() => { setAim(cell); setKeys(false); onMove({ type: "fire", cell }); }}
                      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(cell)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setAim(cell)}
                    />
                  );
                })}
              </div>
            )}
            {view.phase === "placing" && !view.placed[s] && (
              <div className="absolute inset-0 grid place-items-center bg-black/10 text-center">
                <span className="chip !bg-black/45 !text-white backdrop-blur">{s === seat ? "Placing your fleet…" : `${names[s]} is placing ships…`}</span>
              </div>
            )}
            {words && <Callout words={words.words} cell={view.last!.cell} key={words.key} />}
          </>
        }
      />
    );
  };

  const spectating = seat === "spectator";
  const over = view.phase === "over";

  return (
    <section className="mx-auto flex w-full max-w-[460px] flex-col gap-3 lg:max-w-none" aria-label="Battleship board">
      {spectating ? (
        <div className="grid grid-cols-2 gap-2 lg:gap-4">
          {([left, right] as const).map((s) => (
            <SeaCard key={s} title={`${names[s]}’s waters`} sub={<Afloat view={view} s={s} tint={tint(s)} small />}>{seaOf(s, { compact: true })}</SeaCard>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-4">
          <SeaCard
            title={over ? `${names[right]}’s waters` : firing ? "Fire at their waters" : `${names[right]}’s waters`}
            sub={<Afloat view={view} s={right} tint={tint(right)} />}
            glow={firing}
          >
            {seaOf(right, { aimable: true })}
          </SeaCard>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3 lg:grid-cols-1">
            <SeaCard title="Your waters" sub={<Afloat view={view} s={left} tint={tint(left)} small />}>{seaOf(left, { compact: true })}</SeaCard>
            <Tally view={view} left={left} right={right} names={names} />
          </div>
        </div>
      )}

      {!spectating && firing && (
        <p className="text-center text-small text-ink-3">
          {replyShot(view) ? "Your fleet is gone · sink their last ship to draw" : "Tap a square to fire"}
          <span className={`${KEY_HINT_CLASS} ml-1`}>· arrows aim, Enter fires</span>
        </p>
      )}
    </section>
  );
}

function SeaCard({ title, sub, glow = false, children }: { title: string; sub: ReactNode; glow?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1">
        <h3 className={`truncate text-[13px] font-semibold sm:text-[14px] ${glow ? "text-accent" : "text-ink-2"}`}>{title}</h3>
        <span className="min-w-0 flex-none">{sub}</span>
      </div>
      <div className={`rounded-[24px] transition-shadow ${glow ? "shadow-[0_0_0_2px_rgb(var(--acc)),0_0_28px_rgb(var(--acc)/.25)]" : ""}`}>{children}</div>
    </div>
  );
}

/** The fleet of a sea as little ships, sunk ones struck out. */
function Afloat({ view, s, tint, small = false }: { view: BattleshipView; s: Seat; tint: string; small?: boolean }) {
  const sunk = new Set(view.sunk[s].map((x) => x.ship));
  return (
    <span className="flex items-center gap-1" role="img" aria-label={`${FLEET.length - sunk.size} of ${FLEET.length} ships afloat`}>
      {FLEET.map((f, k) => <ShipIcon key={f.id} ship={k} sunk={sunk.has(k)} tint={tint} className={small ? "h-[7px] sm:h-2 lg:h-2.5" : "h-2.5 sm:h-3"} />)}
    </span>
  );
}

function Callout({ words, cell }: { words: ShotWords; cell: number }) {
  // Centred across the sea so it never clips, at the height of the shot.
  const row = Math.floor(cell / SIZE);
  const top = row === 0 ? ((row + 1) / SIZE) * 100 + 2 : (row / SIZE) * 100 - 2;
  const tone = words.kind === "miss" ? "bg-white/90 text-[#0b3554]" : words.kind === "hit" ? "bg-[#ff6b2c] text-white" : "bg-[#c4222a] text-white";
  return (
    <span
      aria-hidden
      className={`sea-callout pointer-events-none absolute z-10 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-wide shadow-float sm:text-[13px] ${tone}`}
      style={{ left: "50%", top: `${top}%`, marginTop: row === 0 ? 0 : -30 }}
    >
      {words.short}
    </span>
  );
}

function Tally({ view, left, right, names }: { view: BattleshipView; left: Seat; right: Seat; names: [string, string] }) {
  const rows = [
    { name: "You", ...accuracy(view, left), tone: "text-you" },
    { name: names[right], ...accuracy(view, right), tone: "text-opp" },
  ];
  return (
    <div className="card flex flex-col gap-2 !p-3 text-small">
      <span className="eyebrow">Shots · hits</span>
      {rows.map((r) => (
        <div key={r.name} className="flex items-baseline justify-between gap-2">
          <b className={`truncate font-semibold ${r.tone}`}>{r.name}</b>
          <span className="mono flex-none text-ink-2">{r.shots} · {r.hits} <span className="text-ink-3">({r.pct}%)</span></span>
        </div>
      ))}
    </div>
  );
}
