"use client";

// A grid of the animals a player can pick as their profile picture.

import { AVATARS, type AvatarName } from "@/engine/avatars";
import { Icon3D } from "./Icon3D";

export function AvatarPicker({
  value,
  onChange,
  disabled,
  labelledBy,
}: {
  /** The current pick; null when nothing is chosen yet. */
  value: AvatarName | null;
  onChange: (avatar: AvatarName) => void;
  disabled?: boolean;
  /** Id of a visible label; falls back to "Profile picture". */
  labelledBy?: string;
}) {
  // One tab stop; arrow keys move the choice, like native radios.
  const move = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const j = (i + step + AVATARS.length) % AVATARS.length;
    onChange(AVATARS[j]);
    (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
  };
  const stop = value ? AVATARS.indexOf(value) : 0;
  return (
    <div role="radiogroup" aria-label={labelledBy ? undefined : "Profile picture"} aria-labelledby={labelledBy} className="grid grid-cols-6 gap-2">
      {AVATARS.map((a, i) => {
        const on = a === value;
        return (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={a}
            tabIndex={i === stop ? 0 : -1}
            onKeyDown={(e) => move(e, i)}
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
