"use client";

// Invite a friend to your room (contract in backend/src/social.ts). Online
// friends get an Invite button and, once sent, a toast with Join on their
// side; friends in a match can be watched instead, offline ones are listed
// but can't be invited.

import { useEffect, useState } from "react";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon3D } from "@/components/ui/Icon3D";
import { Sheet } from "@/components/ui/Overlay";
import { useSession } from "@/lib/session";

const INVITE_TIMEOUT_MS = 8000;

export interface Friend {
  profileId: string;
  name: string | null;
  status: "offline" | "online" | "in-match";
  matchId: string | null;
}

type Ack = { ok: true; friends?: Friend[] } | { ok: false; reason: string };

/** Your friends with live presence, kept current over the socket. */
export function useFriends(): Friend[] | null {
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

  return friends;
}

export function InviteSheet({
  open,
  onClose,
  code,
  friends,
}: {
  open: boolean;
  onClose: () => void;
  code: string;
  friends: Friend[] | null;
}) {
  const { socket } = useSession();
  const [sent, setSent] = useState<Record<string, "sending" | "sent" | string>>({});

  const invite = (id: string) => {
    if (!socket) return;
    setSent((s) => ({ ...s, [id]: "sending" }));
    socket.timeout(INVITE_TIMEOUT_MS).emit("friend:invite", { profileId: id, code }, (err: Error | null, res: Ack) => {
      const result = err ? "Couldn’t send" : res.ok ? "sent" : reasonText(res.reason);
      setSent((s) => ({ ...s, [id]: result }));
    });
  };

  const online = (friends ?? []).filter((f) => f.status === "online");
  const away = (friends ?? []).filter((f) => f.status !== "online");

  return (
    <Sheet open={open} onClose={onClose} title={`Invite to ${code}`}>
      <p className="-mt-2 flex items-center gap-2 text-small text-ink-2">
        <Icon3D name="handshake" size={28} />
        They get a toast with Join
      </p>
      {friends === null ? (
        <div className="flex justify-center py-6" role="status">
          <span className="spin h-6 w-6 text-ink-2" aria-label="Loading friends" />
        </div>
      ) : friends.length === 0 ? (
        <p className="pb-2 text-ink-2">
          No friends added yet. Share the room link instead, or add friends by their profile ID.
        </p>
      ) : (
        <>
          <section aria-label="Online friends">
            <span className="eyebrow">Online · {online.length}</span>
            {online.length === 0 ? (
              <p className="py-3 text-small text-ink-2">Nobody is online right now. Share the link instead.</p>
            ) : (
              <ul>
                {online.map((f) => {
                  const state = sent[f.profileId];
                  return (
                    <FriendRow key={f.profileId} friend={f} note="Online" online>
                      {state === "sent" ? (
                        <Chip tone="rec">
                          <Icon3D name="check" size={16} />
                          Sent
                        </Chip>
                      ) : state && state !== "sending" ? (
                        <span className="text-small font-semibold text-mismatch">{state}</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="act"
                          loading={state === "sending"}
                          onClick={() => invite(f.profileId)}
                          aria-label={`Invite ${f.name ?? "friend"}`}
                        >
                          Invite
                        </Button>
                      )}
                    </FriendRow>
                  );
                })}
              </ul>
            )}
          </section>
          {away.length > 0 && (
            <section aria-label="Friends not available">
              <span className="eyebrow">Not available</span>
              <ul className="opacity-60">
                {away.map((f) => (
                  <FriendRow key={f.profileId} friend={f} note={f.status === "in-match" ? "In a match" : "Offline"}>
                    {f.status === "in-match" && f.matchId && (
                      <ButtonLink size="sm" href={`/match/${f.matchId}`}>
                        Watch
                      </ButtonLink>
                    )}
                  </FriendRow>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}

function FriendRow({
  friend,
  note,
  online,
  children,
}: {
  friend: Friend;
  note: string;
  online?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 border-t border-line py-3">
      <Avatar3D id={friend.profileId} />
      <div className="min-w-0 flex-1">
        <b className="block truncate font-semibold">{friend.name ?? "Player"}</b>
        <div className={`flex items-center gap-1.5 text-small ${online ? "" : "text-ink-2"}`}>
          {online && <i className="block h-[7px] w-[7px] rounded-full bg-recorded" aria-hidden />}
          {note}
        </div>
      </div>
      {children}
    </li>
  );
}

function reasonText(reason: string): string {
  if (reason === "friend is offline") return "Went offline";
  if (reason === "room is full") return "Room is full";
  if (reason === "already in the room") return "Already here";
  return "Couldn’t send";
}
