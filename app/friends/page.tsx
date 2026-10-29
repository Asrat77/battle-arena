"use client";

// Friends: add by profile ID, see who is online, watch a friend who is in a
// match, remove via a Dialog. Inviting happens from a room (InviteSheet), so
// the list points at "Start a room".

import { useState } from "react";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button, ButtonLink } from "@/components/ui/Button";
import { PresenceChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Icon3D } from "@/components/ui/Icon3D";
import { Dialog } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { useSession } from "@/lib/session";
import { useFriendsList, type Friend } from "@/lib/useFriends";

const ORDER = { online: 0, "in-match": 1, offline: 2 };

export default function FriendsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const { friends, add, remove } = useFriendsList();
  const [id, setId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Friend | null>(null);
  const [busy, setBusy] = useState(false);

  if (!profile) {
    return (
      <EmptyState
        icon="handshake"
        title="Friends"
        action={
          <ButtonLink variant="act" href="/">
            Sign up to add friends
          </ButtonLink>
        }
      >
        Pick a name first, then add friends by their profile ID.
      </EmptyState>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = id.trim().toLowerCase();
    if (!target) return setError("Paste a friend’s profile ID.");
    setAdding(true);
    setError(null);
    const err = await add(target);
    setAdding(false);
    if (err) return setError(err);
    setId("");
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    const err = await remove(removing.profileId);
    setBusy(false);
    if (err) toast.show({ icon: "warning", tone: "warn", body: err });
    setRemoving(null);
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(profile.id);
      toast.show({ icon: "check", body: "Your ID is copied. Send it to a friend." });
    } catch {
      toast.show({ icon: "warning", tone: "warn", body: `Couldn’t copy. Your ID is ${profile.id}` });
    }
  };

  const sorted = [...(friends ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const online = sorted.filter((f) => f.status === "online").length;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="text-h1">Friends</h1>

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-card bg-sf p-4" noValidate>
        <Field
          label="Add a friend by profile ID"
          placeholder="Paste their profile ID"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setError(null);
          }}
          error={error}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          hint={
            <>
              Your ID is <span className="mono">{profile.id}</span>
            </>
          }
        />
        <div className="flex gap-2">
          <Button type="submit" variant="act" icon="plus" loading={adding}>
            Add friend
          </Button>
          <Button onClick={copyId} icon="link">
            Copy my ID
          </Button>
        </div>
      </form>

      {friends === null ? (
        <div className="flex justify-center py-8" role="status">
          <span className="spin h-6 w-6 text-ink-2" aria-label="Loading friends" />
        </div>
      ) : friends.length === 0 ? (
        <EmptyState icon="handshake" title="No friends yet">
          Add a friend by their profile ID. Then you can see when they’re online and invite them to a room.
        </EmptyState>
      ) : (
        <section aria-label="Your friends">
          <div className="flex items-center justify-between pb-1">
            <span className="eyebrow">
              {friends.length} {friends.length === 1 ? "friend" : "friends"} · {online} online
            </span>
            <ButtonLink size="sm" href="/r/new" icon="friends">
              Start a room
            </ButtonLink>
          </div>
          <ul>
            {sorted.map((f) => (
              <li key={f.profileId} className="flex items-center gap-3 border-t border-line py-3">
                <Avatar3D id={f.profileId} />
                <div className="min-w-0 flex-1">
                  <b className="mb-0.5 block truncate font-semibold">{f.name ?? "Player"}</b>
                  <PresenceChip status={f.status} />
                </div>
                {f.status === "in-match" && f.matchId && (
                  <ButtonLink size="sm" href={`/match/${f.matchId}`} icon="binoculars">
                    Watch
                  </ButtonLink>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${f.name ?? "friend"}`}
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-[14px] hover:bg-sf-2"
                  onClick={() => setRemoving(f)}
                >
                  <Icon3D name="xmark" size={22} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        icon="warning"
        title={`Remove ${removing?.name ?? "this friend"}?`}
        actions={
          <>
            <Button onClick={() => setRemoving(null)}>Keep</Button>
            <Button variant="bad" loading={busy} onClick={confirmRemove}>
              Remove
            </Button>
          </>
        }
      >
        You won’t see when they’re online. You can add them again by ID.
      </Dialog>
    </div>
  );
}
