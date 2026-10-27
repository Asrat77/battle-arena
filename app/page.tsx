"use client";

import { MatchHistory } from "@/components/MatchHistory";
import { ProfileCard } from "@/components/ProfileCard";
import { QuickMatch } from "@/components/QuickMatch";
import { SignupForm } from "@/components/SignupForm";
import { useSession } from "@/lib/session";

export default function Home() {
  const { ready, profile } = useSession();
  if (!ready) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!profile) return <SignupForm />;
  return (
    <div className="space-y-4">
      <ProfileCard profile={profile} />
      <QuickMatch />
      <MatchHistory profileId={profile.id} />
    </div>
  );
}
