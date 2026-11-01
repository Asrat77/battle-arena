"use client";

// The relationship button on someone else's profile: a presence chip plus one
// primary action that follows where you stand (Add / Sent / Accept / Friends),
// and Watch live when they are in a match. Signed-out visitors get a sign-up nudge.

import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { PresenceChip } from "@/components/ui/Chip";
import { Dialog } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { api, type Profile } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFriendsList } from "@/lib/useFriends";

type Presence = { status: "online" | "in-match" | "offline"; matchId: string | null };

const REFRESH_MS = 15000;

export function FriendButton({ profile }: { profile: Profile }) {
  const { profile: me } = useSession();
  const toast = useToast();
  const { friends, requests, request, accept, decline, cancel, remove } = useFriendsList();
  const [presence, setPresence] = useState<Presence | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let live = true;
    const ctl = new AbortController();
    const load = () =>
      api.presence(profile.id, ctl.signal).then(
        (p) => live && setPresence({ status: p.status, matchId: p.matchId }),
        () => {},
      );
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      ctl.abort();
      clearInterval(t);
    };
  }, [profile.id]);

  const isFriend = friends?.some((f) => f.profileId === profile.id) ?? false;
  const sent = requests.outgoing.some((r) => r.profileId === profile.id);
  const incoming = requests.incoming.some((r) => r.profileId === profile.id);

  const run = async (action: () => Promise<string | null>, ok?: string) => {
    setBusy(true);
    const err = await action();
    setBusy(false);
    if (err) toast.show({ icon: "warning", tone: "warn", body: err });
    else if (ok) toast.show({ icon: "check", body: ok });
  };

  const add = async () => {
    setBusy(true);
    const res = await request(profile.id);
    setBusy(false);
    if ("error" in res) return toast.show({ icon: "warning", tone: "warn", body: res.error });
    toast.show({ icon: "check", body: res.status === "accepted" ? "You’re now friends." : "Request sent." });
  };

  const watch = presence?.status === "in-match" && presence.matchId;

  let action: React.ReactNode;
  if (!me) {
    action = (
      <ButtonLink variant="act" href="/" icon="plus">
        Sign up to add {profile.name}
      </ButtonLink>
    );
  } else if (friends === null) {
    action = (
      <Button size="sm" disabled loading>
        Loading
      </Button>
    );
  } else if (isFriend) {
    action = (
      <Button icon="handshake" onClick={() => setConfirm(true)} data-testid="friend-button">
        Friends
      </Button>
    );
  } else if (incoming) {
    action = (
      <>
        <Button variant="act" loading={busy} onClick={() => run(() => accept(profile.id), "You’re now friends.")} data-testid="friend-button">
          Accept request
        </Button>
        <Button disabled={busy} onClick={() => run(() => decline(profile.id))}>
          Decline
        </Button>
      </>
    );
  } else if (sent) {
    action = (
      <Button loading={busy} onClick={() => run(() => cancel(profile.id), "Request cancelled.")} data-testid="friend-button">
        Request sent · Cancel
      </Button>
    );
  } else {
    action = (
      <Button variant="act" icon="plus" loading={busy} onClick={add} data-testid="friend-button">
        Add friend
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presence && <PresenceChip status={presence.status} />}
      {action}
      {watch && (
        <ButtonLink href={`/match/${presence.matchId}`} icon="binoculars" data-testid="watch-live">
          Watch live
        </ButtonLink>
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        icon="warning"
        title={`Remove ${profile.name}?`}
        actions={
          <>
            <Button onClick={() => setConfirm(false)}>Keep</Button>
            <Button
              variant="bad"
              loading={busy}
              onClick={async () => {
                await run(() => remove(profile.id), "Removed from your friends.");
                setConfirm(false);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        They’ll be removed from your list too. You can send a new request any time.
      </Dialog>
    </div>
  );
}
