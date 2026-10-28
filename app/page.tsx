"use client";

import { MatchHistory } from "@/components/MatchHistory";
import { ProfileCard } from "@/components/ProfileCard";
import { QuickMatch } from "@/components/QuickMatch";
import { Signup } from "@/components/home/Signup";
import { useSession } from "@/lib/session";

export default function Home() {
  const { ready, profile } = useSession();
  if (!ready) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!profile) return <Signup />;
  return (
    <div className="space-y-4">
      <ProfileCard profile={profile} />
      <QuickMatch />
      <MatchHistory profileId={profile.id} />
    </div>
  );
}
