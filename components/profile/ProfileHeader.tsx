"use client";

// Identity at the top of a profile: avatar, name, @handle, joined date, and a
// small action row (Copy ID, plus Settings on your own mobile profile).

import Link from "next/link";
import { GearIcon } from "@/components/settings/GearIcon";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { Profile } from "@/lib/api";

const day = (ts: number) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function ProfileHeader({ profile, own }: { profile: Profile; own: boolean }) {
  const toast = useToast();
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(profile.id);
      toast.show({ icon: "idcard", body: own ? "Copied your profile ID" : "Copied the profile ID" });
    } catch {
      toast.show({ icon: "warning", tone: "warn", body: `Couldn’t copy. The ID is ${profile.id}` });
    }
  };
  return (
    <header className="flex items-center gap-4">
      <Avatar3D id={profile.id} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="truncate text-[30px] font-semibold leading-[1.02] tracking-[-.045em]">{profile.name}</h1>
        <span className="truncate text-small text-ink-2">
          <span className="font-semibold text-ink">@{profile.username}</span> · Joined {day(profile.createdAt)}
        </span>
        <Button size="sm" icon="link" className="mt-1 self-start" onClick={copyId} data-testid="copy-profile-id">
          Copy ID
        </Button>
      </div>
      {own && (
        <Link
          href="/settings"
          aria-label="Settings"
          className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-sf text-ink-2 hover:text-ink md:hidden"
        >
          <GearIcon />
        </Link>
      )}
    </header>
  );
}
