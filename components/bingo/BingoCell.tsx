"use client";

// BingoCell: a single cell inside the 5×5 paper BINGO table.
// Styled like a number inscribed on a ruled game sheet, with an authentic pen "X"
// when crossed, a golden glow when part of a completed line, and interactive feedback
// when it can be called.

import { useEffect, useRef } from "react";

interface BingoCellProps {
  number: number;
  crossed: boolean;
  /** True if this cell is part of at least one completed line. */
  inLine: boolean;
  /** True if the player can click this cell to call the number. */
  clickable: boolean;
  onClick?: () => void;
  /** Highlight this cell as the most recently called number. */
  fresh?: boolean;
}

export function BingoCell({
  number,
  crossed,
  inLine,
  clickable,
  onClick,
  fresh,
}: BingoCellProps) {
  const ref = useRef<HTMLButtonElement>(null);

  // Animate the X pop in when newly crossed.
  const prevCrossed = useRef(crossed);
  useEffect(() => {
    if (crossed && !prevCrossed.current && ref.current) {
      ref.current.classList.remove("animate-pop");
      void ref.current.offsetWidth; // force reflow
      ref.current.classList.add("animate-pop");
    }
    prevCrossed.current = crossed;
  }, [crossed]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      aria-label={`Number ${number}${crossed ? ", crossed off" : ""}${inLine ? ", complete line" : ""}${clickable ? ", tap to call" : ""}`}
      className={[
        "relative w-full aspect-square flex items-center justify-center select-none transition-colors duration-150",
        // Table cell styling
        inLine
          ? "bg-accent/15 text-accent font-black"
          : crossed
            ? "bg-sf-2/50 text-ink-3"
            : clickable
              ? "bg-sf-2 text-ink hover:bg-accent/20 active:bg-accent/30 cursor-pointer"
              : "bg-sf-2 text-ink cursor-default",
        fresh && !crossed ? "ring-2 ring-accent ring-inset" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={[
          "font-mono tabular-nums font-bold text-[14px] sm:text-[16px] md:text-[17px] transition-opacity duration-150",
          crossed ? "opacity-30" : "opacity-100",
        ].join(" ")}
      >
        {number}
      </span>

      {/* Pen-stroke "X" crossed overlay */}
      {crossed && (
        <svg
          className="pointer-events-none absolute inset-0 w-full h-full p-[18%]"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <line
            x1="3"
            y1="3"
            x2="21"
            y2="21"
            stroke={inLine ? "rgb(var(--acc))" : "rgb(var(--you))"}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <line
            x1="21"
            y1="3"
            x2="3"
            y2="21"
            stroke={inLine ? "rgb(var(--acc))" : "rgb(var(--you))"}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      )}

      {/* Subtle indicator dot on callable cells during your turn */}
      {clickable && !crossed && (
        <span
          className="pointer-events-none absolute bottom-1 right-1 w-1 h-1 rounded-full bg-accent/60 opacity-60"
          aria-hidden
        />
      )}
    </button>
  );
}
