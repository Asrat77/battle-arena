// The four code slots above the keypad. Filled digits are the viewer's blue
// and pop in; the next empty slot gets the saffron caret ring. `masked` shows
// a locked secret as dots.

import { CODE_LENGTH } from "@/engine/games/crackTheCode";

export function CodeSlots({
  value,
  masked = false,
  invalid = false,
  size = "md",
  label = "Code",
}: {
  value: string;
  masked?: boolean;
  /** Rings the caret slot red, for an illegal move. */
  invalid?: boolean;
  size?: "md" | "sm";
  label?: string;
}) {
  const caret = masked ? -1 : value.length;
  const spoken = masked ? `${label}: hidden` : `${label}: ${value ? value.split("").join(" ") : "empty"}`;
  return (
    <div role="img" aria-label={spoken} className="grid grid-cols-4 gap-[10px]">
      {Array.from({ length: CODE_LENGTH }, (_, i) => {
        const digit = value[i];
        const ring = masked
          ? "text-ink-3"
          : digit
            ? "text-you shadow-[inset_0_0_0_2px_rgb(var(--you))] animate-pop"
            : i === caret
              ? invalid
                ? "shadow-[inset_0_0_0_2px_rgb(var(--bad))]"
                : "shadow-[inset_0_0_0_2px_rgb(var(--acc)),0_0_24px_rgb(243_181_66/.25)]"
              : "";
        return (
          <div
            key={masked ? `m${i}` : `${i}-${digit ?? ""}`}
            className={`mono flex items-center justify-center rounded-[20px] bg-sf-2 font-semibold ${
              size === "sm" ? "h-16 text-[32px]" : "h-[76px] text-[38px]"
            } ${ring}`}
          >
            {masked ? "•" : digit}
          </div>
        );
      })}
    </div>
  );
}
