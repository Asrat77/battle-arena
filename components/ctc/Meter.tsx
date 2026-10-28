// Feedback for one guess: four cells, saffron first for digits in the right
// spot, then grey for digits elsewhere in the code. `present` counts exact
// digits too (engine semantics), so grey cells are present − exact.

import { CODE_LENGTH } from "@/engine/games/crackTheCode";

export function meterText(exact: number, present: number) {
  const more = present - exact;
  if (present === 0) return "No digits in the code";
  if (exact === CODE_LENGTH) return "All 4 in the right spot";
  const parts = [];
  if (exact) parts.push(`${exact} in the right spot`);
  if (more) parts.push(`${exact ? `${more} more` : more} in the code`);
  return parts.join(", ");
}

export function Meter({ exact, present, size = "md" }: { exact: number; present: number; size?: "md" | "sm" }) {
  const cell = size === "sm" ? "h-[11px] w-[11px]" : "h-3 w-3";
  return (
    <span className="inline-grid flex-none grid-cols-4 gap-[3px]">
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <i
          key={i}
          aria-hidden
          className={`${cell} rounded-[4px] ${
            i < exact ? "animate-pop bg-accent" : i < present ? "animate-pop bg-ink-2" : "bg-sf-3"
          }`}
        />
      ))}
      <span className="sr-only">{meterText(exact, present)}</span>
    </span>
  );
}
