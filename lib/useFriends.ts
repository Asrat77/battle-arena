"use client";

// Your friends with live presence over the socket (contract in
// backend/src/social.ts), plus add and remove.

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";

export interface Friend {
  profileId: string;
  name: string | null;
  status: "offline" | "online" | "in-match";
  matchId: string | null;
}

type Ack = { ok: true; friends?: Friend[]; friend?: Friend } | { ok: false; reason: string };

const TIMEOUT_MS = 8000;

/** The server's refusal reasons, in words for the person. */
export function friendError(reason: string): string {
  if (reason === "no profile with that ID") return "No player has that ID. Check it and try again.";
  if (reason === "cannot add yourself") return "That’s your own ID.";
  if (reason === "friend list is full") return "Your friend list is full.";
  return "Couldn’t do that. Try again.";
}

export function useFriends(): Friend[] | null {
  return useFriendsList().friends;
}

export function useFriendsList() {
  const { socket, connected } = useSession();
  const [friends, setFriends] = useState<Friend[] | null>(null);

  useEffect(() => {
    if (!socket || !connected) return;
    const onFriends = (p: { friends?: Friend[] }) => setFriends(p?.friends ?? []);
    const onPresence = (f: Friend) => setFriends((xs) => xs && xs.map((x) => (x.profileId === f.profileId ? f : x)));
    socket.on("friends", onFriends);
    socket.on("presence", onPresence);
    socket.emit("friend:list", (res: Ack) => res.ok && setFriends(res.friends ?? []));
    return () => {
      socket.off("friends", onFriends);
      socket.off("presence", onPresence);
    };
  }, [socket, connected]);

  /** Resolves with an error line, or null on success. */
  const call = useCallback(
    (event: "friend:add" | "friend:remove", profileId: string) =>
      new Promise<string | null>((resolve) => {
        if (!socket) return resolve("You’re offline. Try again in a moment.");
        socket.timeout(TIMEOUT_MS).emit(event, { profileId }, (err: Error | null, res: Ack) => {
          if (err) resolve("No answer from the server. Try again.");
          else resolve(res.ok ? null : friendError(res.reason));
        });
      }),
    [socket],
  );

  return {
    friends,
    add: (id: string) => call("friend:add", id),
    remove: (id: string) => call("friend:remove", id),
  };
}
