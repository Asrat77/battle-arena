"use client";

// BingoHeader: renders the B-I-N-G-O letters with a slash animation as each
// is earned. Letters turn golden with a strike-through when completed.

import { BINGO_LETTERS } from "@/engine/games/bingo";

interface BingoHeaderProps {
  lettersEarned: number;
  /** "you" | "opp" | "neutral" — controls the color accent. */
  tone?: "you" | "opp" | "neutral";
  size?: "md" | "sm";
  label?: string;
}

export function BingoHeader({
  lettersEarned,
  tone = "neutral",
  size = "md",
  label,
}: BingoHeaderProps) {
  const toneColor =
    tone === "you"
      ? "rgb(var(--you))"
      : tone === "opp"
        ? "rgb(var(--opp))"
        : "rgb(var(--acc))";

  const letterSize =
    size === "md"
      ? "text-[22px] w-9 h-9 sm:w-10 sm:h-10 text-[24px]"
      : "text-[14px] w-6 h-6 sm:w-7 sm:h-7 text-[15px]";

  return (
    <div role="status" aria-label={label ?? `${lettersEarned} of 5 BINGO letters earned`}>
      <div className="flex items-center justify-center gap-1">
        {BINGO_LETTERS.map((letter, i) => {
          const earned = i < lettersEarned;
          return (
            <div
              key={letter}
              className={[
                "relative flex items-center justify-center rounded-lg font-mono font-black tracking-tight select-none transition-all duration-300",
                letterSize,
                earned
                  ? "scale-105"
                  : "text-ink-3/40 opacity-50",
              ].join(" ")}
              style={earned ? { color: toneColor } : undefined}
            >
              <span>{letter}</span>

              {/* Slash line through earned letters */}
              {earned && (
                <svg
                  className="pointer-events-none absolute inset-0 w-full h-full p-0.5"
                  viewBox="0 0 32 32"
                  fill="none"
                  aria-hidden
                >
                  <line
                    x1="6"
                    y1="26"
                    x2="26"
                    y2="6"
                    stroke={toneColor}
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    className="animate-pop drop-shadow-[0_0_4px_rgba(243,181,66,0.6)]"
                  />
                </svg>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
