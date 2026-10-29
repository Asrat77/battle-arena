"use client";

// A 3D animal on a tinted squircle, picked from the profile id so it is stable.
// Bots always get the robot. `seat` adds the you/opp ring.

import { AVATARS } from "@/engine/avatars";
import { BOT_PLAYER } from "@/lib/api";
import { usePickedAvatar } from "@/lib/avatars";
import { Icon3D, type Icon3DName } from "./Icon3D";

const ANIMALS: readonly Icon3DName[] = AVATARS;

const TINTS = [
  "rgb(243 181 66 / .16)",
  "rgb(120 198 154 / .16)",
  "rgb(212 145 122 / .18)",
  "rgb(143 184 255 / .14)",
  "rgb(190 160 255 / .16)",
  "rgb(230 172 98 / .16)",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  // final avalanche so short ids still spread across all animals
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** `picked` is the animal the player chose, if any; the tint always comes from the id. */
export function avatarFor(id: string, bot = false, picked?: Icon3DName | null): { animal: Icon3DName; tint: string } {
  if (bot || id === BOT_PLAYER) return { animal: "robot", tint: TINTS[3] };
  const h = hash(id);
  return { animal: picked ?? ANIMALS[h % ANIMALS.length], tint: TINTS[(h >>> 8) % TINTS.length] };
}

const SIZES = {
  sm: "h-[34px] w-[34px] rounded-[11px]",
  md: "h-11 w-11 rounded-[15px]",
  lg: "h-[84px] w-[84px] rounded-[28px]",
  xl: "h-[120px] w-[120px] rounded-[38px]",
} as const;

const PX = { sm: 34, md: 44, lg: 84, xl: 120 } as const;

export function Avatar3D({
  id,
  bot,
  size = "md",
  seat,
  className = "",
}: {
  id: string;
  bot?: boolean;
  size?: keyof typeof SIZES;
  seat?: "you" | "opp";
  className?: string;
}) {
  const picked = usePickedAvatar(id, bot);
  const { animal, tint } = avatarFor(id, bot, picked);
  const ring =
    seat === "you"
      ? "shadow-[0_0_0_2px_rgb(var(--bg)),0_0_0_4px_rgb(var(--you))]"
      : seat === "opp"
        ? "shadow-[0_0_0_2px_rgb(var(--bg)),0_0_0_4px_rgb(var(--opp))]"
        : "";
  return (
    <span
      className={`relative flex flex-none items-center justify-center ${SIZES[size]} ${ring} ${className}`}
      style={{ background: tint }}
    >
      {picked !== undefined && <Icon3D name={animal} size={Math.round(PX[size] * 0.82)} />}
    </span>
  );
}
