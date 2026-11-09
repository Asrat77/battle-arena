"use client";

import { useMemo, useState } from "react";
import type { GameAdapter, ReplayStepProps } from "@/components/match/adapter";
import { battleship, cellName, FLEET, PLACE_MS, rules, TURN_MS, type BattleshipMove, type BattleshipState, type BattleshipView } from "@/engine/games/battleship";
import { replay } from "@/engine/replay";
import { GAME_ICONS } from "@/lib/gameCatalog";
import { BattleshipBoard } from "./BattleshipBoard";
import { battleshipStatus } from "./status";

const LiveBoard: GameAdapter<BattleshipView, BattleshipMove>["Board"] = ({ view, seat, names, players, onMove, disabled, error, deadline }) => {
  // A second tap cannot send a second shot while the server acknowledges the first.
  const [sent, setSent] = useState<{ view: BattleshipView; error: unknown } | null>(null);
  const pending = sent?.view === view && sent?.error === error;
  return <BattleshipBoard view={view} seat={seat} names={names} players={players} disabled={disabled || pending}
    deadline={view.phase === "placing" ? deadline : null}
    onMove={(m) => { setSent({ view, error }); onMove(m); }} />;
};

// Fleets are public once a match is over, so the replay shows both from the start.
function ReplayStep({ log, step, seed, names, players }: ReplayStepProps) {
  const result = useMemo(() => {
    try {
      const full = replay(battleship, seed, log).state as BattleshipState;
      return { state: replay(battleship, seed, log.slice(0, step)).state as BattleshipState, fleets: full.fleets, error: null };
    } catch (err) { return { state: null, fleets: null, error: (err as Error).message }; }
  }, [log, step, seed]);
  return <div data-testid="replay-step" className="flex flex-col gap-3">
    {result.state && <BattleshipBoard view={battleship.view(result.state, "spectator")} seat="spectator" names={names} players={players} fleets={result.fleets ?? undefined} disabled />}
    {result.error && <p role="alert" className="text-small text-mismatch">The log stops replaying here: {result.error}</p>}
  </div>;
}

export const battleshipAdapter: GameAdapter<BattleshipView, BattleshipMove> = {
  id: "battleship", icon: GAME_ICONS.battleship, Board: LiveBoard, ReplayStep,
  status: battleshipStatus,
  seatState(view, seat) {
    if (view.phase === "placing") return view.placed[seat] ? "Fleet ready" : "Placing ships";
    const afloat = FLEET.length - view.sunk[seat].length;
    return `${afloat} ${afloat === 1 ? "ship" : "ships"} afloat`;
  },
  timer: (view) => (view.phase === "placing" ? { total: PLACE_MS, owner: "both" } : { total: TURN_MS, owner: view.turn }),
  describeMove: (m) => (m.type === "place" ? "places their fleet" : `fires at ${cellName(m.cell)}`),
  rules: { title: "Battleship", art: GAME_ICONS.battleship, lines: rules },
  hasHiddenInfo: true,
};
