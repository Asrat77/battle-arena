"use client";

// Your own profile, plus the settings that used to live in the old header:
// theme and sign out.

import { useState } from "react";
import { ProfileView } from "@/components/profile/ProfileView";
import { ComingSoon } from "@/components/shell/ComingSoon";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

export default function ProfilePage() {
  const { profile, signOut, claim } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const { theme, setTheme } = useTheme();
  if (!profile)
    return (
      <ComingSoon icon="idcard" title="Profile">
        Sign up to get a profile.
      </ComingSoon>
    );
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
        <div className="card flex flex-col gap-3">
          <span className="text-small text-ink-2">Account</span>
          {profile.username ? (
            <p className="m-0">
              Saved as <b>@{profile.username}</b>. Sign in with your password on any device and your points, friends and history
              come with you.
            </p>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  await claim({ username, password });
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Can’t reach Battle Arena. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="m-0">
                This is a guest profile. If you sign out, or switch device, you lose it for good. Add a username and password to
                keep your points, friends and history.
              </p>
              <Field
                label="Username"
                autoComplete="username"
                autoCapitalize="none"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                hint="3–20 letters, numbers or underscores"
              />
              <Field
                label="Password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={error}
                hint="At least 8 characters"
              />
              <Button type="submit" variant="act" disabled={busy || !username || !password}>
                Save my account
              </Button>
            </form>
          )}
        </div>
        {profile.username || confirmOut ? (
          <Button variant="ghost" onClick={signOut}>
            {profile.username ? "Sign out" : "Yes, sign out and lose this guest profile"}
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmOut(true)}>
            Sign out
          </Button>
        )}
      </section>
    </div>
  );
}
