"use client";

// First visit: a 3D hero and one name field. Signing up creates the profile ID
// on the server (no wallet) and Home takes over once the session has a profile.
// Below it, a self-playing Gebeta round shows what you're signing up for.

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { GebetaPreview } from "./GebetaPreview";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";

const NAME_MAX = 20;

type Phase = "edit" | "busy" | "offline";

function nameError(name: string): string | null {
  const n = name.trim().length;
  return n > NAME_MAX ? `That’s ${n} characters. Keep it to ${NAME_MAX}.` : null;
}

export function Signup() {
  const { signup, signIn } = useSession();
  const toast = useToast();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"new" | "signin">("new");
  // Optional on signup: a username and password make the profile survive sign-out.
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState<string | null>(null);
  // Bumped on each failed submit so the field shakes again.
  const [shakes, setShakes] = useState(0);
  const field = useRef<HTMLDivElement>(null);

  const live = nameError(name);
  const shown = error ?? live;
  const count = name.trim().length;

  const fail = (msg: string) => {
    setError(msg);
    setShakes((s) => s + 1);
    field.current?.querySelector("input")?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    const signingIn = mode === "signin";
    if (!signingIn) {
      if (!trimmed) return fail("Type a name to play.");
      if (live) return fail(live);
    }
    if ((signingIn || secure) && (!username.trim() || !password)) return fail("Enter a username and password.");
    setPhase("busy");
    setError(null);
    try {
      if (signingIn) {
        await signIn({ username, password });
        toast.show({
          icon: "idcard",
          body: <>Welcome back, {username.trim().toLowerCase()}.</>,
          href: "/profile",
        });
        return;
      }
      await signup(trimmed, secure ? { username, password } : undefined);
      toast.show({
        icon: "idcard",
        body: (
          <>
            Welcome, {trimmed}. {secure ? "Your account is saved." : "Your profile ID is ready."}
          </>
        ),
        href: "/profile",
      });
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        setPhase("edit");
        fail(err.message);
      } else {
        setPhase("offline");
      }
    }
  };

  if (phase === "busy") return <Creating name={mode === "signin" ? username.trim() : name.trim()} />;

  const offline = phase === "offline";

  return (
    <div className="relative -mx-4 -mt-6 min-h-[calc(100dvh-60px)] px-4 pt-2 md:-mx-6 md:px-6 md:pt-14">
      <div className={`dither ${offline ? "grayscale" : ""}`} />
      <div className="relative mx-auto grid max-w-[960px] items-center md:grid-cols-2 md:gap-12">
        <Hero offline={offline} />
        <form onSubmit={submit} noValidate className="flex flex-col gap-[18px] px-1.5 pb-6 md:px-0">
          {offline ? (
            <div role="alert" className="flex items-center gap-3 rounded-[20px] bg-mismatch-soft p-3.5">
              <Icon3D name="warning" size={36} />
              <div className="flex flex-col gap-0.5">
                <b className="font-semibold text-mismatch">Can’t reach Battle Arena</b>
                <span className="text-small">Your name is kept. Check your connection and try again.</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <span className="eyebrow">Battle Arena · live 1v1</span>
              <h1 className="text-h1">
                Pick a name.
                <br />
                Play in a minute.
              </h1>
              <p className="m-0 text-base text-ink-2">
                Crack the Code and Gebeta, head to head. Every result is recorded so anyone can check it.
              </p>
            </div>
          )}

          <div ref={field} key={shakes} className={`flex flex-col gap-3.5 ${shakes ? "animate-shake" : ""}`}>
            {mode === "signin" ? (
              <>
                <Field
                  label="Username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError(null);
                  }}
                />
                <Field
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  error={error}
                />
              </>
            ) : (
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
                error={shown}
                hint={<span className="font-semibold">{count ? `${count} / ${NAME_MAX}` : `1–${NAME_MAX} characters`}</span>}
              />
            )}
            {mode === "new" && (
              <>
                <label className="flex items-center gap-2.5 text-small text-ink-2">
                  <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
                  Save my account with a password, so I can sign in on any device
                </label>
                {secure && (
                  <>
                    <Field
                      label="Username"
                      autoComplete="username"
                      autoCapitalize="none"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      hint="3–20 letters, numbers or underscores"
                    />
                    <Field
                      label="Password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      hint="At least 8 characters"
                    />
                  </>
                )}
              </>
            )}
          </div>

          <Button
            type="submit"
            variant="act"
            block
            icon={offline ? "refresh" : undefined}
            disabled={mode === "new" && (!name || Boolean(live))}
            className="h-[58px] text-lg"
          >
            {offline ? "Try again" : mode === "signin" ? "Sign in" : "Play"}
          </Button>

          <button
            type="button"
            className="text-small font-semibold text-ink-2 underline"
            onClick={() => {
              setMode(mode === "new" ? "signin" : "new");
              setError(null);
              setPhase("edit");
            }}
          >
            {mode === "new" ? "Already have an account? Sign in" : "New here? Create a profile"}
          </button>

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
