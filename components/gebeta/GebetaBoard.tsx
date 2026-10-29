// The Gebeta board, drawn from the viewer's seat. Under 640 px it stands up:
// your pits run down the left column into your store at the bottom, theirs
// run up the right into their store at the top. Wider, it lies flat: your
// row runs left to right into your store on the right. Either way sowing goes
// counter-clockwise. One DOM serves both; CSS variables place each cell.

import type { CSSProperties } from "react";
import type { Seat } from "@/engine/types";
import { Pit } from "./Pit";
import { sameSpot, type Spot } from "./sowing";
import { Store } from "./Store";

export type Orientation = "auto" | "vertical" | "horizontal";

export interface BoardPlayer {
  id: string;
  name: string;
  bot?: boolean;
}

export interface GebetaBoardProps {
  /** pits[seat][i] = seeds in that seat's pit i, as in the engine view. */
  pits: [number[], number[]];
  stores: [number, number];
  /** Seat drawn as "you" (blue, near side). Spectators pass 0. */
  seat: Seat;
  /** Pits on the viewer's row that can be played now. */
  legal?: number[];
  /** Called with 0..5 along the viewer's row. Without it pits aren't buttons. */
  onPick?: (pit: number) => void;
  size?: "md" | "sm";
  /** "auto" switches at 640 px. */
  orientation?: Orientation;
  players?: [BoardPlayer, BoardPlayer];
  spectating?: boolean;
  /** Marks the pit the last move was sown from. */
  last?: { seat: Seat; pit: number } | null;
  /** Where the sowing animation just dropped a seed. */
  hit?: Spot | null;
  /** Pits emptied by a capture, flashed. */
  flash?: Spot[];
  /** Store ringed in saffron for a "go again" or a capture. */
  glow?: Seat | null;
  /** Pit on the viewer's row that plays itself at 0:00. */
  auto?: number | null;
  /** A short pill over the board, near a seat's store or in the middle. */
  callout?: { text: string; at: Seat | "center"; key: number } | null;
  /** While sowing: the whole board is one button that skips to the end. */
  onSkip?: () => void;
  className?: string;
}

// Where a callout sits: just off the store it's about, or the middle.
const CALLOUT: Record<Orientation, { you: string; opp: string }> = {
  auto: {
    you: "bottom-[92px] right-[18px] sm:bottom-6 sm:right-[136px]",
    opp: "left-[18px] top-[92px] sm:left-[136px] sm:top-6",
  },
  vertical: { you: "bottom-[92px] right-[18px]", opp: "left-[18px] top-[92px]" },
  horizontal: { you: "bottom-6 right-[136px]", opp: "left-[136px] top-6" },
};

// Spelled out so Tailwind keeps every class.
const CELL: Record<Orientation, string> = {
  auto: "[grid-column:var(--vc)] [grid-row:var(--vr)] sm:[grid-column:var(--hc)] sm:[grid-row:var(--hr)]",
  vertical: "[grid-column:var(--vc)] [grid-row:var(--vr)]",
  horizontal: "[grid-column:var(--hc)] [grid-row:var(--hr)]",
};

const V_GRID = "grid-cols-2";
const V_ROWS = { md: "grid-rows-[76px_repeat(6,minmax(52px,1fr))_76px]", sm: "grid-rows-[50px_repeat(6,40px)_50px]" };
const H_GRID = {
  md: "grid-cols-[118px_repeat(6,minmax(0,1fr))_118px] grid-rows-[repeat(2,minmax(112px,1fr))] lg:grid-rows-[repeat(2,150px)]",
  sm: "grid-cols-[84px_repeat(6,minmax(0,1fr))_84px] grid-rows-[repeat(2,64px)]",
};
const AUTO_H = {
  md: "sm:grid-cols-[118px_repeat(6,minmax(0,1fr))_118px] sm:grid-rows-[repeat(2,minmax(112px,1fr))] lg:grid-rows-[repeat(2,150px)]",
  sm: "sm:grid-cols-[84px_repeat(6,minmax(0,1fr))_84px] sm:grid-rows-[repeat(2,64px)]",
};

const WOOD: CSSProperties = {
  background:
    "repeating-linear-gradient(97deg, rgb(255 240 220 / .025) 0 2px, transparent 2px 7px, rgb(0 0 0 / .04) 7px 9px), linear-gradient(165deg, #5A3622 0%, #3B2316 45%, #2A180E 100%)",
  boxShadow: "inset 0 1px 0 rgb(255 255 255 / .1), inset 0 -3px 0 rgb(0 0 0 / .4), 0 24px 48px rgb(0 0 0 / .55)",
};

const at = (vc: string | number, vr: string | number, hc: string | number, hr: string | number) =>
  ({ "--vc": vc, "--vr": vr, "--hc": hc, "--hr": hr }) as CSSProperties;

const seeds = (n: number) => `${n} ${n === 1 ? "seed" : "seeds"}`;

export function GebetaBoard({
  pits,
  stores,
  seat,
  legal = [],
  onPick,
  size = "md",
  orientation = "auto",
  players,
  spectating = false,
  last,
  hit,
  flash = [],
  glow,
  auto,
  callout,
  onSkip,
  className = "",
}: GebetaBoardProps) {
  const sm = size === "sm";
  const opp: Seat = seat === 0 ? 1 : 0;
  const me = players?.[seat];
  const them = players?.[opp];
  const myName = spectating ? (me?.name ?? `Seat ${seat + 1}`) : "You";
  const theirName = them?.name ?? (spectating ? `Seat ${opp + 1}` : "Opponent");
  const playable = !!onPick && !spectating;
  const cell = CELL[orientation];
  const flashes = (s: Seat, pit: number) => flash.some((f) => sameSpot(f, { seat: s, pit }));

  const grid =
    orientation === "vertical"
      ? `${V_GRID} ${V_ROWS[size]}`
      : orientation === "horizontal"
        ? H_GRID[size]
        : `${V_GRID} ${V_ROWS[size]} ${AUTO_H[size]}`;
  const frame = sm
    ? "gap-1.5 rounded-[24px] p-2"
    : orientation === "vertical"
      ? "gap-2 rounded-board p-2.5"
      : orientation === "horizontal"
        ? "gap-3.5 rounded-[38px] p-4"
        : "gap-2 rounded-board p-2.5 sm:gap-3.5 sm:rounded-[38px] sm:p-4";

  return (
    <div className={`relative grid ${grid} ${frame} ${className}`} style={WOOD}>
      <Store
        n={stores[opp]}
        label={`${theirName}'s store`}
        seat="opp"
        name={theirName}
        tag={them?.bot ? "Bot" : undefined}
        player={them}
        orientation={orientation}
        sm={sm}
        land={sameSpot(hit, { seat: opp, store: true })}
        glow={glow === opp}
        className={cell}
        style={at("1 / 3", 1, 1, "1 / 3")}
      />

      {orientation !== "horizontal" && (
        <>
          <i
            aria-hidden
            className={`pointer-events-none relative [grid-column:1] [grid-row:2/8] ${orientation === "auto" ? "sm:hidden" : ""}`}
          >
            <span className="absolute -left-1.5 inset-y-0 w-[3px] rounded-sm bg-[#8FB8FF] opacity-60" />
          </i>
          <i
            aria-hidden
            className={`pointer-events-none relative [grid-column:2] [grid-row:2/8] ${orientation === "auto" ? "sm:hidden" : ""}`}
          >
            <span className="absolute -right-1.5 inset-y-0 w-[3px] rounded-sm bg-[#FF8F73] opacity-60" />
          </i>
        </>
      )}

      {/* Their row first in the DOM so Tab walks your pits 1 → 6 last. */}
      {pits[opp].map((n, j) => (
        <Pit
          key={`o${j}`}
          n={n}
          index={j + 7}
          label={`${theirName}'s pit ${j + 1}, ${seeds(n)}`}
          last={last?.seat === opp && last.pit === j}
          hit={sameSpot(hit, { seat: opp, pit: j })}
          flash={flashes(opp, j)}
          sm={sm}
          className={cell}
          style={at(2, 7 - j, 7 - j, 1)}
        />
      ))}
      {pits[seat].map((n, i) => (
        <Pit
          key={`m${i}`}
          n={n}
          index={i}
          mine={playable}
          legal={playable && legal.includes(i)}
          auto={playable && auto === i}
          onPick={() => onPick?.(i)}
          keyHint={String(i + 1)}
          label={`${spectating ? `${myName}'s` : "Your"} pit ${i + 1}, ${seeds(n)}`}
          last={last?.seat === seat && last.pit === i}
          hit={sameSpot(hit, { seat, pit: i })}
          flash={flashes(seat, i)}
          sm={sm}
          className={cell}
          style={at(1, i + 2, i + 2, 2)}
        />
      ))}

      <Store
        n={stores[seat]}
        label={spectating ? `${myName}'s store` : "Your store"}
        seat="you"
        name={spectating ? myName : (me?.name ?? "You")}
        tag={spectating ? (me?.bot ? "Bot" : undefined) : me ? "You" : undefined}
        player={me}
        orientation={orientation}
        sm={sm}
        land={sameSpot(hit, { seat, store: true })}
        glow={glow === seat}
        className={cell}
        style={at("1 / 3", 8, 8, "1 / 3")}
      />

      {onSkip && (
        <button
          type="button"
          aria-label="Skip the sowing animation"
          onClick={onSkip}
          className="absolute inset-0 z-[3] cursor-pointer rounded-[inherit] bg-transparent"
        />
      )}
      {callout && (
        <div
          aria-hidden
          className={`pointer-events-none absolute z-[4] ${
            callout.at === "center"
              ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              : CALLOUT[orientation][callout.at === seat ? "you" : "opp"]
          }`}
        >
          <span
            key={callout.key}
            className="block animate-callout whitespace-nowrap rounded-full bg-[#F3B542] px-4 py-2.5 text-[18px] font-bold tracking-[-.02em] text-[#16100A] shadow-[0_10px_24px_rgb(0_0_0/.4)]"
          >
            {callout.text}
          </span>
        </div>
      )}
    </div>
  );
}
