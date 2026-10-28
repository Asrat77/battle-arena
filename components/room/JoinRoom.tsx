"use client";

// /r: type or paste a room code (or the whole link). The room is looked up
// first so a typo or a full room is explained here, not on a blank screen.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon3D } from "@/components/ui/Icon3D";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { normalizeCode } from "./useRoom";

const CODE_LENGTH = 5;

export function JoinRoom() {
  const router = useRouter();
  const { profile } = useSession();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = normalizeCode(raw).slice(0, CODE_LENGTH);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== CODE_LENGTH) return setError(`Room codes are ${CODE_LENGTH} characters.`);
    setBusy(true);
    try {
      const room = await api.room(code);
      const seated = room.members.some((m) => m.profileId === profile?.id);
      if (room.members.length >= 2 && !seated) {
        setError(`Room ${code} is full. Two players are already sitting there.`);
        return;
      }
      router.push(`/r/${code}`);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? `No room with code ${code}. Check the letters with whoever sent it.`
          : "Couldn’t reach the server. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-5 py-6">
      <header className="flex items-center gap-3.5">
        <div className="plate flex h-[72px] w-[72px] flex-none items-center justify-center rounded-[24px]">
          <Icon3D name="key" size={52} />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-h2">Join a room</h1>
          <p className="text-small text-ink-2">Enter the code a friend sent you.</p>
        </div>
      </header>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Field
          label="Room code"
          hideLabel
          placeholder="K7Q2M"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="mono text-center text-[24px] uppercase tracking-[.2em]"
          value={code}
          onChange={(e) => {
            setRaw(e.target.value);
            setError(null);
          }}
          onPaste={(e) => {
            e.preventDefault();
            setRaw(e.clipboardData.getData("text"));
            setError(null);
          }}
          error={error}
        />
        <Button type="submit" variant="act" block loading={busy} disabled={!code}>
          Join
        </Button>
      </form>
      <ButtonLink href="/r/new" variant="ghost" icon="plus" block>
        Open a room instead
      </ButtonLink>
    </div>
  );
}
