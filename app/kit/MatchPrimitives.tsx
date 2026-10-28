"use client";

// /kit section for the match header pieces: seats, turn timer and bar.

import { useEffect, useState } from "react";
import { PlayerSeat } from "@/components/match/PlayerSeat";
import { TurnBar, TurnTimer } from "@/components/match/TurnTimer";

const TURN_MS = 30_000;

function Header({ deadline, you, opp }: { deadline: number | null; you: string; opp?: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-card bg-bg p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <PlayerSeat id="abebe" name="Abebe" side="you" state={you} />
        <TurnTimer deadline={deadline} />
        {opp === undefined ? (
          <PlayerSeat id="hana" name="Hana" side="opp" offline align="right" />
        ) : (
          <PlayerSeat id="bot" name="Bot Lalibela" side="opp" bot state={opp} align="right" />
        )}
      </div>
      <TurnBar deadline={deadline} total={TURN_MS} />
    </div>
  );
}

function useLoopingDeadline(ms: number): number | null {
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    const restart = () => setDeadline(Date.now() + ms);
    restart();
    const t = setInterval(restart, ms + 1_500);
    return () => clearInterval(t);
  }, [ms]);
  return deadline;
}

export function MatchPrimitives() {
  // A full 30 s turn, and a 12 s one that goes urgent almost at once.
  const full = useLoopingDeadline(TURN_MS);
  const short = useLoopingDeadline(12_000);
  return (
    <>
      <Header deadline={full} you="Thinking" opp="Guessed" />
      <Header deadline={short} you="Setting secret" />
      <Header deadline={null} you="Locked" opp="Locked" />
    </>
  );
}
