// Segmented control (leaderboard Overall / Code / Gebeta, profile tabs).

import { Icon3D, type Icon3DName } from "./Icon3D";
import { useEffect, useRef } from "react";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; icon?: Icon3DName }[];
  value: T;
  onChange(v: T): void;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = container.current;
    const selected = el?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!el || !selected) return;
    const outer = el.getBoundingClientRect(), inner = selected.getBoundingClientRect();
    if (inner.left < outer.left) el.scrollLeft -= outer.left - inner.left;
    else if (inner.right > outer.right) el.scrollLeft += inner.right - outer.right;
  }, [value]);
  return (
    <div ref={container} role="radiogroup" aria-label={label} className="flex gap-1 overflow-x-auto rounded-2xl bg-sf-2 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex h-10 items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold sm:gap-1.5 sm:text-sm ${options.length > 4 ? "flex-none whitespace-nowrap" : "min-w-0 flex-1"} ${
              on ? "bg-sf-3 text-ink [.light_&]:bg-sf [.light_&]:shadow-[0_1px_3px_rgb(0_0_0/.08)]" : "text-ink-2"
            }`}
          >
            {o.icon && <Icon3D name={o.icon} size={20} className={options.length > 3 ? "hidden sm:block" : undefined} />}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
