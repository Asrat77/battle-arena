"use client";

// Crack the Code's short moments: the commit notice when both secrets land on
// the ledger, and the shake plus reason for an illegal move.

import { useEffect, useRef, useState } from "react";
import type { MatchCommit, MoveError } from "@/components/match/adapter";
import { Chip } from "@/components/ui/Chip";
import { Icon3D } from "@/components/ui/Icon3D";

export const COMMIT_MS = 1600;
export const ILLEGAL_MS = 2500;

/** `value` for `ms` after it last changed, then null. */
export function useHeld<T>(value: T | null, ms: number): T | null {
  const [held, setHeld] = useState<T | null>(null);
  useEffect(() => {
    if (value === null) return;
    setHeld(value);
    const t = setTimeout(() => setHeld(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return held;
}

const short = (hash: string) => `${hash.slice(0, 4)}…${hash.slice(-4)}`;

/** Covers the board for COMMIT_MS when the commit block is sealed. */
export function CommitMoment({ commit }: { commit: MatchCommit }) {
  const hashes = Object.values(commit.commitments);
  return (
    <div
      role="status"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-[18px] overflow-hidden bg-bg p-3.5 text-center"
      data-testid="commit-moment"
    >
      <div className="dither top-5 h-[420px]" />
      <div className="plate relative flex h-[180px] w-[180px] animate-pop items-center justify-center rounded-full">
        <Icon3D name="padlock" size={120} />
        <Icon3D name="blockchain" size={64} className="absolute -right-1.5 -bottom-1" />
      </div>
      <h2 className="relative text-[30px] font-semibold leading-[1.1] tracking-[-.04em]">
        Secrets committed
        <br />
        to the ledger
      </h2>
      <Chip tone="rec" icon="verified" className="relative">
        Block #{commit.ledgerIndex}
      </Chip>
      <span className="relative max-w-[300px] text-ink-3">
        A fingerprint of both secrets is published before the first guess, so neither can change. At the end they’re revealed and
        checked against it.
      </span>
      {hashes.length > 0 && <span className="mono relative text-small text-ink-3">{hashes.map(short).join(" · ")}</span>}
    </div>
  );
}

export interface Illegal {
  reason: string;
  key: number;
}

/**
 * The illegal move to show right now: a refusal from the server or one the
 * entry reports itself, held for ILLEGAL_MS.
 */
export function useIllegal(serverError: MoveError | null | undefined) {
  const [bad, setBad] = useState<Illegal | null>(null);
  useEffect(() => {
    if (serverError) setBad({ reason: serverError.reason, key: Date.now() });
  }, [serverError]);
  const shown = useHeld(bad, ILLEGAL_MS);
  return [shown, (reason: string) => setBad({ reason, key: Date.now() })] as const;
}

/** Shakes its children (±6 px) each time `illegal` changes. */
export function Shake({ illegal, children }: { illegal: Illegal | null; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !illegal) return;
    // Restart the animation for a repeat without remounting the slots.
    el.classList.remove("animate-shake");
    void el.offsetWidth;
    el.classList.add("animate-shake");
  }, [illegal]);
  return <div ref={ref}>{children}</div>;
}

export function IllegalReason({ illegal }: { illegal: Illegal | null }) {
  return (
    <p role="alert" className="min-h-[18px] text-small font-semibold text-mismatch">
      {illegal?.reason}
    </p>
  );
}
