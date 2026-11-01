// One side of the match header: avatar with the you/opp ring, name, bot tag
// and a plain-words state ("Thinking", "Guessed", "Offline").

import { PlayerLink } from "@/components/profile/PlayerSheet";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { BotTag } from "@/components/ui/Chip";

export function PlayerSeat({
  id,
  name,
  side,
  bot,
  state,
  offline,
  align = "left",
}: {
  id: string;
  name: string;
  /** "you" is always the viewer (or seat 1 when spectating). */
  side: "you" | "opp";
  bot?: boolean;
  state?: string;
  /** Dims the seat and shows "Offline" in place of the state. */
  offline?: boolean;
  align?: "left" | "right";
}) {
  const label = offline ? "Offline" : state;
  return (
    <div
      className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right lg:flex-row lg:text-left" : ""} ${offline ? "opacity-60" : ""}`}
    >
      <PlayerLink id={id} bot={bot} className="flex-none" label={`Open ${name}`}>
        <Avatar3D id={id} bot={bot} seat={side} />
      </PlayerLink>
      <div className="flex min-w-0 flex-col">
        <PlayerLink id={id} bot={bot} className="truncate">
          <b className="truncate text-[14px] font-semibold">{name}</b>
        </PlayerLink>
        {(bot || label) && (
          <span className={`flex min-w-0 items-center gap-1.5 ${align === "right" ? "flex-row-reverse lg:flex-row" : ""}`}>
            {/* Phones rely on the robot avatar; the tag would crowd out the state. */}
            {bot && (
              <span className="hidden sm:contents">
                <BotTag />
              </span>
            )}
            {bot && <span className="sr-only sm:hidden">Bot.</span>}
            {label && (
              <span
                className={`truncate text-[11.5px] font-semibold ${offline ? "text-ink-3" : side === "you" ? "text-you" : "text-opp"}`}
              >
                {label}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
