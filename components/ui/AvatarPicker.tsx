"use client";

// A grid of the animals a player can pick as their profile picture.

import { AVATARS, type AvatarName } from "@/engine/avatars";
import { Icon3D } from "./Icon3D";

export function AvatarPicker({
  value,
  onChange,
  disabled,
}: {
  /** The current pick; null when nothing is chosen yet. */
  value: AvatarName | null;
  onChange: (avatar: AvatarName) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Profile picture" className="grid grid-cols-6 gap-2">
      {AVATARS.map((a) => {
        const on = a === value;
        return (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={a}
            disabled={disabled}
            onClick={() => onChange(a)}
            className={`flex aspect-square items-center justify-center rounded-[14px] bg-sf-2 transition-transform active:scale-95 ${
              on ? "shadow-[0_0_0_2px_rgb(var(--bg)),0_0_0_4px_rgb(var(--act))]" : "opacity-80 hover:opacity-100"
            }`}
          >
            <Icon3D name={a} size={40} />
          </button>
        );
      })}
    </div>
  );
}
