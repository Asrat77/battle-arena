"use client";

// /kit section for the match result card: win, loss vs bot, draw, forfeit and
// the spectator view, each from a sample outcome.

import { useState } from "react";
import { ResultCard, type ResultSeat } from "@/components/match/ResultCard";
import { resultSummary, type ResultInput } from "@/components/match/result";
import { Segmented } from "@/components/ui/Segmented";
import type { CtcView } from "@/engine/games/crackTheCode";
import type { GebetaView } from "@/engine/games/gebeta";
import type { Seat } from "@/engine/types";

const gebetaView: GebetaView = {
  pits: [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  stores: [29, 19],
  turn: 0,
  moves: 31,
  last: null,
  over: true,
  you: 0,
};

const ctcView = (round: number, exact: number): CtcView => ({
  phase: "over",
  round,
  mySecret: "4719",
  submitted: [true, true],
  myPending: null,
  history: [{ round, guesses: [{ code: "3826", exact, present: 0 }, { code: "4719", exact: 4, present: 0 }] }],
  secrets: ["4719", "3825"],
});

const SAMPLES: Record<string, { input: ResultInput; ledger: number | null }> = {
  win: {
    input: {
      gameId: "gebeta",
      gameName: "Gebeta",
      outcome: { winner: 0, draw: false, reason: "most seeds 29-19" },
      reveal: {},
      view: gebetaView,
      seat: 0,
      names: ["Abebe", "Hana"],
      bots: [false, false],
    },
    ledger: null,
  },
  loss: {
    input: {
      gameId: "crack-the-code",
      gameName: "Crack the Code",
      outcome: { winner: 1, draw: false, reason: "cracked the code" },
      reveal: { secrets: ["4719", "3825"] },
      view: ctcView(9, 3),
      seat: 0,
      names: ["Abebe", "ArenaBot"],
      bots: [false, true],
    },
    ledger: 61,
  },
  draw: {
    input: {
      gameId: "crack-the-code",
      gameName: "Crack the Code",
      outcome: { winner: null, draw: true, reason: "both cracked the code" },
      reveal: { secrets: ["6142", "9357"] },
      view: ctcView(6, 4),
      seat: 0,
      names: ["Abebe", "Selam"],
      bots: [false, false],
    },
    ledger: 57,
  },
  forfeit: {
    input: {
      gameId: "gebeta",
      gameName: "Gebeta",
      outcome: { winner: 1, draw: false, reason: "forfeit" },
      reveal: {},
      view: { ...gebetaView, stores: [8, 12], moves: 9 },
      seat: 0,
      names: ["Abebe", "Hana"],
      bots: [false, false],
    },
    ledger: 80,
  },
  watch: {
    input: {
      gameId: "gebeta",
      gameName: "Gebeta",
      outcome: { winner: 1, draw: false, reason: "most seeds 27-21" },
      reveal: {},
      view: { ...gebetaView, stores: [21, 27], you: null },
      seat: "spectator",
      names: ["Hana", "Selam"],
      bots: [false, false],
    },
    ledger: 90,
  },
};

const IDS = ["abebe", "hana"] as const;

export function ResultStates() {
  const [pick, setPick] = useState("win");
  const { input, ledger } = SAMPLES[pick];
  const left: Seat = input.seat === "spectator" ? 0 : input.seat;
  const right: Seat = left === 0 ? 1 : 0;
  const seats = ([0, 1] as const).map((s) => ({
    id: input.bots[s] ? "bot" : `${IDS[s]}-${input.names[s]}`,
    name: input.names[s],
    bot: input.bots[s],
    label: s === input.seat ? "You" : input.names[s],
  })) as [ResultSeat, ResultSeat];

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label="Result"
        value={pick}
        onChange={setPick}
        options={[
          { value: "win", label: "Win" },
          { value: "loss", label: "Loss" },
          { value: "draw", label: "Draw" },
          { value: "forfeit", label: "Forfeit" },
          { value: "watch", label: "Watching" },
        ]}
      />
      <div className="relative mx-auto w-full max-w-[390px] overflow-hidden rounded-sheet bg-bg px-3.5">
        <ResultCard key={pick} matchId="m-kit" result={resultSummary(input)} left={left} right={right} seats={seats} ledgerIndex={ledger} />
      </div>
    </div>
  );
}
