import { BotTag, Chip, type ChipTone } from "@/components/ui/Chip";
import type { Icon3DName } from "@/components/ui/Icon3D";
import type { TournamentState } from "@/lib/api";

export const GAME_ICONS: Record<string, Icon3DName> = { "crack-the-code": "vault", gebeta: "mancala" };

const STATE: Record<TournamentState["state"], { label: string; tone: ChipTone }> = {
  open: { label: "Open", tone: "rec" },
  running: { label: "Running", tone: "pend" },
  finished: { label: "Finished", tone: "neutral" },
};

export function StateChip({ state }: { state: TournamentState["state"] }) {
  return <Chip tone={STATE[state].tone}>{STATE[state].label}</Chip>;
}

export function Name({ name, bot }: { name: string; bot: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-semibold">{name}</span>
      {bot && <BotTag />}
    </span>
  );
}
