"use client";

import { useMemo, useState } from "react";
import type { GameAdapter, ReplayStepProps } from "@/components/match/adapter";
import { useTimeLeft } from "@/components/match/TurnTimer";
import { markFor, PAUSE_MS, rules, ticTacToe, TURN_MS, type TicTacToeMove, type TicTacToeView } from "@/engine/games/ticTacToe";
import { replay } from "@/engine/replay";
import { TicTacToeBoard } from "./TicTacToeBoard";

const LiveBoard: GameAdapter<TicTacToeView, TicTacToeMove>["Board"] = ({ view, seat, names, onMove, disabled, deadline, error }) => {
  // A second click cannot submit a second move while the server acknowledges the first.
  const [sent, setSent] = useState<{ view: TicTacToeView; error: unknown } | null>(null);
  const pending = sent?.view === view && sent?.error === error;
  const left = useTimeLeft(view.phase === "pause" ? deadline ?? null : null);
  return <TicTacToeBoard view={view} seat={seat} names={names} disabled={disabled || pending} countdown={left === null ? null : Math.ceil(left / 1000)} onMove={(cell) => {
    setSent({ view, error });
    onMove({ cell });
  }} />;
};

function ReplayStep({ log, step, seed, names }: ReplayStepProps) {
  const result = useMemo(() => {
    try { return { view: replay(ticTacToe, seed, log.slice(0, step)).state as TicTacToeView, error: null }; }
    catch (err) { return { view: null, error: (err as Error).message }; }
  }, [log, step, seed]);
  return <div data-testid="replay-step">{result.view && <TicTacToeBoard view={result.view} seat="spectator" names={names} disabled />}
    {result.error && <p role="alert" className="text-small text-mismatch">The log stops replaying here: {result.error}</p>}</div>;
}

export const ticTacToeAdapter: GameAdapter<TicTacToeView, TicTacToeMove> = {
  id: "tic-tac-toe", icon: "keypad", Board: LiveBoard, ReplayStep,
  status(view, seat, names) {
    if (view.phase === "finished") return "Match over";
    if (view.phase === "pause") {
      const last = view.history[view.history.length - 1];
      return `${last.winner === null ? "Board drawn" : `${names[last.winner]} wins the board`} · next board coming up`;
    }
    return view.turn === seat ? `Your turn · place ${markFor(view.round, view.turn)}` : `${names[view.turn]}’s turn · ${markFor(view.round, view.turn)}`;
  },
  seatState: (view, seat) => `${markFor(view.round, seat)} · ${view.phase === "pause" ? "Next board" : view.turn === seat ? "Thinking" : "Waiting"}`,
  timer: (view) => ({ total: view.phase === "pause" ? PAUSE_MS : TURN_MS, owner: view.phase === "pause" ? "both" : view.turn }),
  describeMove: (move) => `marks row ${Math.floor(move.cell / 3) + 1}, column ${move.cell % 3 + 1}`,
  rules: { title: "Tic-Tac-Toe", art: "keypad", lines: rules }, hasHiddenInfo: false,
};
