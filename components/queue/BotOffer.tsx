// The bot offer at 10 s. It slides up as a card; "Keep waiting" docks it to a
// one-line bar so Play bot stays one tap away. You stay queued either way.

import { Button } from "@/components/ui/Button";
import { Icon3D } from "@/components/ui/Icon3D";

export function BotOffer({
  docked,
  busy,
  onAccept,
  onDock,
}: {
  docked: boolean;
  busy: boolean;
  onAccept: () => void;
  onDock: () => void;
}) {
  if (docked)
    return (
      <div className="flex animate-slide items-center gap-2.5 rounded-[20px] bg-sf py-2 pl-3 pr-2 shadow-float">
        <Icon3D name="robot" size={34} />
        <span className="flex-1 text-small font-semibold">Still waiting. A bot is ready.</span>
        <Button variant="act" size="sm" loading={busy} onClick={onAccept}>
          Play bot
        </Button>
      </div>
    );

  return (
    <section
      aria-labelledby="bot-offer-title"
      className="flex animate-slide flex-col gap-3 rounded-sheet bg-sf p-5 shadow-float [animation-duration:.36s]"
    >
      <div className="flex items-center gap-3.5">
        <div className="plate flex h-[72px] w-[72px] flex-none items-center justify-center rounded-[24px]">
          <Icon3D name="robot" size={54} />
        </div>
        <h2 id="bot-offer-title" className="text-[22px] font-semibold leading-[1.12] tracking-[-.03em]">
          No one’s around.
          <br />
          Play a bot now?
        </h2>
      </div>
      <p className="text-small text-ink-2">
        Bot matches are recorded on the ledger, don’t change your rank, and give 1 point.
      </p>
      <Button variant="act" block loading={busy} onClick={onAccept}>
        Play bot
      </Button>
      <Button variant="ghost" block onClick={onDock}>
        Keep waiting
      </Button>
    </section>
  );
}
