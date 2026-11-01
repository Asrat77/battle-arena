"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/session";

/** Guests have no password, so signing out loses the profile: ask first. */
export function SignOut() {
  const { profile, signOut } = useSession();
  const [confirm, setConfirm] = useState(false);
  if (profile?.hasPassword || confirm)
    return (
      <Button variant="ghost" onClick={signOut}>
        {profile?.hasPassword ? "Sign out" : "Yes, sign out and lose this guest profile"}
      </Button>
    );
  return (
    <Button variant="ghost" onClick={() => setConfirm(true)}>
      Sign out
    </Button>
  );
}
