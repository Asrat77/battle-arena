"use client";

// A banner for a dropped socket. It waits a moment first, so the first connect
// and quick blips don't flash it.

import { useEffect, useState } from "react";
import { Icon3D } from "@/components/ui/Icon3D";
import { useSession } from "@/lib/session";

const GRACE_MS = 1500;

export function ConnectionBanner() {
  const { profile, connected } = useSession();
  const [show, setShow] = useState(false);
  const down = Boolean(profile) && !connected;

  useEffect(() => {
    if (!down) return setShow(false);
    const t = setTimeout(() => setShow(true), GRACE_MS);
    return () => clearTimeout(t);
  }, [down]);

  if (!show) return null;
  return (
    <p
      role="status"
      className="fixed inset-x-3 top-3 z-[60] mx-auto flex min-h-11 max-w-[420px] items-center justify-center gap-2 rounded-[16px] bg-pending-soft px-4 text-center text-[14px] font-semibold text-pending shadow-float backdrop-blur-[18px]"
    >
      <Icon3D name="hourglass" size={22} />
      Reconnecting… In a live match you forfeit after 30 s offline.
    </p>
  );
}
