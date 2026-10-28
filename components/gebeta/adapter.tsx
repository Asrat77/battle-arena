// Gebeta in the match frame: the board takes taps on your own row and sends
// `{pit}` (0..5 along the mover's row). No hidden information, so no commit
// notice.

import type { GameAdapter } from "@/components/match/adapter";
import { rulesText, TURN_MS, type GebetaMove, type GebetaView } from "@/engine/games/gebeta";
import type { Seat } from "@/engine/types";
import { GebetaBoard } from "./GebetaBoard";
import { gebetaStatus, legalFor } from "./status";

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
  // Filled in by the replay task.
  ReplayStep: () => null,
  rules: {
    title: "Gebeta",
    art: "mancala",
    lines: rulesText.split(/(?<=\.) /),
  },
  hasHiddenInfo: false,
};
