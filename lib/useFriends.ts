"use client";

// Your friends with live presence over the socket (contract in
// backend/src/social.ts), plus friend requests: send, accept, decline, cancel.

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";

export interface Friend {
  profileId: string;
  name: string | null;
  status: "offline" | "online" | "in-match";
  matchId: string | null;
}

export interface Requester {
  profileId: string;
  name: string | null;
}

export interface Requests {
  incoming: Requester[];
  outgoing: Requester[];
}

type Ack =
  | { ok: true; friends?: Friend[]; friend?: Friend; status?: "sent" | "accepted"; incoming?: Requester[]; outgoing?: Requester[] }
  | { ok: false; reason: string };

const TIMEOUT_MS = 8000;

/** The server's refusal reasons, in words for the person. */
export function friendError(reason: string): string {
  if (reason === "no profile with that ID") return "No player has that ID or username. Check it and try again.";
  if (reason === "cannot add yourself") return "That’s you.";
  if (reason === "already friends") return "You’re already friends.";
  if (reason === "no request from that player") return "That request is gone. They may have withdrawn it.";
  if (reason === "too many pending requests") return "You have too many pending requests. Cancel some first.";
  if (reason === "friend list is full") return "Your friend list is full.";
  return "Couldn’t do that. Try again.";
}

export function useFriends(): Friend[] | null {
  return useFriendsList().friends;
}

const NO_REQUESTS: Requests = { incoming: [], outgoing: [] };

/** How a request call ended: an error line, or what happened. */
export type RequestResult = { error: string } | { status: "sent" | "accepted" };

export function useFriendsList() {
  const { socket, connected } = useSession();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [requests, setRequests] = useState<Requests>(NO_REQUESTS);

  useEffect(() => {
    if (!socket || !connected) return;
    const onFriends = (p: { friends?: Friend[] }) => setFriends(p?.friends ?? []);
    const onRequests = (p: Partial<Requests>) => setRequests({ incoming: p?.incoming ?? [], outgoing: p?.outgoing ?? [] });
    const onPresence = (f: Friend) => setFriends((xs) => xs && xs.map((x) => (x.profileId === f.profileId ? f : x)));
    socket.on("friends", onFriends);
    socket.on("friendRequests", onRequests);
    socket.on("presence", onPresence);
    socket.emit("friend:list", (res: Ack) => {
      if (!res.ok) return;
      setFriends(res.friends ?? []);
      onRequests(res);
    });
    return () => {
      socket.off("friends", onFriends);
      socket.off("friendRequests", onRequests);
      socket.off("presence", onPresence);
    };
  }, [socket, connected]);

  const call = useCallback(
    (event: string, payload: { profileId: string } | { username: string }) =>
      new Promise<Ack | { ok: false; reason: "offline" | "timeout" }>((resolve) => {
        if (!socket) return resolve({ ok: false, reason: "offline" });
        socket.timeout(TIMEOUT_MS).emit(event, payload, (err: Error | null, res: Ack) => {
          resolve(err ? { ok: false, reason: "timeout" } : res);
        });
      }),
    [socket],
  );

  /** Resolves with an error line, or null on success. */
  const simple = useCallback(
    async (event: string, profileId: string) => {
      const res = await call(event, { profileId });
      if (res.ok) return null;
      if (res.reason === "offline") return "You’re offline. Try again in a moment.";
      if (res.reason === "timeout") return "No answer from the server. Try again.";
      return friendError(res.reason);
    },
    [call],
  );

  /** Send a request to a profile ID or a username. */
  const request = useCallback(
    async (query: string): Promise<RequestResult> => {
      const res = await call("friend:request", { profileId: query });
      if (res.ok) return { status: res.status ?? "sent" };
      if (res.reason === "offline") return { error: "You’re offline. Try again in a moment." };
      if (res.reason === "timeout") return { error: "No answer from the server. Try again." };
      return { error: friendError(res.reason) };
    },
    [call],
  );

  return {
    friends,
    requests,
    request,
    accept: (id: string) => simple("friend:accept", id),
    decline: (id: string) => simple("friend:decline", id),
    cancel: (id: string) => simple("friend:cancel", id),
    remove: (id: string) => simple("friend:remove", id),
  };
}
