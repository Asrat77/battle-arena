import { crackTheCode } from "./games/crackTheCode";
import { gebeta } from "./games/gebeta";
import { ticTacToe } from "./games/ticTacToe";
import { dotsAndBoxes } from "./games/dotsAndBoxes";
import { bingo } from "./games/bingo";
import type { AnyGame } from "./types";

// Each game adds one line here.
const games: AnyGame[] = [crackTheCode, gebeta, ticTacToe, dotsAndBoxes, bingo];

export function listGames(): AnyGame[] {
  return games;
}

export function getGame(id: string): AnyGame | undefined {
  return games.find((g) => g.id === id);
}
