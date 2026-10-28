// Plain words for the end of a match, read from the outcome, the reveal and
// the last view. Kept apart from ResultCard so it can be tested in Node.

import type { Icon3DName } from "@/components/ui/Icon3D";
import type { CtcView } from "@/engine/games/crackTheCode";
import type { GebetaView } from "@/engine/games/gebeta";
import type { Outcome, Seat, Viewer } from "@/engine/types";

export type ResultKind = "win" | "loss" | "draw" | "watched";

export interface ResultInput {
  gameId: string;
  gameName: string;
  outcome: Outcome;
  reveal: Record<string, unknown>;
  /** The last view the viewer saw; its shape depends on the game. */
  view: unknown;
  seat: Viewer;
  names: [string, string];
  bots: [boolean, boolean];
}

export interface ResultSummary {
  kind: ResultKind;
  icon: Icon3DName;
  /** "Win · Gebeta" */
  eyebrow: string;
  headline: string;
  /** Why it ended, in a few words. */
  detail: string;
  /** Final score by seat, for games that keep one. */
  score?: [number, number];
  /** Both secrets by seat, for games with hidden info. */
  secrets?: [string | null, string | null];
}

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

export function resultSummary(r: ResultInput): ResultSummary {
  const { outcome, seat, names, gameName } = r;
  const spectating = seat === "spectator";
  const kind: ResultKind = outcome.draw ? "draw" : spectating ? "watched" : outcome.winner === seat ? "win" : "loss";
  const winner = outcome.winner;
  const loser = winner === null ? null : other(winner);
  // "You" for the viewer's own seat, the name otherwise.
  const who = (s: Seat) => (s === seat ? "You" : names[s]);
  const whom = (s: Seat) => (s === seat ? "you" : names[s]);

  const eyebrow = `${{ win: "Win", loss: "Loss", draw: "Draw", watched: "Final" }[kind]} · ${gameName}`;
  const icon: Icon3DName =
    kind === "win"
      ? "popper"
      : kind === "draw"
        ? "handshake"
        : kind === "watched"
          ? "trophy"
          : outcome.reason === "forfeit"
            ? "whiteflag"
            : r.bots[winner!]
              ? "robot"
              : "brokenheart";

  const base = { kind, icon, eyebrow, ...gameFacts(r) };

  if (outcome.reason === "forfeit" && winner !== null)
    return {
      ...base,
      headline: loser === seat ? "You forfeited" : `${names[loser!]} forfeited`,
      detail: loser === seat ? "Leaving or dropping out counts as a loss" : `${who(winner)} ${winner === seat ? "win" : "wins"} by forfeit`,
    };

  if (r.gameId === "crack-the-code") return { ...base, ...ctcWords(r, who) };
  if (r.gameId === "gebeta") return { ...base, ...gebetaWords(r, who, whom) };

  if (outcome.draw) return { ...base, headline: "Dead even", detail: outcome.reason };
  return { ...base, headline: `${who(winner!)} ${winner === seat ? "win" : "wins"}`, detail: outcome.reason };
}

function gameFacts(r: ResultInput): Pick<ResultSummary, "score" | "secrets"> {
  if (r.gameId === "gebeta") {
    const v = r.view as GebetaView | null;
    return v?.stores ? { score: [v.stores[0], v.stores[1]] } : {};
  }
  const secrets = (r.reveal.secrets ?? (r.view as CtcView | null)?.secrets) as [string | null, string | null] | undefined;
  return secrets ? { secrets } : {};
}

type Words = Pick<ResultSummary, "headline" | "detail">;

function ctcWords({ outcome, view, seat, names }: ResultInput, who: (s: Seat) => string): Words {
  const history = (view as CtcView | null)?.history ?? [];
  const last = history[history.length - 1];
  const round = last ? `Round ${last.round}` : "Before the first guess";
  switch (outcome.reason) {
    case "cracked the code": {
      const w = outcome.winner!;
      if (w === seat || seat === "spectator") return { headline: `${who(w)} cracked it`, detail: round };
      // How close the viewer's own last guess got.
      const mine = last?.guesses[seat]?.exact;
      const away = mine === undefined ? null : 4 - mine;
      return {
        headline: `${names[w]} cracked it`,
        detail: away ? `${round} · you were ${away} digit${away === 1 ? "" : "s"} away` : round,
      };
    }
    case "both cracked the code":
      return { headline: "Dead even", detail: `Both cracked it in ${round.toLowerCase()}` };
    case "round limit":
      return { headline: "Nobody cracked it", detail: `The round limit ran out at ${round.toLowerCase()}` };
    case "no secret set": {
      const l = other(outcome.winner!);
      return { headline: `${who(outcome.winner!)} ${outcome.winner === seat ? "win" : "wins"}`, detail: `${who(l)} didn’t lock a secret in time` };
    }
    case "no secrets set":
      return { headline: "No contest", detail: "Neither secret was locked in time" };
    default:
      return outcome.draw
        ? { headline: "Dead even", detail: outcome.reason }
        : { headline: `${who(outcome.winner!)} ${outcome.winner === seat ? "win" : "wins"}`, detail: outcome.reason };
  }
}

function gebetaWords({ outcome, view }: ResultInput, who: (s: Seat) => string, whom: (s: Seat) => string): Words {
  const v = view as GebetaView | null;
  const moves = v?.moves ? `Board cleared after ${v.moves} moves` : "Board cleared";
  if (outcome.draw) return { headline: "Dead even", detail: v ? `${v.stores[0]} seeds each · ${moves.toLowerCase()}` : moves };
  const w = outcome.winner!;
  return { headline: `${who(w)} out-seeded ${whom(other(w))}`, detail: moves };
}
