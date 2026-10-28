"use client";

// A friend's room invite (`notify {kind: "invite"}` from backend/src/social.ts)
// shows as a toast with Join, wherever you are in the app.

import { useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";

const INVITE_TOAST_MS = 20_000;

interface Invite {
  kind: "invite";
  from: { profileId: string; name: string | null };
  code: string;
  link: string;
  gameName: string;
}

export function useInviteToasts() {
  const { socket } = useSession();
  const toast = useToast();

  useEffect(() => {
    if (!socket) return;
    const onNotify = (n: { kind?: string }) => {
      if (n?.kind !== "invite") return;
      const inv = n as Invite;
      toast.show({
        avatar: { id: inv.from.profileId },
        body: (
          <>
            <b>{inv.from.name ?? "A friend"}</b> invited you to {inv.gameName}
          </>
        ),
        action: { label: "Join", href: inv.link, primary: true },
        duration: INVITE_TOAST_MS,
      });
    };
    socket.on("notify", onNotify);
    return () => {
      socket.off("notify", onNotify);
    };
  }, [socket, toast]);
}
