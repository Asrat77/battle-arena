// The game adapters MatchFrame knows about, keyed by game id. A game without
// an entry here falls back to the page's plain rendering.

import type { GameAdapter, GameId } from "./adapter";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const adapters: Partial<Record<GameId, GameAdapter<any, any>>> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adapterFor(gameId: string): GameAdapter<any, any> | undefined {
  return adapters[gameId as GameId];
}
