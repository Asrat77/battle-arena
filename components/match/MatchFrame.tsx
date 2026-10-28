"use client";

// The screen around every live match: game title row, two seats with the turn
// timer and bar, an aria-live status line, the game slot that fills the rest,
// and a bottom bar with Forfeit (or a "Spectating" pill for watchers). Once
// the match is over, `result` covers the board until the viewer asks to see it.

import { useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { Dialog, Sheet } from "@/components/ui/Overlay";
import { PlayerSeat } from "./PlayerSeat";
import { TurnBar, TurnTimer } from "./TurnTimer";

export interface FrameSeat {
  id: string;
  name: string;
  bot?: boolean;
  state?: string;
  offline?: boolean;
}

/** `mine`: saffron, the viewer must act. `urgent`: coral. `wait`: quiet. */
export type StatusTone = "mine" | "wait" | "urgent";

const TONES: Record<StatusTone, string> = {
  mine: "bg-accent text-accent-ink",
  wait: "bg-sf text-ink-2",
  urgent: "bg-mismatch text-bg",
};

export function MatchFrame({
  game,
  icon,
  matchId,
  you,
  opp,
  deadline,
  total,
  status,
  tone = "wait",
  spectating,
  over,
  rules,
  result,
  onForfeit,
  children,
}: {
  game: string;
  icon: Icon3DName;
  matchId: string;
  /** Left seat: the viewer, or seat 1 when spectating. */
  you: FrameSeat;
  /** Right seat: the opponent, or seat 2 when spectating. */
  opp: FrameSeat;
  deadline: number | null;
  total: number;
  status: string;
  tone?: StatusTone;
  spectating: boolean;
  /** Hides Forfeit and stops the clock once the match has ended. */
  over: boolean;
  rules?: { title: string; lines: string[]; art: Icon3DName };
  /** The result card, shown over the board once the match has ended. */
  result?: React.ReactNode;
  onForfeit(): void;
  children: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const covered = Boolean(result) && !boardOpen;
  const clock = over ? null : deadline;

  return (
    // Phones: the app header is hidden here, so the frame takes the whole
    // viewport. Desktop: a centred column under the app bar.
    <div className="-mx-4 -mb-8 -mt-6 flex min-h-[100dvh] flex-col md:mx-auto md:mb-0 md:mt-0 md:min-h-[calc(100dvh-140px)] md:max-w-[760px]">
      <header className="flex flex-none flex-col gap-2.5 px-3.5 pb-2.5 pt-1.5 md:px-0">
        <div className="flex min-h-11 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
            <Icon3D name={icon} size={22} />
            <span className="truncate">{game}</span>
            <span className="font-mono text-[11px] font-normal text-ink-3">{shortId(matchId)}</span>
          </span>
          {rules && <IconButton icon="manual" label="Rules" onClick={() => setShowRules(true)} />}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <PlayerSeat {...you} side="you" />
          <TurnTimer deadline={clock} />
          <PlayerSeat {...opp} side="opp" align="right" />
        </div>
        <TurnBar deadline={clock} total={total} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 md:px-0">
        <p
          aria-live="polite"
          className={`flex min-h-[42px] flex-none items-center justify-center rounded-[14px] px-3 text-center text-[15px] font-semibold ${TONES[tone]}`}
        >
          {status}
        </p>
        {covered && <div className="flex min-h-0 flex-1 flex-col">{result}</div>}
        {/* Kept mounted under the card so the board keeps its end state. */}
        <div className={covered ? "hidden" : "flex min-h-0 flex-1 flex-col"}>{children}</div>
      </div>

      <footer className="sticky bottom-0 flex flex-none items-center gap-1.5 bg-bg px-3 pb-3 pt-2 md:px-0">
        {result && (
          <Button variant="ghost" size="sm" icon={covered ? icon : "trophy"} onClick={() => setBoardOpen(covered)}>
            {covered ? "See the board" : "Show result"}
          </Button>
        )}
        <div className="flex-1" />
        {spectating ? (
          <Chip tone="act" icon="binoculars">
            Spectating
          </Chip>
        ) : (
          !over && (
            <Button variant="ghost" size="sm" icon="whiteflag" className="!text-mismatch" onClick={() => setConfirming(true)}>
              Forfeit
            </Button>
          )
        )}
      </footer>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        icon="whiteflag"
        title={`Forfeit and give ${opp.name} the win?`}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>Keep playing</Button>
            <Button
              variant="bad"
              onClick={() => {
                setConfirming(false);
                onForfeit();
              }}
            >
              Forfeit
            </Button>
          </>
        }
      >
        The match ends now and is recorded as a forfeit.
      </Dialog>

      {rules && (
        <Sheet open={showRules} onClose={() => setShowRules(false)} title={rules.title}>
          <Icon3D name={rules.art} size={72} />
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-2">
            {rules.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
