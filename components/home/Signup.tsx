"use client";

// First visit: a 3D hero and a username + password form (or a guest name). Signing up creates the profile ID
// on the server (no wallet) and Home takes over once the session has a profile.
// Below it, a self-playing Gebeta round shows what you're signing up for.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { GebetaPreview } from "./GebetaPreview";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useUsernameCheck } from "@/lib/useUsernameCheck";
import { AvatarPicker } from "@/components/ui/AvatarPicker";
import type { AvatarName } from "@/engine/avatars";

const NAME_MAX = 20;

type Phase = "edit" | "busy" | "offline";

function nameError(name: string): string | null {
  const n = name.trim().length;
  return n > NAME_MAX ? `That’s ${n} characters. Keep it to ${NAME_MAX}.` : null;
}

export function Signup({ invite }: { invite?: { title: string; detail: string } }) {
  const { signup, signIn } = useSession();
  const toast = useToast();
  // new = username + password; guest = just a display name; signin = existing account.
  const [mode, setMode] = useState<Mode>("new");
  const [avatar, setAvatar] = useState<AvatarName | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState<string | null>(null);
  // Bumped on each failed submit so the form shakes again.
  const [shakes, setShakes] = useState(0);
  const field = useRef<HTMLDivElement>(null);

  const check = useUsernameCheck(mode === "new" ? username : "");
  const live = nameError(name);
  const count = name.trim().length;
  const strength = passwordStrength(password);

  // Which field the form-level error belongs to, so it is announced there and focus goes there.
  const [errorOn, setErrorOn] = useState<"name" | "username" | "password">("password");

  const fail = (msg: string, on: "name" | "username" | "password" = "password") => {
    setError(msg);
    setErrorOn(on);
    setShakes((s) => s + 1);
  };

  // The shake remounts the fields, so put focus on the one with the error once they exist.
  useEffect(() => {
    if (!shakes) return;
    const root = field.current;
    (root?.querySelector<HTMLInputElement>('input[aria-invalid="true"]') ?? root?.querySelector("input"))?.focus();
  }, [shakes]);

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setPhase("edit");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const handle = username.trim().replace(/^@/, "").toLowerCase();
    if (mode === "guest") {
      if (!name.trim()) return fail("Type a name to play.", "name");
      if (live) return fail(live, "name");
    } else {
      if (!handle) return fail("Enter your username.", "username");
      if (!password) return fail("Enter your password.");
      if (mode === "new") {
        if (!check.ok) return fail(check.note === "Checking…" ? "Checking that username. One moment." : (check.note ?? "Pick a different username."), "username");
        if (password.length < PASSWORD_MIN) return fail(`Password needs at least ${PASSWORD_MIN} characters.`);
      }
    }
    setPhase("busy");
    setError(null);
    try {
      if (mode === "signin") {
        await signIn({ username: handle, password });
        toast.show({ icon: "idcard", body: <>Welcome back, @{handle}.</>, href: "/profile" });
      } else if (mode === "guest") {
        await signup(name.trim(), undefined, avatar ?? undefined);
        toast.show({ icon: "idcard", body: <>Welcome, {name.trim()}. Add a password later to keep this profile.</>, href: "/profile" });
      } else {
        await signup("", { username: handle, password }, avatar ?? undefined);
        toast.show({ icon: "idcard", body: <>Welcome, @{handle}. Your account is saved.</>, href: "/profile" });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        setPhase("edit");
        fail(mode === "signin" ? signInMessage(err) : err.message, mode === "signin" || /password/i.test(err.message) ? "password" : "username");
      } else {
        setPhase("offline");
      }
    }
  };

  if (phase === "busy") return <Creating name={mode === "guest" ? name.trim() : username.trim().replace(/^@/, "")} />;

  const offline = phase === "offline";
  const toggle = (
    <button
      type="button"
      onClick={() => setShow((v) => !v)}
      className="rounded-full px-2 py-1 text-small font-semibold text-ink-2"
      aria-label={show ? "Hide password" : "Show password"}
    >
      {show ? "Hide" : "Show"}
    </button>
  );

  return (
    <div className="relative -mx-4 -mt-6 min-h-[calc(100dvh-60px)] px-4 pt-2 md:-mx-6 md:px-6 md:pt-14">
      <div className={`dither ${offline ? "grayscale" : ""}`} />
      <div className="relative mx-auto grid max-w-[960px] items-center md:grid-cols-2 md:gap-12">
        <Hero offline={offline} />
        <form onSubmit={submit} noValidate aria-label={mode === "signin" ? "Sign in" : mode === "guest" ? "Play as a guest" : "Create account"} className="flex flex-col gap-[18px] px-1.5 pb-6 md:px-0">
          {offline ? (
            <div role="alert" className="flex items-center gap-3 rounded-[20px] bg-mismatch-soft p-3.5">
              <Icon3D name="warning" size={36} />
              <div className="flex flex-col gap-0.5">
                <b className="font-semibold text-mismatch">Can’t reach Battle Arena</b>
                <span className="text-small">Your details are kept. Check your connection and try again.</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {invite && (
                <div className="card flex items-center gap-3 !bg-pending-soft" role="status">
                  <Icon3D name="trophy" size={44} />
                  <div className="flex min-w-0 flex-col">
                    <b className="truncate">{invite.title}</b>
                    <span className="text-small text-ink-2">{invite.detail}</span>
                  </div>
                </div>
              )}
              <span className="eyebrow">Battle Arena · live 1v1</span>
              <h1 className="text-h1">
                {mode === "signin" ? "Welcome back." : mode === "guest" ? "Pick a name." : "Make an account."}
                <br />
                Play in a minute.
              </h1>
              <p className="m-0 text-base text-ink-2">
                Crack the Code, Gebeta, Tic-Tac-Toe, Dots and Boxes and BINGO, head to head. Every result is recorded so anyone can check it.
              </p>
            </div>
          )}

          <div ref={field} key={shakes} className={`flex flex-col gap-3.5 ${shakes ? "animate-shake" : ""}`}>
            {mode === "guest" ? (
              <Field
                label="Display name"
                placeholder="e.g. Abebe"
                autoComplete="nickname"
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                error={errorOn === "name" && error ? error : live}
                hint={<span className="font-semibold">{count ? `${count} / ${NAME_MAX}` : `1–${NAME_MAX} characters`}</span>}
              />
            ) : (
              <>
                <Field
                  label="Username"
                  placeholder="e.g. abebe_k"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  required
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError(null);
                  }}
                  error={
                    errorOn === "username" && error
                      ? error
                      : mode === "signin"
                        ? null
                        : !check.ok && check.note && check.note !== "Checking…"
                          ? check.note
                          : null
                  }
                  liveHint
                  hint={
                    mode === "signin"
                      ? undefined
                      : check.note
                        ? <span className={check.ok ? "font-semibold text-recorded" : ""}>{check.note}</span>
                        : "3–20 letters, numbers or underscores. This is how friends find you."
                  }
                />
                <Field
                  label="Password"
                  type={show ? "text" : "password"}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  trailing={toggle}
                  required
                  error={errorOn === "password" ? error : null}
                  hint={
                    mode === "signin" ? (
                      "Playing as a guest before? Guests have no password. Choose “Just play as a guest” below."
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="flex gap-1" aria-hidden>
                          {[1, 2, 3].map((i) => (
                            <span
                              key={i}
                              className={`h-1.5 w-8 rounded-full ${strength.level >= i ? strength.bar : "bg-sf-3"}`}
                            />
                          ))}
                        </span>
                        {strength.label}
                      </span>
                    )
                  }
                />
              </>
            )}
            {mode !== "signin" && (
              <div className="flex flex-col gap-2">
                <span id="signup-picture" className="text-small font-semibold text-ink-2">Pick a picture (optional)</span>
                <AvatarPicker value={avatar} onChange={setAvatar} labelledBy="signup-picture" />
              </div>
            )}
          </div>

          <Button type="submit" variant="act" block icon={offline ? "refresh" : undefined} className="h-[58px] text-lg">
            {offline ? "Try again" : mode === "signin" ? "Sign in" : mode === "guest" ? "Play" : "Create account"}
          </Button>

          <div className="flex flex-col gap-2">
            {mode !== "signin" && (
              <button type="button" className="text-small font-semibold text-ink-2 underline" onClick={() => switchTo("signin")}>
                Already have an account? Sign in
              </button>
            )}
            {mode !== "new" && (
              <button type="button" className="text-small font-semibold text-ink-2 underline" onClick={() => switchTo("new")}>
                New here? Create an account
              </button>
            )}
            {mode !== "guest" && (
              <button type="button" className="text-small font-semibold text-ink-2 underline" onClick={() => switchTo("guest")}>
                Just play as a guest
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5 text-small text-ink-2">
            <Icon3D name="idcard" size={28} />
            <span>We create your profile ID for you. No wallet needed.</span>
          </div>
        </form>
      </div>
      {!offline && <GebetaPreview />}
    </div>
  );
}

type Mode = "new" | "guest" | "signin";

const PASSWORD_MIN = 8;

function passwordStrength(pw: string): { level: number; label: string; bar: string } {
  if (!pw) return { level: 0, label: `${PASSWORD_MIN}+ characters`, bar: "" };
  if (pw.length < PASSWORD_MIN) return { level: 1, label: `${PASSWORD_MIN - pw.length} more to go`, bar: "bg-mismatch" };
  const mixed = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  return pw.length >= 12 || mixed >= 3
    ? { level: 3, label: "Strong", bar: "bg-recorded" }
    : { level: 2, label: "Good enough", bar: "bg-recorded" };
}

/** Wrong username and wrong password stay one message on purpose; add a nudge for guests. */
function signInMessage(err: ApiError) {
  return err.status === 401 || err.status === 404 ? "Wrong username or password. Guests have no password." : err.message;
}

const PLATES: { icon: Icon3DName; box: string; plate: number; img: number }[] = [
  { icon: "trophy", box: "left-1/2 top-11 -ml-[80px]", plate: 160, img: 118 },
  { icon: "vault", box: "left-[22px] top-[110px]", plate: 104, img: 72 },
  { icon: "mancala", box: "right-[18px] top-[86px]", plate: 112, img: 86 },
  { icon: "token", box: "right-[70px] top-3.5", plate: 64, img: 44 },
];

function Hero({ offline }: { offline: boolean }) {
  if (offline) {
    return (
      <div className="relative mx-auto h-[220px] w-full max-w-[375px] md:h-[300px]">
        <Plate icon="satellite" box="left-1/2 top-[30px] -ml-[85px]" plate={170} img={120} />
      </div>
    );
  }
  return (
    <div className="relative mx-auto h-[250px] w-full max-w-[375px] md:h-[300px] md:origin-center md:scale-125">
      {PLATES.map((p, i) => (
        <Plate key={p.icon} {...p} className={i % 2 ? "animate-bob" : ""} />
      ))}
    </div>
  );
}

function Plate({
  icon,
  box,
  plate,
  img,
  className = "",
}: {
  icon: Icon3DName;
  box: string;
  plate: number;
  img: number;
  className?: string;
}) {
  return (
    <div
      className={`plate absolute flex items-center justify-center rounded-full ${box} ${className}`}
      style={{ width: plate, height: plate }}
    >
      <Icon3D name={icon} size={img} />
    </div>
  );
}

/** Shown while the server creates the profile ID. */
function Creating({ name }: { name: string }) {
  return (
    <div
      role="status"
      className="relative -mx-4 -mt-6 flex min-h-[calc(100dvh-60px)] flex-col items-center justify-center gap-[22px] p-8 text-center md:-mx-6"
    >
      <div className="dither h-[440px]" />
      <div className="plate relative flex h-[120px] w-[120px] items-center justify-center rounded-[38px]">
        <Icon3D name="idcard" size={96} className="animate-bob" />
      </div>
      <div className="relative flex flex-col items-center gap-1.5">
        <h2 className="text-[28px] font-semibold leading-[1.02] tracking-[-.045em]">Creating your profile ID</h2>
        <span className="text-ink-2">Held by Battle Arena for you, {name}.</span>
      </div>
      <div className="relative h-[54px] w-full max-w-[300px] overflow-hidden rounded-[18px] bg-sf" aria-hidden>
        <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-sf-3 to-transparent" />
      </div>
      <span className="chip relative">
        <span className="spin" aria-hidden />
        No wallet, no seed phrase
      </span>
    </div>
  );
}
