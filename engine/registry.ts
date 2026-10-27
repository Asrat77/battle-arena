import type { AnyGame } from "./types";

// Each game adds one line here.
const games: AnyGame[] = [];

export function listGames(): AnyGame[] {
  return games;
}

export function getGame(id: string): AnyGame | undefined {
  return games.find((g) => g.id === id);
}
