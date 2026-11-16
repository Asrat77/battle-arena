"use client";

// Labelled form controls for the admin site: Field (input), TextArea and
// Select, each with a hint or an error line underneath tied by aria-describedby.

import { forwardRef, useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Icon } from "./icons";

export const controlClass =
  "w-full rounded-lg border border-line bg-sf-2 px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none transition-colors hover:border-ink-3/60 focus:border-accent focus-visible:outline-none aria-[invalid=true]:border-mismatch disabled:opacity-60";

type Wrap = { label: string; hint?: React.ReactNode; error?: string | null; hideLabel?: boolean; className?: string };

function Frame({ id, label, hint, error, hideLabel, children, className = "" }: Wrap & { id: string; children: React.ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-[13px] font-medium text-ink-2"}>
        {label}
      </label>
      {children}
      {(error || hint) && (
        <span id={`${id}-note`} className={error ? "text-[12.5px] font-medium text-mismatch" : "text-[12.5px] text-ink-3"} role={error ? "alert" : undefined}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
}

export const Field = forwardRef<HTMLInputElement, Wrap & { trailing?: React.ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "className">>(
  function Field({ label, hint, error, hideLabel, className, trailing, ...input }, ref) {
    const id = useId();
    return (
      <Frame id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
        <div className="relative">
          <input
            ref={ref}
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={error || hint ? `${id}-note` : undefined}
            className={`${controlClass} h-11 lg:h-10 ${trailing ? "pr-12" : ""}`}
            {...input}
          />
          {trailing && <div className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</div>}
        </div>
      </Frame>
    );
  },
);

export function TextArea({ label, hint, error, hideLabel, className, rows = 3, ...input }: Wrap & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">) {
  const id = useId();
  return (
    <Frame id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined}
        className={`${controlClass} resize-y py-2.5 leading-relaxed`}
        {...input}
      />
    </Frame>
  );
}

export function Select<T extends string>({
  label,
  hint,
  error,
  hideLabel,
  className,
  options,
  value,
  onChange,
  ...rest
}: Wrap & {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange(v: T): void;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "value" | "onChange">) {
  const id = useId();
  return (
    <Frame id={id} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          className={`${controlClass} h-11 appearance-none pr-9 lg:h-10`}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
      </div>
    </Frame>
  );
}
