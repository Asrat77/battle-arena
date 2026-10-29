"use client";

import { Fragment, useRef, useState } from "react";
import type { AdapterPlayer } from "@/components/match/adapter";
import { playerInitials } from "@/components/dots/initials";
import { Avatar3D } from "@/components/ui/Avatar3D";
import type { Seat, Viewer } from "@/engine/types";
import { callerOf, completedLines, LETTERS, LINES, type BingoView } from "@/engine/games/bingo";
import { KEY_HINT_CLASS, useHotkeys } from "@/lib/useHotkeys";

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 };
const CALL_ORDER = Array.from({ length: 25 }, (_, i) => i + 1);

/** Where a completed line is struck through, in the grid's 0–100 box. */
function strike(line: number) {
  const [a, b] = [LINES[line][0], LINES[line][4]];
  const at = (cell: number) => ({ x: (cell % 5) * 20 + 10, y: Math.floor(cell / 5) * 20 + 10 });
  const [p, q] = [at(a), at(b)];
  // Run a little past the end cells so the stroke reads as a line, not a link.
  const dx = Math.sign(q.x - p.x) * 7, dy = Math.sign(q.y - p.y) * 7;
  return { x1: p.x - dx, y1: p.y - dy, x2: q.x + dx, y2: q.y + dy };
}

/** `view.grid` belongs to `sheet` (the viewer by default); without a grid the board shows the shared calls 1–25. */
export function BingoBoard({ view, seat, names, players, sheet, disabled = false, onMove }: {
  view: BingoView;
  seat: Viewer;
  names: [string, string];
  players?: [AdapterPlayer, AdapterPlayer];
  sheet?: Seat;
  disabled?: boolean;
  onMove?(number: number): void;
}) {
  const left: Seat = seat === "spectator" ? 0 : seat;
  const right: Seat = left === 0 ? 1 : 0;
  const owner = sheet ?? left;
  const over = view.lines.some((n) => n >= 5);
  const interactive = !disabled && !over && seat !== "spectator" && seat === view.turn && Boolean(onMove) && view.grid !== null;
  const initials = playerInitials(names);
  const tone = (s: Seat) => (s === left ? "text-you" : "text-opp");
  const stroke = (s: Seat) => (s === left ? "rgb(var(--you))" : "rgb(var(--opp))");
  const label = (s: Seat) => (s === seat ? "You" : names[s]);

  const cells = view.grid ?? CALL_ORDER;
  const callIndex = new Map(view.called.map((n, i) => [n, i]));
  const latest = view.called[view.called.length - 1];
  const struck = view.grid ? completedLines(view.grid, view.called) : [];

  // Desktop keyboard play: arrows move an aim ring over the sheet, Enter or Space calls it.
  const [aim, setAim] = useState(12);
  const [keys, setKeys] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const preview = interactive ? (hover ?? (keys ? aim : null)) : null;

  useHotkeys((e) => {
    const step = STEP[e.key];
    if (step) {
      const col = aim % 5;
      const next = !keys ? aim : (step === -1 && col === 0) || (step === 1 && col === 4) ? aim : Math.min(24, Math.max(0, aim + step));
      setAim(next); setKeys(true);
      if (document.activeElement && buttons.current.includes(document.activeElement as HTMLButtonElement)) buttons.current[next]?.focus();
      return true;
    }
    if ((e.key === "Enter" || e.key === " ") && keys && !callIndex.has(cells[aim])) { onMove?.(cells[aim]); setKeys(false); return true; }
    if (e.key === "Escape" && keys) { setKeys(false); return true; }
    return false;
  }, interactive);

  const status = over
    ? view.lines[0] >= 5 && view.lines[1] >= 5 ? "BINGO for both on the same call" : `${label(view.lines[0] >= 5 ? 0 : 1)} called BINGO`
    : interactive ? "Pick an open number to call"
    : disabled ? "Sheet at this replay step"
    : latest !== undefined ? `${label(callerOf(view.called.length - 1))} called ${latest}`
    : `${names[view.turn]} calls first`;

  return (
    <section className="mx-auto flex w-full max-w-[460px] flex-col gap-3" aria-label="BINGO board">
      <div className="card flex items-center gap-2 !px-3.5 !py-3">
        {([left, right] as const).map((s, i) => (
          <Fragment key={s}>
            {i === 1 && <span aria-hidden className="mono text-ink-3">–</span>}
            <div className={`flex min-w-0 flex-1 items-center gap-2 ${i ? "flex-row-reverse text-right" : ""}`}>
              {players
                ? <Avatar3D id={players[s].id} bot={players[s].bot} size="sm" seat={s === left ? "you" : "opp"} className="!h-8 !w-8 !rounded-[10px]" />
                : <span className={`mono grid h-7 w-7 flex-none place-items-center rounded-full text-[11px] font-semibold ${s === left ? "bg-you-soft" : "bg-opp-soft"} ${tone(s)}`} aria-hidden>{initials[s]}</span>}
              <span className="min-w-0">
                <b className="block truncate text-small font-semibold">{label(s)}</b>
                <span className="eyebrow whitespace-nowrap">{!over && view.turn === s ? "To call" : "Lines"}</span>
              </span>
              <span className={`mono flex text-[15px] font-semibold sm:text-[20px] ${i ? "mr-auto" : "ml-auto"}`} aria-label={`${Math.min(view.lines[s], 5)} of 5 letters`}>
                {LETTERS.map((l, k) => <span key={l} className={k < view.lines[s] ? tone(s) : "text-ink-3/35"}>{l}</span>)}
              </span>
            </div>
          </Fragment>
        ))}
      </div>

      <div className="rounded-board bg-sf p-2.5 shadow-edge sm:p-3.5">
        {view.grid
          ? <div className="mb-1.5 grid grid-cols-5 gap-1.5 sm:gap-2" aria-hidden>
              {LETTERS.map((l, k) => (
                <span key={l} className={`relative grid h-8 place-items-center mono text-[18px] font-semibold ${k < view.lines[owner] ? tone(owner) : "text-ink-3"}`}>
                  {l}
                  {k < view.lines[owner] && <svg viewBox="0 0 20 20" className="absolute h-6 w-6 animate-pop"><path d="M4 16 16 4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>}
                </span>
              ))}
            </div>
          : <p className="eyebrow mb-2 text-center">Called so far · sheets stay private until the end</p>}
        <div className="relative grid grid-cols-5 gap-1.5 sm:gap-2" role="group" aria-label={view.grid ? `${seat === owner ? "Your" : `${names[owner]}’s`} sheet, read left to right` : "Numbers called"}>
          {cells.map((n, i) => {
            const at = callIndex.get(n);
            const called = at !== undefined;
            const by = called ? callerOf(at) : null;
            const last = n === latest;
            const aimed = preview === i && !called;
            const description = `${n}, ${called ? `called by ${names[by!]}` : "open"}${last ? ", latest call" : ""}`;
            const cellClass = `relative flex aspect-square items-center justify-center rounded-[14px] transition-colors ${
              called ? (by === left ? "bg-you-soft" : "bg-opp-soft") : "bg-sf-2"
            } ${last ? "ring-2 ring-accent" : aimed ? "ring-2 ring-ink-3/60" : ""} ${!called && interactive ? "hover:bg-sf-3 active:scale-[.97]" : ""}`;
            const content = (
              <>
                {called && (
                  <svg viewBox="0 0 24 24" aria-hidden className={`pointer-events-none absolute inset-0 m-auto h-[70%] w-[70%] ${last ? "animate-pop" : ""}`}>
                    <path d="M5 5 19 19M19 5 5 19" stroke={stroke(by!)} strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                <span className={`relative mono text-[17px] font-semibold sm:text-[19px] ${called ? "text-ink-2" : "text-ink"}`}>{n}</span>
              </>
            );
            return onMove && view.grid && seat !== "spectator" ? (
              <button
                key={n}
                ref={(el) => { buttons.current[i] = el; }}
                type="button"
                className={cellClass}
                aria-label={description}
                disabled={!interactive || called}
                onClick={() => { setAim(i); setKeys(false); onMove(n); }}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setAim(i)}
              >{content}</button>
            ) : <div key={n} className={cellClass} role="img" aria-label={description}>{content}</div>;
          })}
          {struck.length > 0 && (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              {struck.map((line) => <line key={line} {...strike(line)} stroke="rgb(var(--acc))" strokeWidth="4" strokeOpacity=".85" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
            </svg>
          )}
        </div>
      </div>

      <p className="min-h-6 text-center text-small font-semibold text-ink-2" aria-live="polite">{status}</p>
      <p className="text-center text-small text-ink-3">
        <span className="mono">{view.called.length}/25</span> called
        {interactive && <span className={`${KEY_HINT_CLASS} ml-2`}>· arrows aim, Enter calls</span>}
      </p>
    </section>
  );
}
