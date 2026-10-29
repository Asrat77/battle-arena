"use client";

import { useMemo, useState } from "react";
import type { GameAdapter, ReplayStepProps } from "@/components/match/adapter";
import { Segmented } from "@/components/ui/Segmented";
import { bingo, callerOf, rules, TURN_MS, type BingoMove, type BingoView } from "@/engine/games/bingo";
import { replay } from "@/engine/replay";
import type { Seat } from "@/engine/types";
import { GAME_ICONS } from "@/lib/gameCatalog";
import { BingoBoard } from "./BingoBoard";

const LiveBoard: GameAdapter<BingoView, BingoMove>["Board"] = ({ view, seat, names, players, onMove, disabled, error }) => {
  // A second click cannot submit a second move while the server acknowledges the first.
  const [sent, setSent] = useState<{ view: BingoView; error: unknown } | null>(null);
  const pending = sent?.view === view && sent?.error === error;
  return <BingoBoard view={view} seat={seat} names={names} players={players} disabled={disabled || pending} onMove={(number) => {
    setSent({ view, error });
    onMove({ number });
  }} />;
};

// Sheets are public once a match is over, so the replay can show either one.
function ReplayStep({ log, step, seed, names, players }: ReplayStepProps) {
  const [sheet, setSheet] = useState<Seat>(0);
  const result = useMemo(() => {
    try { return { state: replay(bingo, seed, log.slice(0, step)).state, error: null }; }
    catch (err) { return { state: null, error: (err as Error).message }; }
  }, [log, step, seed]);
  return <div data-testid="replay-step" className="flex flex-col gap-3">
    <Segmented label="Sheet" value={String(sheet)} onChange={(v) => setSheet(Number(v) as Seat)}
      options={names.map((name, s) => ({ value: String(s), label: `${name}’s sheet` }))} />
    {result.state && <BingoBoard view={bingo.view(result.state, sheet)} seat="spectator" sheet={sheet} names={names} players={players} disabled />}
    {result.error && <p role="alert" className="text-small text-mismatch">The log stops replaying here: {result.error}</p>}
  </div>;
}

export const bingoAdapter: GameAdapter<BingoView, BingoMove> = {
  id: "bingo", icon: GAME_ICONS.bingo, Board: LiveBoard, ReplayStep,
  status(view, seat, names) {
    if (view.lines.some((n) => n >= 5)) return "Match over";
    const last = view.called.length ? `${callerOf(view.called.length - 1) === seat ? "You" : names[callerOf(view.called.length - 1)]} called ${view.called[view.called.length - 1]} · ` : "";
    const next = view.turn === seat ? "your turn to call" : `${names[view.turn]} to call`;
    return last ? `${last}${next}` : next[0].toUpperCase() + next.slice(1);
  },
  seatState: (view, seat) => `${Math.min(view.lines[seat], 5)}/5 lines`,
  timer: (view) => ({ total: TURN_MS, owner: view.turn }),
  describeMove: (m) => `calls ${m.number}`,
  rules: { title: "BINGO", art: GAME_ICONS.bingo, lines: rules },
  hasHiddenInfo: true,
};
