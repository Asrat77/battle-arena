// Gebeta in the match frame: the board takes taps on your own row and sends
// `{pit}` (0..5 along the mover's row). No hidden information, so no commit
// notice. The replay draws the same board, small, after each step.

import { useMemo } from "react";
import type { GameAdapter, ReplayStepProps } from "@/components/match/adapter";
import { rulesText, TURN_MS, type GebetaMove, type GebetaState, type GebetaView } from "@/engine/games/gebeta";
import { getGame } from "@/engine/registry";
import { initial, step } from "@/engine/replay";
import type { GameDef, Seat } from "@/engine/types";
import { GebetaBoard } from "./GebetaBoard";
import { gebetaStatus, legalFor } from "./status";

/** The board as it stood after `step` log entries, replayed with the game's own rules. */
function ReplayStep({ log, step: at, seed, names, players }: ReplayStepProps) {
  const cur = useMemo(() => {
    const game = getGame("gebeta") as GameDef<GebetaState, unknown, GebetaView>;
    let m = initial(game, seed);
    let error: string | null = null;
    try {
      for (let i = 0; i < at; i++) m = step(game, seed, m, log[i], i);
    } catch (err) {
      error = (err as Error).message;
    }
    return { view: game.view(m.state, "spectator"), error };
  }, [log, at, seed]);

  const { view } = cur;
  return (
    <div className="flex flex-col gap-2.5" data-testid="replay-step">
      <p className="eyebrow truncate text-center" aria-live="polite">
        {at === 0 ? "Match starts · 4 seeds in every pit" : moveLine(view, names)}
      </p>
      <GebetaBoard
        pits={view.pits}
        stores={view.stores}
        seat={0}
        players={players}
        spectating
        last={view.last}
        size="sm"
        className="w-full"
      />
      {cur.error && (
        <p className="text-small text-mismatch" role="alert">
          The log stops replaying here: {cur.error}
        </p>
      )}
    </div>
  );
}

function moveLine(view: GebetaView, names: [string, string]): string {
  const last = view.last;
  if (!last) return gebetaStatus(view, "spectator", names);
  const parts = [`${names[last.seat]} sows pit ${last.pit + 1}`];
  if (last.captured > 0) parts.push(`captures ${last.captured}`);
  if (view.over) parts.push(gebetaStatus(view, "spectator", names));
  else if (last.extraTurn) parts.push("goes again");
  return parts.join(" · ");
}

export const GebetaAdapter: GameAdapter<GebetaView, GebetaMove> = {
  id: "gebeta",
  icon: "mancala",
  Board({ view, seat, onMove, disabled, players }) {
    const spectating = seat === "spectator";
    const me: Seat = spectating ? 0 : seat;
    return (
      <GebetaBoard
        pits={view.pits}
        stores={view.stores}
        seat={me}
        legal={disabled ? [] : legalFor(view, me)}
        onPick={spectating || disabled ? undefined : (pit) => onMove({ pit })}
        players={players}
        spectating={spectating}
        last={view.last}
        className="w-full"
      />
    );
  },
  status: (view, seat, names) => gebetaStatus(view, seat, names),
  timer: (view) => ({ total: TURN_MS, owner: view.turn }),
  ReplayStep,
  describeMove: (m) => `sows pit ${m.pit + 1}`,
  rules: {
    title: "Gebeta",
    art: "mancala",
    lines: rulesText.split(/(?<=\.) /),
  },
  hasHiddenInfo: false,
};
