// One pit: a real button on the viewer's side, a plain cell on the other.
// The count is always printed; at most 14 seeds are drawn.

import type { CSSProperties } from "react";
import { Seeds } from "./Seeds";

export const PIT_SEEDS_MAX = 14;

// Pits and stores are carved into the walnut board, so they keep the same
// dark wood in both themes.
export const HOLLOW = "radial-gradient(110% 120% at 50% 38%, #120A05, #24140B 78%)";

export function Pit({
  n,
  label,
  index,
  legal = false,
  last = false,
  mine = false,
  sm = false,
  onPick,
  className = "",
  style,
}: {
  n: number;
  label: string;
  /** Pit index along its owner's row, for the seed rotations. */
  index: number;
  legal?: boolean;
  /** Pit the last move was sown from. */
  last?: boolean;
  /** On the viewer's side: render as a button. */
  mine?: boolean;
  sm?: boolean;
  onPick?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const body = (
    <>
      <span className="pointer-events-none flex max-h-full flex-wrap content-center justify-center overflow-hidden">
        <Seeds n={n} max={PIT_SEEDS_MAX} size={sm ? 18 : 24} salt={index} />
      </span>
      <span
        className={`mono absolute font-semibold ${sm ? "right-[7px] top-[3px] text-[10.5px]" : "right-[9px] top-[5px] text-[12px] sm:right-3 sm:top-2 sm:text-[14px]"} ${legal ? "text-[#F3B542]" : "text-[rgb(255_248_238/.7)]"}`}
      >
        {n}
      </span>
      {last && <span className="absolute left-2.5 top-[9px] h-[7px] w-[7px] rounded-full bg-[#F3B542]" />}
      {legal && <span className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-legal" />}
    </>
  );
  const cls = `relative flex min-h-0 min-w-0 items-center justify-center shadow-pit transition-transform duration-150 ${
    sm ? "rounded-[14px] px-2 py-[3px]" : "rounded-[22px] px-2.5 py-1.5 sm:rounded-[28px] sm:p-2.5"
  } ${n === 0 ? "opacity-75" : ""} ${className}`;
  const bg = { background: HOLLOW, ...style };

  if (!mine) {
    return (
      <span role="img" aria-label={label} className={cls} style={bg}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      disabled={!legal}
      onClick={legal ? onPick : undefined}
      className={`${cls} ${legal ? "cursor-pointer hover:-translate-y-0.5" : "cursor-default"}`}
      style={bg}
    >
      {body}
    </button>
  );
}
