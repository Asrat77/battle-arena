"use client";

// Account settings on your own profile: change your display name and
// @username, and add or change your password.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { useUsernameCheck } from "@/lib/useUsernameCheck";
import { useSession } from "@/lib/session";

const PASSWORD_MIN = 8;

function message(err: unknown) {
  if (!(err instanceof ApiError)) return "Can’t reach Battle Arena. Try again.";
  const m = err.message;
  return m.charAt(0).toUpperCase() + m.slice(1) + ".";
}

export function AccountSettings() {
  const { profile, rename, claim, changePassword } = useSession();
  const toast = useToast();
  const [name, setName] = useState(profile?.name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [namesError, setNamesError] = useState<string | null>(null);
  const [savingNames, setSavingNames] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [show, setShow] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const [savingPass, setSavingPass] = useState(false);

  // Follow a rename made in another tab.
  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setUsername(profile.username);
  }, [profile?.name, profile?.username]); // eslint-disable-line react-hooks/exhaustive-deps

  const check = useUsernameCheck(username, profile?.username ?? "");
  const checking = check.note === "Checking…";
  if (!profile) return null;

  const trimmed = name.trim();
  const namesChanged = trimmed !== profile.name || check.username !== profile.username;
  const nameOk = trimmed.length <= 24;

  const saveNames = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingNames(true);
    setNamesError(null);
    try {
      await rename({
        ...(trimmed !== profile.name && { name: trimmed }),
        ...(check.username !== profile.username && { username: check.username }),
      });
      toast.show({ icon: "idcard", body: "Saved. Everyone sees your new name now." });
    } catch (err) {
      setNamesError(message(err));
    } finally {
      setSavingNames(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPass(true);
    setPassError(null);
    try {
      if (profile.hasPassword) {
        await changePassword(current, next);
        toast.show({ icon: "idcard", body: "Password changed. Other devices were signed out." });
      } else {
        await claim({ password: next });
        toast.show({ icon: "idcard", body: <>Saved. Sign in anywhere as <b>@{profile.username}</b>.</> });
      }
      setCurrent("");
      setNext("");
      setShow(false);
    } catch (err) {
      setPassError(message(err));
    } finally {
      setSavingPass(false);
    }
  };

  return (
    <>
      {!profile.hasPassword && (
        <div role="note" className="rounded-[20px] bg-mismatch-soft p-3.5 text-small">
          <b className="font-semibold text-mismatch">Guest profile.</b> If you sign out or switch device you lose it for good.
          Add a password below to keep your points, friends and history.
        </div>
      )}

      <form className="card flex flex-col gap-3" onSubmit={saveNames}>
        <span className="text-small text-ink-2">Name</span>
        <Field
          label="Display name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          hint="What other players see. Leave it empty to use your username."
          error={nameOk ? null : "24 characters at most"}
        />
        <Field
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          maxLength={21}
          onChange={(e) => setUsername(e.target.value)}
          hint={check.ok || checking ? (check.note ?? "Your @handle. Friends find you by it, and you sign in with it.") : undefined}
          error={check.ok || checking ? namesError : check.note}
        />
        <Button type="submit" loading={savingNames} disabled={savingNames || !namesChanged || !check.ok || !nameOk}>
          Save name
        </Button>
      </form>

      <form className="card flex flex-col gap-3" onSubmit={savePassword}>
        <span className="text-small text-ink-2">{profile.hasPassword ? "Change password" : "Add a password"}</span>
        {/* Lets password managers pair the new password with the handle. */}
        <input type="text" name="username" autoComplete="username" value={profile.username} readOnly hidden />
        {profile.hasPassword && (
          <Field
            label="Current password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        )}
        <Field
          label={profile.hasPassword ? "New password" : "Password"}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint={
            profile.hasPassword
              ? "At least 8 characters"
              : <>At least 8 characters. You’ll sign in as <b>@{profile.username}</b>.</>
          }
          error={passError}
        />
        <label className="flex items-center gap-2 text-small text-ink-2">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show password
        </label>
        <Button
          type="submit"
          variant={profile.hasPassword ? "sec" : "act"}
          loading={savingPass}
          disabled={savingPass || next.length < PASSWORD_MIN || (profile.hasPassword && !current)}
        >
          {profile.hasPassword ? "Change password" : "Save my account"}
        </Button>
      </form>
    </>
  );
}
