"use client";

// A small dark tooltip on hover and keyboard focus, described to screen
// readers through aria-describedby. `InfoTip` is the (i) button cards use.

import { cloneElement, isValidElement, useId, useState, type ReactElement } from "react";
import { Icon } from "./icons";

export function Tooltip({
  content,
  children,
  side = "top",
  className = "",
}: {
  content: React.ReactNode;
  /** One focusable element (button, link). */
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const child = isValidElement(children) ? cloneElement(children, { "aria-describedby": id }) : children;
  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      {child}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-[240px] -translate-x-1/2 rounded-md border border-line bg-sf-2 px-2.5 py-1.5 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-ink shadow-[0_8px_24px_rgb(0_0_0/.4)] transition-opacity duration-100 ${
          side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
        } ${open ? "opacity-100" : "invisible opacity-0"}`}
      >
        {content}
      </span>
    </span>
  );
}

export function InfoTip({ children, label = "More info" }: { children: React.ReactNode; label?: string }) {
  return (
    <Tooltip content={children}>
      <button
        type="button"
        aria-label={label}
        className="-m-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:text-ink-2"
      >
        <Icon name="info" size={14} />
      </button>
    </Tooltip>
  );
}
