// Shared contracts for every game. Pure TypeScript: runs in Node and the browser.

export type Seat = 0 | 1;
export type Viewer = Seat | "spectator";

export type SystemMove = { type: "timeout" } | { type: "forfeit"; seat: Seat };

export type LogEntry =
  | { t: number; seat: Seat; move: unknown }
  | { t: number; seat: "system"; move: SystemMove };

export interface Outcome {
  winner: Seat | null;
  draw: boolean;
  reason: string;
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
}

export interface GameDef<S, M, V> {
  id: string;
  name: string;
  setup(ctx: { seed: string }): S;
  /** null = legal, else a reason. */
  validate(s: S, seat: Seat, m: M): string | null;
  /** Pure: must not mutate s. */
  apply(s: S, seat: Seat, m: M): S;
  /** Deterministic given the rng. */
  onTimeout(s: S, rng: Rng): S;
  /** Current phase timer length, or null for no timer. */
  deadlineMs(s: S): number | null;
  activeSeats(s: S): Seat[];
  outcome(s: S): Outcome | null;
  view(s: S, viewer: Viewer): V;
  /** Published at match start. */
  commitments?(s: S): Record<string, string>;
  /** Published at match end. */
  reveal?(s: S): Record<string, unknown>;
  /** Bots only see their own view. */
  bot(view: V, seat: Seat, rng: Rng): M;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GameDef<any, any, any>;

export interface MatchRecord {
  matchId: string;
  gameId: string;
  players: [string, string];
  bot: boolean;
  seed: string;
  log: LogEntry[];
  outcome: Outcome;
  startedAt: number;
  endedAt: number;
}
