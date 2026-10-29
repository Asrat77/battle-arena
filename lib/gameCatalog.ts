// Display metadata only: the engine registry remains the source of game rules.
import type { Icon3DName } from "@/components/ui/Icon3D";

export const GAME_CATALOG = [
  { id: "crack-the-code", name: "Crack the Code", short: "Code", abbreviation: "CtC", kicker: "Logic · 1v1", blurb: "Guess their 4-digit code before they guess yours.", art: "vault" },
  { id: "gebeta", name: "Gebeta", short: "Gebeta", abbreviation: "Geb", kicker: "Ethiopian mancala", blurb: "Sow, capture, out-seed them.", art: "mancala" },
  { id: "tic-tac-toe", name: "Tic-Tac-Toe", short: "Tic-Tac-Toe", abbreviation: "TTT", kicker: "Three in a row · 1v1", blurb: "Claim a line. Win the best of three.", art: "tic tac toe" },
] as const satisfies readonly { id: string; name: string; short: string; abbreviation: string; kicker: string; blurb: string; art: Icon3DName }[];

export type GameId = (typeof GAME_CATALOG)[number]["id"];
export const GAME_ICONS: Record<string, Icon3DName> = Object.fromEntries(GAME_CATALOG.map((g) => [g.id, g.art]));
export const GAME_SHORT: Record<string, string> = Object.fromEntries(GAME_CATALOG.map((g) => [g.id, g.abbreviation]));
export const GAME_OPTIONS = GAME_CATALOG.map((g) => ({ value: g.id, label: g.short, icon: g.art }));
