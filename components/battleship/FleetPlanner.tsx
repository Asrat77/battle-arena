"use client";

// Placement phase: drag ships around the player's own sea, tap a ship twice to
// turn it, shuffle for a fresh layout, then lock the fleet in. If the clock is
// about to run out, the layout on screen is sent rather than a random one.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createRng } from "@/engine/rng";
import { cellName, CELLS, FLEET, randomFleet, shipCells, SIZE, type Fleet, type Placement } from "@/engine/games/battleship";
import { KEY_HINT_CLASS, useHotkeys } from "@/lib/useHotkeys";
import { Sea } from "./Sea";
import { ShipIcon, ShipSprite } from "./sprites";

const freshFleet = () => randomFleet(createRng(`${Date.now()}:${Math.random()}`));
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Whether `ship` can lie at `at` without leaving the sea or touching another ship. */
export function fits(fleet: Fleet, ship: number, at: Placement): boolean {
  const cells = shipCells(at, FLEET[ship].size);
  if (!cells) return false;
  const others = new Set(fleet.flatMap((p, i) => (i === ship ? [] : (shipCells(p, FLEET[i].size) ?? []))));
  return cells.every((c) => !others.has(c));
}

/** The bow square that keeps a ship of `size` on the sea, nearest to row/col. */
function bowAt(row: number, col: number, dir: Placement["dir"], size: number): Placement {
  const r = clamp(row, 0, dir === "v" ? SIZE - size : SIZE - 1);
  const c = clamp(col, 0, dir === "h" ? SIZE - size : SIZE - 1);
  return { cell: r * SIZE + c, dir };
}

/** Turn a ship about its bow, nudging it to the nearest free water if it has to. */
export function turned(fleet: Fleet, ship: number): Placement | null {
  const { cell, dir } = fleet[ship];
  const next = dir === "h" ? "v" : "h";
  const r0 = Math.floor(cell / SIZE), c0 = cell % SIZE;
  const options = Array.from({ length: CELLS }, (_, i) => ({ cell: i, dir: next }) as Placement)
    .filter((at) => fits(fleet, ship, at))
    .map((at) => ({ at, d: Math.abs(Math.floor(at.cell / SIZE) - r0) + Math.abs((at.cell % SIZE) - c0) }))
    .sort((a, b) => a.d - b.d);
  return options.length && options[0].d <= 3 ? options[0].at : null;
}

interface Drag {
  ship: number;
  grab: number;
  x: number;
  y: number;
  moved: boolean;
  at: Placement;
}

export function FleetPlanner({ tint, deadline, onLock }: { tint: string; deadline?: number | null; onLock(fleet: Fleet): void }) {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [bad, setBad] = useState<{ ship: number; n: number } | null>(null);
  const sea = useRef<HTMLDivElement>(null);
  const latest = useRef<Fleet | null>(null);
  latest.current = fleet;

  // Random on the client only, so server and client render agree.
  useEffect(() => setFleet(freshFleet()), []);

  // Send what is on screen just before the server would place a random fleet.
  useEffect(() => {
    if (!deadline) return;
    const t = setTimeout(() => latest.current && onLock(latest.current), Math.max(0, deadline - Date.now() - 1500));
    return () => clearTimeout(t);
  }, [deadline, onLock]);

  const refuse = (ship: number) => setBad((b) => ({ ship, n: (b?.n ?? 0) + 1 }));
  const put = (ship: number, at: Placement) => {
    if (!fleet) return;
    if (!fits(fleet, ship, at)) return refuse(ship);
    setFleet(fleet.map((p, i) => (i === ship ? at : p)));
    setBad(null);
  };
  const turn = (ship: number) => {
    if (!fleet) return;
    const at = turned(fleet, ship);
    if (at) put(ship, at);
    else refuse(ship);
  };

  const cellFrom = (e: { clientX: number; clientY: number }) => {
    const box = sea.current!.getBoundingClientRect();
    const col = clamp(Math.floor(((e.clientX - box.left) / box.width) * SIZE), 0, SIZE - 1);
    const row = clamp(Math.floor(((e.clientY - box.top) / box.height) * SIZE), 0, SIZE - 1);
    return { row, col, cell: row * SIZE + col };
  };

  const shipOn = (cell: number) => (fleet ?? []).findIndex((p, i) => shipCells(p, FLEET[i].size)?.includes(cell));

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!fleet || e.button > 0) return;
    const { cell } = cellFrom(e);
    const ship = shipOn(cell);
    if (ship < 0) {
      if (sel !== null) {
        const { row, col } = cellFrom(e);
        put(sel, bowAt(row, col, fleet[sel].dir, FLEET[sel].size));
      }
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const grab = shipCells(fleet[ship], FLEET[ship].size)!.indexOf(cell);
    setDrag({ ship, grab, x: e.clientX, y: e.clientY, moved: false, at: fleet[ship] });
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || !fleet) return;
    const moved = drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6;
    const { row, col } = cellFrom(e);
    const { dir } = fleet[drag.ship];
    const at = bowAt(dir === "v" ? row - drag.grab : row, dir === "h" ? col - drag.grab : col, dir, FLEET[drag.ship].size);
    if (moved !== drag.moved || at.cell !== drag.at.cell) setDrag({ ...drag, moved, at });
  };

  const onUp = () => {
    if (!drag) return;
    if (drag.moved) {
      put(drag.ship, drag.at);
      setSel(drag.ship);
    } else if (sel === drag.ship) turn(drag.ship);
    else setSel(drag.ship);
    setDrag(null);
  };

  useHotkeys((e) => {
    if (!fleet) return false;
    if (/^[1-4]$/.test(e.key)) { setSel(Number(e.key) - 1); return true; }
    if (e.key === "Escape" && sel !== null) { setSel(null); return true; }
    if (sel === null) return false;
    if (e.key === "r" || e.key === "R") { turn(sel); return true; }
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!step) return false;
    const { cell, dir } = fleet[sel];
    const r = Math.floor(cell / SIZE) + step[0], c = (cell % SIZE) + step[1];
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) refuse(sel);
    else put(sel, { cell: r * SIZE + c, dir });
    return true;
  }, Boolean(fleet));

  const dragging = drag?.moved ? drag : null;
  const ghostOk = dragging && fleet ? fits(fleet, dragging.ship, dragging.at) : true;
  const where = (i: number) => (fleet ? `${cellName(fleet[i].cell)}, ${fleet[i].dir === "h" ? "across" : "down"}` : "");

  return (
    <section className="mx-auto flex w-full max-w-[460px] flex-col gap-3 lg:max-w-[520px]" aria-label="Place your fleet">
      <p className="px-1 text-center text-small text-ink-3">Drag a ship to move it · tap it twice to turn it</p>
      <Sea
        key={bad ? `bad${bad.n}` : "sea"}
        seaRef={sea}
        fleet={fleet}
        wrecks={[]}
        shots={[]}
        tint={tint}
        label="Your sea while placing ships"
        shake={bad !== null}
        shipStyle={(i) => ({ hidden: dragging?.ship === i, selected: sel === i && !dragging })}
        layers={dragging && <ShipSprite ship={dragging.ship} at={dragging.at} look={ghostOk ? "ghost" : "bad"} tint={tint} selected />}
        overlay={
          <div
            className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
          />
        }
      />

      <div className="grid grid-cols-4 gap-1.5 sm:gap-2" role="group" aria-label="Ships">
        {FLEET.map((f, i) => (
          <button
            key={f.id}
            type="button"
            onClick={() => (sel === i ? turn(i) : setSel(i))}
            aria-pressed={sel === i}
            aria-label={`${f.name}, ${f.size} squares, at ${where(i)}. ${sel === i ? "Selected: press again to turn." : "Select to move."}`}
            className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1.5 py-2 text-center transition-colors ${sel === i ? "bg-accent/15 shadow-[inset_0_0_0_2px_rgb(var(--acc))]" : "bg-sf-2 hover:bg-sf-3"} ${bad?.ship === i ? "animate-shake" : ""}`}
          >
            <span className="flex h-4 w-full items-center justify-center"><ShipIcon ship={i} tint={tint} className="h-full max-w-full" /></span>
            <span className="w-full min-w-0">
              <b className="block truncate text-[12px] font-semibold leading-tight sm:text-[13px]">{f.name}</b>
              <span className="mono block text-[11px] text-ink-3">{fleet ? cellName(fleet[i].cell) : "–"} · {f.size}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button type="button" className="btn btn-sec flex-1 sm:flex-none" onClick={() => { setFleet(freshFleet()); setSel(null); }}>Shuffle</button>
        <button type="button" className="btn btn-sec flex-1 sm:flex-none" disabled={sel === null} onClick={() => sel !== null && turn(sel)}>
          Turn{sel !== null && <span className={`${KEY_HINT_CLASS} mono text-[11px] opacity-60`}>R</span>}
        </button>
        <button type="button" className="btn btn-act flex-[1.4] sm:flex-1" disabled={!fleet} onClick={() => fleet && onLock(fleet)}>Ready to battle</button>
      </div>
      <p className={`${KEY_HINT_CLASS} justify-center text-center text-small text-ink-3`}>1–4 picks a ship · arrows move it · R turns it</p>
    </section>
  );
}
