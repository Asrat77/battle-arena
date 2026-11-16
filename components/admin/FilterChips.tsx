"use client";

// Filters as a row of chips (status, type). Single choice by default, or
// `multiple` for a set; each chip can carry a count. Scrolls sideways on phones.

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number | null;
}

type Single<T extends string> = { multiple?: false; value: T; onChange(v: T): void };
type Multi<T extends string> = { multiple: true; value: readonly T[]; onChange(v: T[]): void };

export function FilterChips<T extends string>({
  options,
  label,
  className = "",
  ...sel
}: { options: readonly ChipOption<T>[]; label: string; className?: string } & (Single<T> | Multi<T>)) {
  const isOn = (v: T) => (sel.multiple ? sel.value.includes(v) : sel.value === v);
  const toggle = (v: T) => {
    if (sel.multiple) sel.onChange(sel.value.includes(v) ? sel.value.filter((x) => x !== v) : [...sel.value, v]);
    else sel.onChange(v);
  };
  return (
    <div role="group" aria-label={label} className={`-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0 ${className}`}>
      {options.map((o) => {
        const on = isOn(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(o.value)}
            className={`inline-flex h-9 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium transition-colors lg:h-8 ${
              on ? "border-accent/60 bg-accent/10 text-accent" : "border-line bg-sf text-ink-2 hover:bg-sf-2 hover:text-ink"
            }`}
          >
            {o.label}
            {o.count != null && <span className={`num text-[11.5px] ${on ? "text-accent" : "text-ink-3"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
