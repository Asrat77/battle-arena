"use client";

// Pretty profile link: /u/<username> finds the player and shows their profile.

import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { api } from "@/lib/api";

export default function UsernameRedirect({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const router = useRouter();
  const [state, setState] = useState<"loading" | "missing" | "failed">("loading");

  useEffect(() => {
    const handle = decodeURIComponent(username).replace(/^@/, "").toLowerCase();
    let live = true;
    api.searchProfiles(handle).then(
      (r) => {
        const hit = r.results.find((h) => h.username === handle);
        if (!live) return;
        if (hit) router.replace(`/profile/${hit.profileId}`);
        else setState("missing");
      },
      () => live && setState("failed"),
    );
    return () => {
      live = false;
    };
  }, [username, router]);

  if (state === "loading")
    return (
      <div className="flex justify-center py-12" role="status">
        <span className="spin h-6 w-6 text-ink-2" aria-label="Finding player" />
      </div>
    );
  return (
    <EmptyState
      icon="err404"
      title={state === "missing" ? "No player with that username" : "Couldn’t look that up"}
      action={
        <ButtonLink href="/friends" variant="act">
          Search players
        </ButtonLink>
      }
    >
      {state === "missing" ? "Check the link, or search for them by name." : "Try again in a moment."}
    </EmptyState>
  );
}
