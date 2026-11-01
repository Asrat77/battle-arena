// Labelled text input with a hint or an error line underneath.

import { useId, type InputHTMLAttributes } from "react";

export function Field({
  label,
  hint,
  error,
  hideLabel,
  trailing,
  className = "",
  ...input
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  hideLabel?: boolean;
  /** Small control inside the right edge of the input, e.g. a show/hide button. */
  trailing?: React.ReactNode;
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
          aria-describedby={error || hint ? note : undefined}
          {...input}
        />
        {trailing && <div className="absolute inset-y-0 right-2 flex items-center">{trailing}</div>}
      </div>
      {error ? (
        <span id={note} className="text-small font-semibold text-mismatch">
          {error}
        </span>
      ) : hint ? (
        <span id={note} className="text-small text-ink-3">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
