"use client";

// Pick your animal. Saves on tap.

import { useState } from "react";
import { AvatarPicker } from "@/components/ui/AvatarPicker";
import { useToast } from "@/components/ui/Toast";
import { isAvatar, type AvatarName } from "@/engine/avatars";
import { useSession } from "@/lib/session";

export function PictureSettings() {
  const { profile, setAvatar } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pick = async (a: AvatarName) => {
    setBusy(true);
    try {
      await setAvatar(a);
      toast.show({ icon: "idcard", body: "Picture saved." });
    } catch {
      toast.show({ icon: "warning", body: "Couldn’t save your picture. Try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <AvatarPicker value={isAvatar(profile?.avatar) ? profile.avatar : null} onChange={pick} disabled={busy} />
    </div>
  );
}
