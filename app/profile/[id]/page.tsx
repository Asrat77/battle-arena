"use client";

// Someone's public profile, linked from the leaderboard and shared badges.
// Your own ID shows the same view with the "no wallet needed" note.

import { use } from "react";
import { ProfileView } from "@/components/profile/ProfileView";
import { useSession } from "@/lib/session";

export default function PublicProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { profile } = useSession();
  const own = profile?.id === id.toLowerCase();
  return (
    <div className="mx-auto flex max-w-xl flex-col">
      <ProfileView id={id.toLowerCase()} own={own} />
    </div>
  );
}
