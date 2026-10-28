"use client";

// The card that covers the board once a match is over: a big object for win,
// loss or draw, the reason in plain words, then the final score (Gebeta) or
// both secrets (Crack the Code), the ledger record and the way out. Points
// and badges the match earned pop up as reward toasts once they are applied;
// a match past the rematch limit says why it paid nothing.

import { useEffect, useState } from "react";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { ButtonLink } from "@/components/ui/Button";
import { RecordChip } from "@/components/ui/Chip";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { useToast } from "@/components/ui/Toast";
import type { Seat } from "@/engine/types";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { EndActions } from "./EndActions";
import type { ResultSummary } from "./result";

export interface ResultSeat {
  id: string;
  name: string;
  bot?: boolean;
  /** "You" for the viewer, else the name. */
  label: string;
}

export function ResultCard({
  matchId,
  result,
  left,
  right,
  seats,
  ledgerIndex,
  spectating = false,
}: {
  matchId: string;
  result: ResultSummary;
  /** The seat drawn on the left (blue): the viewer, or seat 1 when spectating. */
  left: Seat;
  right: Seat;
  seats: [ResultSeat, ResultSeat];
  /** Ledger block of the result once recorded; null while pending. */
  ledgerIndex: number | null;
  spectating?: boolean;
}) {
  const won = result.kind === "win";
  useRewardToasts(matchId);
  const capped = useCapped(matchId, !spectating && !seats[right].bot);
  return (
    <section aria-labelledby="result-title" className="relative mx-auto flex w-full max-w-[520px] flex-col gap-2.5 pb-2" data-testid="match-end">
      <div className="dither h-[300px]" aria-hidden />
      <header className="relative flex flex-col items-center gap-2 px-5 pb-2 pt-6 text-center">
        <Icon3D name={result.icon} size={120} className="animate-pop drop-shadow-[0_16px_24px_rgba(0,0,0,.45)]" />
        <span className={`eyebrow ${won ? "!text-accent" : ""}`}>{result.eyebrow}</span>
        <h2 id="result-title" className="text-[34px] font-semibold leading-[1.02] tracking-[-.045em] md:text-h1">
          {result.headline}
        </h2>
        <span className="text-ink-2">{result.detail}</span>
      </header>

      {result.score && (
        <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 rounded-card bg-sf px-3.5 py-3">
          <span className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <Avatar3D id={seats[left].id} bot={seats[left].bot} size="sm" seat="you" />
            <b className="max-w-full truncate font-semibold">{seats[left].label}</b>
          </span>
          <span className="mono text-[34px] font-semibold tracking-[-.04em]" aria-label={`${result.score[left]} to ${result.score[right]}`}>
            <span className="text-you">{result.score[left]}</span> <span className="text-ink-3">–</span>{" "}
            <span className="text-opp">{result.score[right]}</span>
          </span>
          <span className="flex min-w-0 flex-col-reverse items-end gap-1.5 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
            <b className="max-w-full truncate font-semibold">{seats[right].label}</b>
            <Avatar3D id={seats[right].id} bot={seats[right].bot} size="sm" seat="opp" />
          </span>
        </div>
      )}

      {result.secrets && (
        <div className="relative grid grid-cols-2 gap-2.5">
          {([left, right] as const).map((s, i) => (
            <div
              key={s}
              className={`card flex flex-col gap-1 p-3.5 ${i === 0 ? "shadow-[inset_0_0_0_1.5px_rgb(var(--you))]" : "shadow-[inset_0_0_0_1.5px_rgb(var(--opp))]"}`}
            >
              <span className="text-small text-ink-2">{seats[s].label === "You" ? "Your secret" : `${seats[s].name}’s`}</span>
              <span className={`mono text-[26px] font-semibold tracking-[.1em] ${i === 0 ? "text-you" : "text-opp"}`}>
                {result.secrets![s] ?? "None"}
              </span>
            </div>
          ))}
        </div>
      )}

      {capped && (
        <div className="relative flex items-center gap-3 rounded-card bg-pending-soft px-3.5 py-3" data-testid="rematch-limit">
          <Icon3D name="hourglass" size={36} />
          <span className="flex min-w-0 flex-col gap-px">
            <b className="text-small font-semibold text-pending">No points: rematch limit reached</b>
            <span className="text-small">You’ve played {seats[right].name} a lot today. The result is still recorded.</span>
          </span>
        </div>
      )}

      <div className="card relative flex items-center gap-3 px-3.5 py-3">
        <Icon3D name="blockchain" size={36} />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="text-small font-semibold">Ledger record</b>
          <span className="text-small text-ink-2">Gameplay never waits for this</span>
        </span>
        <span aria-live="polite" className="flex-none" data-testid="record-chip">
          <RecordChip state={ledgerIndex === null ? "pending" : "recorded"} block={ledgerIndex} long />
        </span>
      </div>

      <ButtonLink href={`/replay/${matchId}`} variant="act" icon="verified" block className="relative">
        Replay &amp; verify
      </ButtonLink>
      <EndActions matchId={matchId} opponent={spectating ? null : seats[right].name} />
    </section>
  );
}

const BADGE_ICONS: Record<string, Icon3DName> = {
  firstBlood: "boxing",
  codebreaker: "lockpick",
  seedMaster: "sprout",
  onARoll: "flame",
  explorer: "compass",
  champion: "trophy",
  watcher: "binoculars",
};

type RewardNotify =
  | { kind: "points"; matchId?: string; points: number; reasons?: string[] }
  | {
      kind: "badge";
      badge: { id: string; name: string; description?: string; source: string; ledgerIndex: number | null };
    };

/** Toasts for the `notify` points and badge events that belong to this match. */
function useRewardToasts(matchId: string) {
  const { socket } = useSession();
  const toast = useToast();

  useEffect(() => {
    if (!socket) return;
    const onNotify = (n: RewardNotify) => {
      if (n?.kind === "points" && n.matchId === matchId && n.points > 0)
        toast.show({
          icon: "token",
          tone: "reward",
          href: "/profile",
          body: (
            <>
              <b>+{n.points} {n.points === 1 ? "point" : "points"}</b>
              <div className="text-small text-ink-2">Minting on the ledger</div>
            </>
          ),
        });
      if (n?.kind === "badge" && n.badge?.source === matchId)
        toast.show({
          icon: BADGE_ICONS[n.badge.id] ?? "medalgold",
          tone: "reward",
          href: n.badge.ledgerIndex === null ? "/profile" : `/ledger#block-${n.badge.ledgerIndex}`,
          body: (
            <>
              <b>Badge: {n.badge.name}</b>
              <div className="text-small text-ink-2">
                {n.badge.ledgerIndex === null ? n.badge.description : `Recorded in block #${n.badge.ledgerIndex}`}
              </div>
            </>
          ),
        });
    };
    socket.on("notify", onNotify);
    return () => {
      socket.off("notify", onNotify);
    };
  }, [socket, matchId, toast]);
}

/**
 * True when the match was past the same-pair limit and earned no points. Read
 * from the live notify, or from the reward history after a refresh.
 */
function useCapped(matchId: string, enabled: boolean) {
  const { socket, profile } = useSession();
  const [capped, setCapped] = useState(false);

  useEffect(() => {
    if (!enabled || !profile) return;
    let live = true;
    api.rewards(profile.id).then(
      (r) => live && r.history?.some((h) => h.matchId === matchId && h.reasons.includes("farmed")) && setCapped(true),
      () => {},
    );
    const onNotify = (n: RewardNotify) =>
      n?.kind === "points" && n.matchId === matchId && n.reasons?.includes("farmed") && setCapped(true);
    socket?.on("notify", onNotify);
    return () => {
      live = false;
      socket?.off("notify", onNotify);
    };
  }, [socket, profile, matchId, enabled]);

  return capped;
}
