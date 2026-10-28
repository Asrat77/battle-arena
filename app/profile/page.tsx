"use client";

import { ComingSoon } from "@/components/shell/ComingSoon";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { shortId } from "@/lib/usePlayerNames";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

// Placeholder until the profile & badges screen ships: who you are, the
// theme switch and sign out (which used to live in the old header).
export default function ProfilePage() {
  const { profile, signOut } = useSession();
  const { theme, setTheme } = useTheme();
  if (!profile) return <ComingSoon icon="idcard" title="Profile">Sign up to get a profile.</ComingSoon>;
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="card flex items-center gap-3.5">
        <Avatar3D id={profile.id} size="lg" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <b className="text-xl font-semibold tracking-[-.03em]">{profile.name}</b>
          <span className="mono text-small text-ink-2">{shortId(profile.id)}</span>
        </div>
      </div>
      <div className="card flex flex-col gap-3">
        <span className="eyebrow">Theme</span>
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
    </div>
  );
}
