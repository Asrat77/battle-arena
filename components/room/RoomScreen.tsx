"use client";

// A private room at /r/<code>: the code is the hero while you wait, then two
// seats with Ready toggles. Once both are ready the server counts 3-2-1 (either
// player can un-ready to stop it) and starts the match; a short versus moment
// plays and the match screen takes over. Signed out, the link lands on signup
// and joins once you have a name. A third visitor finds the room full and can
// watch the match from there once it starts.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Signup } from "@/components/home/Signup";
import { Versus } from "@/components/queue/Versus";
import { Avatar3D } from "@/components/ui/Avatar3D";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Icon3D, type Icon3DName } from "@/components/ui/Icon3D";
import { Dialog } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { api, type RoomState } from "@/lib/api";
import { useSession } from "@/lib/session";
import { InviteSheet, useFriends } from "./InviteSheet";
import { RoomChat } from "./RoomChat";
import { useRoom } from "./useRoom";

const MATCHED_HOLD_MS = 1200;

const REASONS: Record<string, { icon: Icon3DName; title: string; body: string; retry?: boolean }> = {
  "no room with that code": {
    icon: "magnifier",
    title: "No room with that code",
    body: "It may have closed when everyone left. Check the letters with whoever sent it.",
  },
  timeout: {
    icon: "satellite",
    title: "Couldn’t reach the room",
    body: "The server didn’t answer. Nothing was recorded.",
    retry: true,
  },
};

export function RoomScreen({ code }: { code: string }) {
  const { ready, profile } = useSession();
  if (!ready) return <Frame />;
  if (!profile) return <Signup />;
  return <Room code={code} me={profile.id} />;
}

function Room({ code, me }: { code: string; me: string }) {
  const router = useRouter();
  const toast = useToast();
  const { phase, busy, setReady, leave, retry } = useRoom(code);
  const [leaving, setLeaving] = useState(false);
  const [inviting, setInviting] = useState(false);
  const friends = useFriends();
  const room = phase.kind === "in" ? phase.room : null;
  const matchId = room?.state === "playing" ? room.matchId : null;

  useOpponentLeft(room, me, (name) =>
    toast.show({ icon: "whiteflag", body: `${name} left the room. The seat is open again.` }),
  );

  useEffect(() => {
    if (!matchId) return;
    const t = setTimeout(() => router.push(`/match/${matchId}`), MATCHED_HOLD_MS);
    return () => clearTimeout(t);
  }, [matchId, router]);

  if (phase.kind === "error" && phase.reason === "room is full") return <FullRoom code={code} />;

  if (phase.kind === "error") {
    const r = REASONS[phase.reason] ?? { icon: "warning", title: "Couldn’t join the room", body: phase.reason, retry: true };
    return (
      <Frame>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center" role="alert">
          <div className="plate flex h-[170px] w-[170px] items-center justify-center rounded-[56px]">
            <Icon3D name={r.icon} size={120} />
          </div>
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-h2">{r.title}</h1>
            <p className="max-w-[300px] text-ink-2">{r.body}</p>
          </div>
          <div className="flex w-full max-w-[360px] flex-col gap-2">
            {r.retry ? (
              <Button variant="act" block icon="refresh" onClick={retry}>
                Try again
              </Button>
            ) : (
              <ButtonLink href="/r" variant="act" block icon="key">
                Enter another code
              </ButtonLink>
            )}
            <ButtonLink href="/" variant="ghost" block>
              Back home
            </ButtonLink>
          </div>
        </div>
      </Frame>
    );
  }

  if (!room) {
    return (
      <Frame>
        <div className="flex flex-1 items-center justify-center" role="status">
          <span className="spin h-6 w-6 text-ink-2" aria-label="Joining the room" />
        </div>
      </Frame>
    );
  }

  const you = room.members.find((m) => m.profileId === me);
  const them = room.members.find((m) => m.profileId !== me);
  const theirName = them?.name ?? "Player 2";

  if (matchId && you) {
    return (
      <Frame>
        <Versus
          gameName={`Private room · ${room.gameName}`}
          you={{ id: me, name: you.name ?? "You" }}
          opponent={them ? { id: them.profileId, name: theirName } : null}
        />
      </Frame>
    );
  }

  if (room.state === "countdown" && you && them) {
    return (
      <Frame>
        <Countdown
          room={room}
          you={{ id: me, name: you.name ?? "You" }}
          them={{ id: them.profileId, name: theirName }}
          busy={busy}
          onStop={() => setReady(false)}
        />
      </Frame>
    );
  }

  const quit = () => {
    leave();
    router.push("/");
  };

  return (
    <Frame>
      <div className="dither" />
      <div className="relative mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-3.5 px-4 pb-8 pt-3 md:pt-6">
        <header className="flex h-[52px] items-center gap-2.5">
          <button
            type="button"
            aria-label="Leave room"
            onClick={() => setLeaving(true)}
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-[14px] bg-sf text-[22px] leading-none"
          >
            ‹
          </button>
          <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-.02em]">
            {them ? (
              <>
                Room <span className="mono">{room.code}</span>
              </>
            ) : (
              `Private room · ${room.gameName}`
            )}
          </h1>
          {them && <CopyChip link={room.link} />}
        </header>

        {!them && (
          <CodeBox
            room={room}
            onlineFriends={friends?.filter((f) => f.status === "online").length ?? 0}
            onInvite={() => setInviting(true)}
          />
        )}

        <ul className="flex flex-col gap-2.5" aria-label="Seats">
          {you && (
            <Seat id={me} name={you.name ?? "You"} side="you" note={room.host === me ? "Host · you" : "You"} ready={you.ready}>
              {them ? (
                <Button
                  size="sm"
                  variant={you.ready ? "sec" : "act"}
                  icon={you.ready ? "check" : undefined}
                  loading={busy}
                  aria-pressed={you.ready}
                  onClick={() => setReady(!you.ready)}
                >
                  {you.ready ? "Ready" : "I’m ready"}
                </Button>
              ) : (
                <Chip>Not ready</Chip>
              )}
            </Seat>
          )}
          {them ? (
            <Seat
              id={them.profileId}
              name={theirName}
              side="opp"
              note={them.online ? "Online" : "Offline"}
              online={them.online}
              ready={them.ready}
            >
              <Chip tone={them.ready ? "rec" : "neutral"}>{them.ready ? "Ready" : "Not ready yet"}</Chip>
            </Seat>
          ) : (
            <li className="flex items-center gap-3 rounded-card border-2 border-dashed border-line p-3.5">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[15px] bg-sf-2">
                <Icon3D name="hourglass" size={28} className="animate-bob" />
              </span>
              <div className="min-w-0 flex-1">
                <b className="font-semibold">Waiting for player 2</b>
                <div className="text-small text-ink-2">Anyone with the link can sit here</div>
              </div>
            </li>
          )}
        </ul>

        {them && you && <StatusLine youReady={you.ready} themReady={them.ready} theirName={theirName} />}

        <RoomChat code={room.code} me={me} />
      </div>

      <InviteSheet open={inviting && !them} onClose={() => setInviting(false)} code={room.code} friends={friends} />

      <Dialog
        open={leaving}
        onClose={() => setLeaving(false)}
        icon="whiteflag"
        title={`Leave room ${room.code}?`}
        actions={
          <>
            <Button onClick={() => setLeaving(false)}>Stay</Button>
            <Button variant="bad" onClick={quit}>
              Leave room
            </Button>
          </>
        }
      >
        {them ? `Your seat opens up and ${theirName} stays in the room.` : "The code stops working once you leave."}
      </Dialog>
    </Frame>
  );
}

const WATCH_POLL_MS = 3000;

/** Both seats taken: offer to watch, polling until their match has started. */
function FullRoom({ code }: { code: string }) {
  const [matchId, setMatchId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = () =>
      api.room(code).then(
        (r) => alive && setMatchId(r.matchId),
        () => {},
      );
    check();
    const t = setInterval(check, WATCH_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [code]);

  return (
    <Frame>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center" role="alert">
        <div className="plate flex h-[170px] w-[170px] items-center justify-center rounded-[56px]">
          <Icon3D name={matchId ? "binoculars" : "padlock"} size={120} />
        </div>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-h2">{matchId ? "Room full, watch instead?" : "Room full"}</h1>
          <p className="max-w-[300px] text-ink-2">
            {matchId
              ? "Two players are already playing here. You can watch live and chat with them."
              : "Two players are already sitting here. You can watch once their match starts."}
          </p>
        </div>
        <div className="flex w-full max-w-[360px] flex-col gap-2">
          {matchId ? (
            <ButtonLink href={`/match/${matchId}`} variant="act" block icon="binoculars">
              Watch the match
            </ButtonLink>
          ) : (
            <ButtonLink href="/r" variant="act" block icon="key">
              Enter another code
            </ButtonLink>
          )}
          <ButtonLink href="/" variant="ghost" block>
            Back home
          </ButtonLink>
        </div>
      </div>
    </Frame>
  );
}

/** Both ready: a big 3-2-1 from the server's countdown, with a way to stop it. */
function Countdown({
  room,
  you,
  them,
  busy,
  onStop,
}: {
  room: RoomState;
  you: { id: string; name: string };
  them: { id: string; name: string };
  busy: boolean;
  onStop: () => void;
}) {
  const secs = useSecondsLeft(room.countdownMs);
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-[18px] p-6 text-center">
      <div className="dither" />
      <span className="eyebrow relative">Private room · {room.gameName}</span>
      <div className="relative flex items-center gap-4">
        <CountdownSeat id={you.id} name={you.name} seat="you" />
        <Icon3D name="vs" size={72} label="Versus" />
        <CountdownSeat id={them.id} name={them.name} seat="opp" />
      </div>
      <span
        key={secs}
        role="timer"
        aria-live="assertive"
        aria-label={`Starting in ${secs}`}
        className="mono relative animate-callout text-[150px] font-semibold leading-none tracking-[-.06em] text-accent [text-shadow:0_20px_50px_rgb(243_181_66/.35)] motion-reduce:animate-none"
      >
        {secs}
      </span>
      <span className="relative text-small text-ink-2">Either player can still un-ready to stop it.</span>
      <Button variant="sec" className="relative" loading={busy} onClick={onStop}>
        Not ready
      </Button>
    </div>
  );
}

function CountdownSeat({ id, name, seat }: { id: string; name: string; seat: "you" | "opp" }) {
  return (
    <div className="flex w-[96px] flex-col items-center gap-1.5">
      <Avatar3D id={id} size="lg" seat={seat} />
      <b className="max-w-full truncate font-semibold">{name}</b>
      <Chip tone="rec">Ready</Chip>
    </div>
  );
}

/** Whole seconds left (3, 2, 1), counted down locally from the server's remaining time. */
function useSecondsLeft(ms: number | null): number {
  const [left, setLeft] = useState(ms ?? 0);
  useEffect(() => {
    if (ms == null) return;
    const end = Date.now() + ms;
    setLeft(ms);
    const t = setInterval(() => setLeft(Math.max(0, end - Date.now())), 100);
    return () => clearInterval(t);
  }, [ms]);
  return Math.max(1, Math.ceil(left / 1000));
}

function CodeBox({ room, onlineFriends, onInvite }: { room: RoomState; onlineFriends: number; onInvite: () => void }) {
  const toast = useToast();
  const url = useAbsolute(room.link);
  const share = async () => {
    const text = `Play ${room.gameName} with me in Battle Arena. Room code ${room.code}.`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Battle Arena room", text, url });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    copy(url, toast);
  };
  return (
    <section
      aria-label="Room code"
      className="relative flex flex-col items-center gap-3 overflow-hidden rounded-sheet bg-sf px-4 pb-5 pt-6 text-center [.light_&]:shadow-[0_0_0_1px_rgb(var(--ln))]"
    >
      <div className="dither h-[180px]" />
      <span className="eyebrow relative">Room code</span>
      <span
        className="mono relative select-all text-[56px] font-semibold leading-none tracking-[.12em] md:text-[68px]"
        aria-label={room.code.split("").join(" ")}
      >
        {room.code}
      </span>
      <span className="relative text-small text-ink-2">Send the link, or read the code out loud.</span>
      <div className="relative flex flex-wrap justify-center gap-2">
        <Button size="sm" variant="act" icon="share" onClick={share}>
          Share link
        </Button>
        <Button size="sm" icon="link" onClick={() => copy(url, toast)}>
          Copy
        </Button>
        <Button size="sm" icon="handshake" onClick={onInvite}>
          {onlineFriends ? `Invite · ${onlineFriends}` : "Invite"}
        </Button>
      </div>
    </section>
  );
}

function CopyChip({ link }: { link: string }) {
  const toast = useToast();
  const url = useAbsolute(link);
  return (
    <button type="button" className="chip" onClick={() => copy(url, toast)}>
      <Icon3D name="link" size={18} />
      Copy link
    </button>
  );
}

function Seat({
  id,
  name,
  side,
  note,
  online = true,
  ready,
  children,
}: {
  id: string;
  name: string;
  side: "you" | "opp";
  note: string;
  online?: boolean;
  ready: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-card p-3.5 transition-colors ${
        ready ? "bg-recorded-soft" : "bg-sf [.light_&]:shadow-[0_0_0_1px_rgb(var(--ln))]"
      }`}
    >
      <Avatar3D id={id} seat={side} className={online ? "" : "opacity-60"} />
      <div className="min-w-0 flex-1">
        <b className="block truncate font-semibold">{name}</b>
        <div className={`flex items-center gap-1.5 text-small ${side === "you" ? "text-ink-2" : online ? "text-recorded" : "text-ink-3"}`}>
          {side === "opp" && (
            <i className="block h-2 w-2 rounded-full" style={{ background: online ? "rgb(var(--rec))" : "rgb(var(--ink3))" }} aria-hidden />
          )}
          {note}
        </div>
      </div>
      {children}
    </li>
  );
}

function StatusLine({ youReady, themReady, theirName }: { youReady: boolean; themReady: boolean; theirName: string }) {
  const text = youReady
    ? `Starts as soon as ${theirName} is ready`
    : themReady
      ? `${theirName} is ready. Tap I’m ready to start.`
      : "The match starts once you’re both ready";
  return (
    <p
      aria-live="polite"
      className={`flex items-center gap-2.5 rounded-2xl px-3.5 py-3 text-small font-semibold ${
        youReady || themReady ? "bg-pending-soft text-pending" : "bg-sf-2 text-ink-2"
      }`}
    >
      <Icon3D name="hourglass" size={22} />
      {text}
    </p>
  );
}

/** Fills the viewport under the (desktop-only) top bar; no dock on this flow. */
function Frame({ children }: { children?: React.ReactNode }) {
  return (
    <div className="relative -mx-4 -mb-8 -mt-6 flex min-h-[100dvh] flex-col overflow-hidden md:mx-0 md:mb-0 md:mt-0 md:min-h-[calc(100dvh-140px)] md:rounded-sheet">
      {children}
    </div>
  );
}

/** Calls back with the other player's name when they leave the room. */
function useOpponentLeft(room: RoomState | null, me: string, onLeft: (name: string) => void) {
  const prev = useRef<RoomState["members"] | null>(null);
  const cb = useRef(onLeft);
  cb.current = onLeft;
  useEffect(() => {
    if (!room) return;
    const before = prev.current;
    prev.current = room.members;
    if (!before) return;
    for (const m of before) {
      if (m.profileId !== me && !room.members.some((x) => x.profileId === m.profileId)) cb.current(m.name ?? "The other player");
    }
  }, [room, me]);
}

function useAbsolute(path: string): string {
  const [url, setUrl] = useState(path);
  useEffect(() => setUrl(new URL(path, window.location.origin).toString()), [path]);
  return url;
}

function copy(url: string, toast: ReturnType<typeof useToast>) {
  // Without clipboard access (http on a LAN IP, a denied prompt) show the link to copy by hand.
  const manual = () => toast.show({ icon: "link", body: <span className="mono select-all break-all">{url}</span>, duration: 0 });
  if (!navigator.clipboard) return manual();
  navigator.clipboard.writeText(url).then(() => toast.show({ icon: "link", body: "Room link copied" }), manual);
}
