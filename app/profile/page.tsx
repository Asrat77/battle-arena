"use client";

// Your own profile. Settings live at /settings.

import { ProfileView } from "@/components/profile/ProfileView";
import { ComingSoon } from "@/components/shell/ComingSoon";
import { useSession } from "@/lib/session";
import { Page } from "@/components/ui/Page";

export default function ProfilePage() {
  const { profile } = useSession();
  if (!profile)
    return (
      <ComingSoon icon="idcard" title="Profile">
        Sign up to get a profile.
      </ComingSoon>
    );
  return (
    <Page width="wide">
      <ProfileView id={profile.id} own />
    </Page>
  );
}
