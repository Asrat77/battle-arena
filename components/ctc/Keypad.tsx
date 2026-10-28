"use client";

// Full-width 3×4 keypad for entering a code: digits 1–9, Clear, ⌫ and the
// saffron submit key. Digits already in the code are disabled, since codes
// are 4 distinct digits. While focus is inside, the physical keyboard works
// too: 1–9, Backspace, Escape (clear) and Enter (submit).

import { CODE_LENGTH, isCode } from "@/engine/games/crackTheCode";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

const KEY =
  "flex items-center justify-center rounded-key bg-sf text-ink shadow-[inset_0_-2px_0_rgb(0_0_0/.25),inset_0_0_0_1px_var(--edge)] transition-transform ease-out active:scale-95 disabled:opacity-25 disabled:active:scale-100";

export function Keypad({
  value,
  onChange,
  onSubmit,
  submitLabel = "Lock in",
  disabled = false,
  size = "md",
}: {
  value: string;
  onChange(value: string): void;
  onSubmit(code: string): void;
  submitLabel?: string;
  disabled?: boolean;
  size?: "md" | "sm";
}) {
  const full = value.length >= CODE_LENGTH;
  const ready = isCode(value);

  const press = (d: string) => {
    if (disabled || full || value.includes(d)) return;
    onChange(value + d);
  };
  const back = () => !disabled && onChange(value.slice(0, -1));
  const clear = () => !disabled && onChange("");
  const submit = () => !disabled && ready && onSubmit(value);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") back();
    else if (e.key === "Escape") clear();
    else if (e.key === "Enter") submit();
    else return;
    e.preventDefault();
  };

  const h = size === "sm" ? "h-[52px]" : "h-[60px]";
  return (
    <div role="group" aria-label="Keypad" tabIndex={-1} onKeyDown={onKeyDown} className="grid w-full grid-cols-3 gap-2 outline-none">
      {DIGITS.map((d) => (
        <button
          key={d}
          type="button"
          className={`${KEY} ${h} mono text-[26px] font-medium`}
          disabled={disabled || full || value.includes(d)}
          onClick={() => press(d)}
        >
          {d}
        </button>
      ))}
      <button type="button" className={`${KEY} ${h} text-[14px] font-semibold text-ink-2`} disabled={disabled || !value} onClick={clear}>
        Clear
      </button>
      <button
        type="button"
        aria-label="Delete"
        className={`${KEY} ${h} text-[22px] font-semibold text-ink-2`}
        disabled={disabled || !value}
        onClick={back}
      >
        ⌫
      </button>
      <button
        type="button"
        className={`${KEY} ${h} !bg-accent text-[17px] font-semibold !text-accent-ink`}
        disabled={disabled || !ready}
        onClick={submit}
      >
        {submitLabel}
      </button>
    </div>
  );
}
