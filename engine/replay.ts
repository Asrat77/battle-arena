import { rngForEntry } from "./rng";
import type { AnyGame, GameDef, LogEntry, Outcome, Seat } from "./types";

export interface MatchState<S> {
  state: S;
  outcome: Outcome | null;
}

export class ReplayError extends Error {
  constructor(
    readonly index: number,
    reason: string,
  ) {
    super(`log entry ${index}: ${reason}`);
    this.name = "ReplayError";
  }
}

export function initial<S>(game: GameDef<S, unknown, unknown>, seed: string): MatchState<S> {
  const state = game.setup({ seed });
  return { state, outcome: game.outcome(state) };
}

/** Why `entry` cannot be applied now, or null if it can. Covers system entries too. */
export function checkEntry<S>(
  game: GameDef<S, unknown, unknown>,
  cur: MatchState<S>,
  entry: LogEntry,
): string | null {
  if (cur.outcome) return "match is over";
  if (entry.seat === "system") {
    const move = entry.move;
    if (move.type === "timeout") return null;
    if (move.type === "forfeit") return move.seat === 0 || move.seat === 1 ? null : "bad forfeit seat";
    return "unknown system move";
  }
  if (entry.seat !== 0 && entry.seat !== 1) return "bad seat";
  if (!game.activeSeats(cur.state).includes(entry.seat)) return "not your turn";
  return game.validate(cur.state, entry.seat, entry.move);
}

/**
 * Apply one log entry. The server and replay both go through here, so a
 * live match and its replay cannot diverge. Throws ReplayError if illegal.
 */
export function step<S>(
  game: GameDef<S, unknown, unknown>,
  seed: string,
  cur: MatchState<S>,
  entry: LogEntry,
  index: number,
): MatchState<S> {
  const reason = checkEntry(game, cur, entry);
  if (reason) throw new ReplayError(index, reason);

  if (entry.seat === "system") {
    const move = entry.move;
    if (move.type === "forfeit") {
      const winner: Seat = move.seat === 0 ? 1 : 0;
      return { state: cur.state, outcome: { winner, draw: false, reason: "forfeit" } };
    }
    const state = game.onTimeout(cur.state, rngForEntry(seed, index));
    return { state, outcome: game.outcome(state) };
  }

  const state = game.apply(cur.state, entry.seat, entry.move);
  return { state, outcome: game.outcome(state) };
}

export function replay<S>(
  game: GameDef<S, unknown, unknown> | AnyGame,
  seed: string,
  log: readonly LogEntry[],
): MatchState<S> {
  let cur = initial(game as GameDef<S, unknown, unknown>, seed);
  log.forEach((entry, i) => {
    cur = step(game as GameDef<S, unknown, unknown>, seed, cur, entry, i);
  });
  return cur;
}
