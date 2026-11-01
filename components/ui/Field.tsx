// Labelled text input with a hint or an error line underneath.

import { useId, type InputHTMLAttributes } from "react";

export function Field({
  label,
  hint,
  error,
  hideLabel,
  trailing,
  liveHint,
  className = "",
  ...input
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  hideLabel?: boolean;
  /** Small control inside the right edge of the input, e.g. a show/hide button. */
  trailing?: React.ReactNode;
  /** Announce hint changes to screen readers (live status text such as "@abebe is free"). */
  liveHint?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const note = `${id}-note`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-small font-semibold"}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className={`input ${trailing ? "pr-16" : ""} ${className}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={note}
          {...input}
        />
        {trailing && <div className="absolute inset-y-0 right-2 flex items-center">{trailing}</div>}
      </div>
      <span id={note} className={error ? "text-small font-semibold text-mismatch" : "text-small text-ink-3"}>
        {error ?? hint}
      </span>
      {/* Always mounted so screen readers announce changes: errors always, hints only when `liveHint` is set
          (availability checks, rate limits), so a character counter doesn't chatter on every key. */}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {error ?? (liveHint ? hint : null)}
      </span>
    </div>
  );
}
