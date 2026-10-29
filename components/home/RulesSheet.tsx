"use client";

// "How to play" bottom sheet for a game card. The rules use the adapter's
// `rules` shape so the match screen can reuse the same copy.

import { Button } from "@/components/ui/Button";
import { Icon3D } from "@/components/ui/Icon3D";
import { Sheet } from "@/components/ui/Overlay";
import type { GameAdapter, GameId } from "@/components/match/adapter";
import { rulesText as gebetaRules } from "@/engine/games/gebeta";
import { rules as ticTacToeRules } from "@/engine/games/ticTacToe";
import { GAME_ICONS } from "@/lib/gameCatalog";

export type Rules = GameAdapter<unknown, unknown>["rules"] & { subtitle: string };

export const RULES: Record<GameId, Rules> = {
  "tic-tac-toe": {
    title: "How to play Tic-Tac-Toe", subtitle: "3×3 grid · up to three boards · 30 seconds a turn", art: GAME_ICONS["tic-tac-toe"], lines: ticTacToeRules,
  },
  "crack-the-code": {
    title: "How to play Crack the Code",
    subtitle: "4-digit codes · both guess at once · 30 rounds",
    art: "vault",
    lines: [
      "Set your secret: 4 different digits, 1–9. It stays hidden until the end. You have 60 s to lock it in.",
      "Each round you both guess the other’s code at the same time, 45 s a round.",
      "The meter shows how many digits are in the right spot (saffron) and how many more are in the code (grey).",
      "Crack their code first to win. Both in the same round, or no one by round 30, is a draw.",
    ],
  },
  gebeta: {
    title: "How to play Gebeta",
    subtitle: "Kalah variant · 6 pits a side · 4 seeds each",
    art: "mancala",
    // Split the engine's own rules so the copy can't drift from the referee.
    lines: gebetaRules.split(/(?<=\.)\s+/).slice(1),
  },
};

export function RulesSheet({ game, onClose }: { game: GameId | null; onClose: () => void }) {
  const rules = game ? RULES[game] : null;
  return (
    <Sheet
      open={Boolean(rules)}
      onClose={onClose}
      title={rules?.title ?? ""}
      hero={
        rules && (
          <div className="relative h-[120px] overflow-hidden" aria-hidden>
            <div className="dither h-[140px]" />
            <div className="plate absolute left-1/2 top-1 -ml-14 flex h-28 w-28 items-center justify-center rounded-full">
              <Icon3D name={rules.art} size={92} />
            </div>
          </div>
        )
      }
    >
      {rules && (
        <>
          <p className="-mt-2.5 text-small text-ink-2">{rules.subtitle}</p>
          <ol className="flex flex-col gap-3">
            {rules.lines.map((line, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[9px] bg-sf-2 font-mono text-[13px] font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
          <Button variant="act" block onClick={onClose}>
            Got it
          </Button>
        </>
      )}
    </Sheet>
  );
}
