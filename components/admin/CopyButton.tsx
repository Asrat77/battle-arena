"use client";

// Copy an id to the clipboard; the icon turns into a check for a moment.
// With `children`, shows the text (e.g. a short id) beside the icon.

import { useEffect, useState } from "react";
import { Icon } from "./icons";

export function CopyButton({ value, label = "Copy", children, className = "" }: { value: string; label?: string; children?: React.ReactNode; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1400);
    return () => window.clearTimeout(t);
  }, [done]);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
    } catch {
      // clipboard blocked (insecure origin): nothing to do
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={done ? "Copied" : `${label} ${value}`}
      title={value}
      className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-md px-1 font-mono text-[12.5px] text-ink-2 transition-colors hover:bg-sf-2 hover:text-ink ${className}`}
    >
      {children}
      <Icon name={done ? "check" : "copy"} size={14} className={done ? "text-recorded" : "text-ink-3"} />
      <span className="sr-only" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}
