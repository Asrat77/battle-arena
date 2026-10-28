// A player's store: a long bar at the end of the column on phones, a tall
// cup at the end of the row on wider screens. Ringed in the seat colour.

import type { CSSProperties } from "react";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Seeds } from "./Seeds";
import type { Orientation } from "./GebetaBoard";

const STORE_SEEDS_MAX = 22;
const HOLLOW = "radial-gradient(120% 140% at 50% 40%, #140B06, #24140B 80%)";

// Spelled out per orientation so Tailwind keeps every class.
const SHAPE: Record<Orientation, { box: string; pile: string; who: string; n: string }> = {
  auto: {
    box: "flex-row pl-2.5 pr-3.5 sm:flex-col sm:px-2 sm:py-3.5",
    pile: "h-[52px] sm:h-auto sm:w-full sm:flex-1 sm:justify-center",
    who: "w-[70px] sm:order-last sm:w-full sm:items-center sm:text-center",
    n: "text-right sm:text-center",
  },
  vertical: { box: "flex-row pl-2.5 pr-3.5", pile: "h-[52px]", who: "w-[70px]", n: "text-right" },
  horizontal: {
    box: "flex-col px-2 py-3.5",
    pile: "w-full flex-1 justify-center",
    who: "order-last w-full items-center text-center",
    n: "text-center",
  },
};

export function Store({
  n,
  label,
  seat,
  name,
  tag,
  player,
  orientation,
  sm = false,
  className = "",
  style,
}: {
  n: number;
  /** "Your store" or "Hana's store"; the count is appended. */
  label: string;
  seat: "you" | "opp";
  name: string;
  /** Small line under the name: "You", "Bot", a seat label. */
  tag?: string;
  player?: { id: string; bot?: boolean };
  orientation: Orientation;
  sm?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const shape = SHAPE[orientation];
  const ring =
    seat === "you"
      ? "shadow-[inset_0_4px_12px_rgb(0_0_0/.75),inset_0_0_0_1.5px_rgb(143_184_255/.55)]"
      : "shadow-[inset_0_4px_12px_rgb(0_0_0/.75),inset_0_0_0_1.5px_rgb(255_143_115/.5)]";
  return (
    <div
      role="group"
      aria-label={`${label}, ${n} ${n === 1 ? "seed" : "seeds"}`}
      className={`relative flex min-w-0 items-center gap-2.5 text-[#F6ECDF] ${sm ? "rounded-[18px]" : "rounded-[24px]"} ${shape.box} ${ring} ${className}`}
      style={{ background: HOLLOW, ...style }}
    >
      {player && <Avatar3D id={player.id} bot={player.bot} size="sm" />}
      <div className={`flex min-w-0 flex-col ${shape.who}`} aria-hidden>
        <b className="truncate text-[13px] font-semibold">{name}</b>
        {tag && (
          <span className={`text-[11px] font-semibold ${seat === "you" ? "text-[#8FB8FF]" : "text-[#FF8F73]"}`}>{tag}</span>
        )}
      </div>
      <div className={`flex min-w-0 flex-1 flex-wrap content-center overflow-hidden ${shape.pile}`} aria-hidden>
        <Seeds n={n} max={STORE_SEEDS_MAX} size={sm ? 16 : 22} salt={seat === "you" ? 1 : 3} />
      </div>
      <span
        className={`mono min-w-[44px] font-bold ${shape.n} leading-none tracking-[-.04em] ${sm ? "text-[22px]" : "text-[30px]"}`}
        aria-hidden
      >
        {n}
      </span>
    </div>
  );
}
