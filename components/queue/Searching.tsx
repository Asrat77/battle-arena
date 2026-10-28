// The search moment: your avatar inside saffron ripples, the elapsed time and
// how many people are queued for this game.

import { Avatar3D } from "@/components/ui/Avatar3D";

export function formatElapsed(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const RIPPLE_DELAYS = ["0s", ".8s", "1.6s"];

export function Searching({
  profileId,
  gameName,
  elapsed,
  queued,
}: {
  profileId: string;
  gameName: string;
  elapsed: number;
  /** Players in this game's queue, you included; null until loaded. */
  queued: number | null;
}) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <span className="eyebrow">Quick match · {gameName}</span>
      <div className="relative flex h-[220px] w-[220px] items-center justify-center" aria-hidden>
        {RIPPLE_DELAYS.map((d) => (
          <i
            key={d}
            className="absolute inset-0 animate-ripple rounded-full border border-accent/50 opacity-0 [animation-duration:2.4s]"
            style={{ animationDelay: d }}
          />
        ))}
        <Avatar3D id={profileId} size="xl" />
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <h1 className="text-h2">Looking for an opponent</h1>
        <span className="mono text-[44px] font-semibold leading-none tracking-[-.04em]" role="timer" aria-label={`${elapsed} seconds`}>
          {formatElapsed(elapsed)}
        </span>
        {queued !== null && (
          <span className="text-small text-ink-2">
            {queued <= 1 ? "Only you in the queue so far" : `${queued} players in the queue`}
          </span>
        )}
      </div>
    </div>
  );
}
