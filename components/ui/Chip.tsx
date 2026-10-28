// Status chips. RecordChip is the one place a match's ledger state is shown:
// Pending (spinner) → Recorded #n → Mismatch.

import Link from "next/link";
import { Icon3D, type Icon3DName } from "./Icon3D";

export type ChipTone = "neutral" | "pend" | "rec" | "bad" | "you" | "opp" | "act";

const TONES: Record<ChipTone, string> = {
  neutral: "",
  pend: "bg-pending-soft text-pending",
  rec: "bg-recorded-soft text-recorded",
  bad: "bg-mismatch-soft text-mismatch",
  you: "bg-you-soft text-you",
  opp: "bg-opp-soft text-opp",
  act: "bg-accent text-accent-ink",
};

export function Chip({
  tone = "neutral",
  icon,
  dot,
  spin,
  mono,
  className = "",
  children,
}: {
  tone?: ChipTone;
  icon?: Icon3DName;
  /** A small status dot in this colour (e.g. "rgb(var(--rec))"). */
  dot?: string;
  spin?: boolean;
  mono?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={`chip ${TONES[tone]} ${mono ? "font-mono" : ""} ${className}`}>
      {spin && <span className="spin" aria-hidden />}
      {icon && <Icon3D name={icon} size={18} />}
      {dot && <i className="block h-2 w-2 rounded-full" style={{ background: dot }} aria-hidden />}
      {children}
    </span>
  );
}

export function LiveChip({ count }: { count?: number }) {
  return (
    <Chip tone="bad" dot="rgb(var(--bad))">
      {count === undefined ? "Live" : `${count} live`}
    </Chip>
  );
}

export function PresenceChip({ status }: { status: "online" | "in-match" | "offline" }) {
  const look = {
    online: ["rgb(var(--rec))", "Online"],
    "in-match": ["rgb(var(--pend))", "In a match"],
    offline: ["rgb(var(--ink3))", "Offline"],
  }[status];
  return <Chip dot={look[0]}>{look[1]}</Chip>;
}

export function BotTag() {
  return (
    <span className="inline-flex h-[18px] flex-none items-center rounded-md bg-sf-3 px-1.5 font-mono text-[10px] uppercase tracking-[.06em] text-ink-2">
      Bot
    </span>
  );
}

export type RecordState = "pending" | "recorded" | "mismatch";

export function RecordChip({
  state,
  block,
  long,
}: {
  state: RecordState;
  /** Ledger block index of the result, once recorded. */
  block?: number | null;
  /** Full sentence ("Recorded in block #42") instead of the compact form. */
  long?: boolean;
}) {
  if (state === "pending")
    return (
      <Chip tone="pend" spin>
        {long ? "Recording on the ledger…" : "Pending"}
      </Chip>
    );
  if (state === "mismatch")
    return (
      <Chip tone="bad" icon="unverified">
        Mismatch
      </Chip>
    );
  const chip = (
    <Chip tone="rec" icon={long ? "verified" : "check"}>
      {long ? `Recorded in block #${block}` : `#${block}`}
    </Chip>
  );
  return block == null ? chip : <Link href={`/ledger#block-${block}`}>{chip}</Link>;
}
