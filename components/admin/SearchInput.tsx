"use client";

// A search field that reports what was typed after a pause (debounced), with
// a clear button. The visible text updates at once; `onChange` waits `delay` ms.

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label = "Search",
  delay = 300,
  className = "",
  autoFocus,
}: {
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  label?: string;
  delay?: number;
  className?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value);
  const latest = useRef(onChange);
  latest.current = onChange;

  // Follow outside changes (e.g. a reset).
  useEffect(() => setText(value), [value]);

  useEffect(() => {
    if (text === value) return;
    const t = window.setTimeout(() => latest.current(text), delay);
    return () => window.clearTimeout(t);
  }, [text, value, delay]);

  return (
    <div className={`relative min-w-0 ${className}`}>
      <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
      <input
        type="search"
        aria-label={label}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") latest.current(text);
          if (e.key === "Escape" && text) {
            e.stopPropagation();
            setText("");
            latest.current("");
          }
        }}
        className="h-11 w-full rounded-lg border border-line bg-sf-2 pl-9 pr-9 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-accent focus-visible:outline-none lg:h-9 lg:text-[13px] [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setText("");
            latest.current("");
          }}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:text-ink"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
