"use client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { TournamentState } from "@/lib/api";
import { shareLink } from "@/lib/share";

/** Share sheet on phones, Copy link on desktop. Links are built from the current origin. */
export function ShareButton({ t }: { t: TournamentState }) {
  const toast = useToast();
  const onClick = async () => {
    const url = new URL(t.link, window.location.origin).toString();
    const text = `Join my ${t.gameName} tournament, ${t.size} players`;
    const result = await shareLink({ title: t.name, text, url });
    if (result === "copied") toast.show({ icon: "link", body: "Tournament link copied" });
    if (result === "manual") toast.show({ icon: "link", body: <span className="mono select-all break-all">{url}</span>, duration: 0 });
  };
  return (
    <Button variant="ghost" icon="link" onClick={onClick}>
      Share
    </Button>
  );
}
