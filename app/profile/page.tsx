"use client";

// Your own profile, plus the settings that used to live in the old header:
// theme and sign out.

import { ProfileView } from "@/components/profile/ProfileView";
import { ComingSoon } from "@/components/shell/ComingSoon";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

export default function ProfilePage() {
  const { profile, signOut } = useSession();
  const { theme, setTheme } = useTheme();
  if (!profile) return <ComingSoon icon="idcard" title="Profile">Sign up to get a profile.</ComingSoon>;
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3.5">
      <ProfileView id={profile.id} own />
      <section aria-labelledby="settings-heading" className="mt-2 flex flex-col gap-2.5">
        <h2 id="settings-heading" className="eyebrow px-0.5">
          Settings
        </h2>
        <div className="card flex flex-col gap-3">
          <span className="text-small text-ink-2">Theme</span>
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Arena Night" },
              { value: "light", label: "Day" },
            ]}
          />
        </div>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </section>
    </div>
  );
}
