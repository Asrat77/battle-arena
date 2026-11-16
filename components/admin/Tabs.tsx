"use client";

// Tabs (an underline row) and Segmented (a pill switch, as the inspiration's
// Weekly / Monthly / Yearly). Both are keyboard friendly: arrows move, Home/End jump.

import { useRef } from "react";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number | null;
}

function arrowKeys<T extends string>(e: React.KeyboardEvent, items: readonly TabItem<T>[], value: T, onChange: (v: T) => void, root: HTMLElement | null) {
  const i = items.findIndex((t) => t.value === value);
  let next = -1;
  if (e.key === "ArrowRight") next = (i + 1) % items.length;
  else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = items.length - 1;
  if (next < 0) return;
  e.preventDefault();
  onChange(items[next].value);
  requestAnimationFrame(() => root?.querySelectorAll<HTMLElement>("[data-tab]")[next]?.focus());
}

/** Underlined tabs. Render the panel yourself below; give it id `${idBase}-panel` if you want aria-controls. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className = "",
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange(v: T): void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => arrowKeys(e, items, value, onChange, ref.current)}
      className={`-mx-4 flex gap-5 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0 ${className}`}
    >
      {items.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            data-tab
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={`relative -mb-px inline-flex h-11 flex-none items-center gap-2 whitespace-nowrap border-b-2 text-[13.5px] font-medium transition-colors ${
              on ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className={`num rounded-full px-1.5 text-[11px] leading-[18px] ${on ? "bg-accent/15 text-accent" : "bg-sf-2 text-ink-3"}`}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A compact pill switch for 2 to 4 short options. */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  className = "",
  size = "md",
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange(v: T): void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => arrowKeys(e, items, value, onChange, ref.current)}
      className={`inline-flex flex-none items-center gap-0.5 rounded-lg border border-line bg-sf p-0.5 ${className}`}
    >
      {items.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            data-tab
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={`inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors ${
              size === "sm" ? "h-8 px-2.5 text-[12.5px] lg:h-7" : "h-9 px-3 text-[13px] lg:h-8"
            } ${on ? "bg-sf-3 text-ink" : "text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
