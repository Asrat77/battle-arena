// "Matched with X": a split versus card, you in blue on top and the opponent
// in coral below, held briefly before the match screen takes over.

import { Avatar3D } from "@/components/ui/Avatar3D";
import { BotTag, Chip } from "@/components/ui/Chip";
import { Icon3D } from "@/components/ui/Icon3D";

export interface VersusSide {
  id: string;
  name: string;
  bot?: boolean;
}

export function Versus({ gameName, you, opponent }: { gameName: string; you: VersusSide; opponent: VersusSide | null }) {
  return (
    <div
      className="relative grid flex-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1"
      role="status"
      aria-label={opponent ? `Matched with ${opponent.name}` : "Matched"}
    >
      <div className="flex flex-col items-center justify-center gap-3 bg-[radial-gradient(90%_90%_at_50%_100%,rgb(var(--you)/.28),transparent_70%)] md:bg-[radial-gradient(90%_90%_at_100%_50%,rgb(var(--you)/.28),transparent_70%)]">
        <Avatar3D id={you.id} size="xl" seat="you" className="animate-pop" />
        <h2 className="text-[32px] font-semibold tracking-[-.04em]">{you.name}</h2>
        <Chip tone="you">You</Chip>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 bg-[radial-gradient(90%_90%_at_50%_0%,rgb(var(--opp)/.28),transparent_70%)] md:bg-[radial-gradient(90%_90%_at_0%_50%,rgb(var(--opp)/.28),transparent_70%)]">
        {opponent ? (
          <>
            <Avatar3D id={opponent.id} bot={opponent.bot} size="xl" seat="opp" className="animate-pop" />
            <h2 className="flex items-center gap-2 text-[32px] font-semibold tracking-[-.04em]">
              {opponent.name}
              {opponent.bot && <BotTag />}
            </h2>
            <Chip tone="opp">Opponent</Chip>
          </>
        ) : (
          <span className="spin h-6 w-6 text-opp" aria-hidden />
        )}
      </div>
      <Icon3D
        name="vs"
        size={120}
        label="Versus"
        className="absolute left-1/2 top-1/2 -ml-[60px] -mt-[60px] animate-pop drop-shadow-[0_16px_30px_rgba(0,0,0,.6)]"
      />
      <span className="eyebrow absolute inset-x-0 top-[18px] text-center">{gameName} · starting</span>
    </div>
  );
}
