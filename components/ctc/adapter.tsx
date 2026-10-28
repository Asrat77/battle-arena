"use client";

// Crack the Code inside MatchFrame: the secret setup, the guessing rounds and
// the round history, plus the status line and clock the frame shows. The
// moments (commit notice, illegal-move shake, end reveal) are in moments.tsx.

import { useMemo, useState } from "react";
import type { GameAdapter, MatchCommit, MoveError, ReplayStepProps } from "@/components/match/adapter";
import { Chip } from "@/components/ui/Chip";
import { Icon3D } from "@/components/ui/Icon3D";
import { MAX_ROUNDS, ROUND_MS, SETUP_MS, type CtcMove, type CtcState, type CtcView } from "@/engine/games/crackTheCode";
import { getGame } from "@/engine/registry";
import { initial, step } from "@/engine/replay";
import type { GameDef, Seat, Viewer } from "@/engine/types";
import { CodeSlots } from "./CodeSlots";
import { Keypad } from "./Keypad";
import { COMMIT_MS, CommitMoment, IllegalReason, Shake, useHeld, useIllegal } from "./moments";
import { RoundHistory } from "./RoundHistory";

type BoardProps = {
  view: CtcView;
  seat: Viewer;
  onMove(m: CtcMove): void;
  disabled: boolean;
  names: [string, string];
  commit?: MatchCommit | null;
  error?: MoveError | null;
};

const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

function Board(props: BoardProps) {
  // Only a commit seen live gets the notice; one that lands after the end does not.
  const live = props.view.phase !== "over" && !props.disabled;
  const moment = useHeld(live ? (props.commit ?? null) : null, COMMIT_MS);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Play {...props} />
      {moment && <CommitMoment commit={moment} />}
    </div>
  );
}

function Play({ view, seat, onMove, disabled, names, error }: BoardProps) {
  const playing = seat !== "spectator" && view.phase !== "over" && !disabled;
  const opp = names[seat === "spectator" ? 1 : other(seat)];

  if (playing && view.phase === "setup") {
    return view.submitted[seat] ? (
      <Locked opp={opp} oppDone={view.submitted[other(seat)]} />
    ) : (
      <SecretEntry error={error} onLock={(code) => onMove({ type: "secret", code })} />
    );
  }

  const live = view.phase === "rounds" && !disabled;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {view.secrets ? (
        <Secrets secrets={view.secrets} seat={seat} names={names} />
      ) : (
        <div className="flex items-center justify-between gap-2">
          {seat !== "spectator" && view.mySecret ? (
            <MySecret code={view.mySecret} />
          ) : (
            seat === "spectator" && !disabled && <SpectatorSecrets setup={view.phase === "setup"} />
          )}
          {view.round > 0 && (
            <span className="eyebrow">
              Round {view.round} of {MAX_ROUNDS}
            </span>
          )}
        </div>
      )}
      <RoundHistory
        history={view.history}
        seat={seat}
        names={names}
        current={live ? { round: view.round, mine: view.myPending, submitted: view.submitted } : null}
      />
      <div className="flex-1" />
      {playing && view.phase === "rounds" && (
        <GuessEntry
          key={view.round}
          round={view.round}
          pending={view.myPending}
          opp={opp}
          error={error}
          onGuess={(code) => onMove({ type: "guess", code })}
        />
      )}
    </div>
  );
}

function SecretEntry({ error, onLock }: { error?: MoveError | null; onLock(code: string): void }) {
  const [code, setCode] = useState("");
  const [illegal, reject] = useIllegal(error);
  return (
    <div className="flex flex-1 flex-col gap-4 pb-2">
      <div className="mt-2 flex items-center gap-3.5">
        <Icon3D name="vault" size={72} />
        <div className="flex flex-col gap-0.5">
          <b className="text-[20px] font-semibold tracking-[-.03em]">Your secret code</b>
          <span className="text-sm text-ink-3">4 different digits, 1–9. Hidden until the end.</span>
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex flex-col gap-2">
        <Shake illegal={illegal}>
          <CodeSlots value={code} invalid={Boolean(illegal)} label="Your secret" />
        </Shake>
        <IllegalReason illegal={illegal} />
      </div>
      <div className="flex-1" />
      <Keypad value={code} onChange={setCode} onSubmit={onLock} onInvalid={reject} submitLabel="Lock in" />
    </div>
  );
}

function Locked({ opp, oppDone }: { opp: string; oppDone: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" data-testid="secret-locked">
      <div className="plate flex h-[150px] w-[150px] items-center justify-center rounded-full">
        <Icon3D name="padlock" size={104} />
      </div>
      <h2 className="text-[26px] font-semibold tracking-[-.03em]">Secret locked</h2>
      <div className="w-full max-w-[360px]">
        <CodeSlots value="" masked label="Your secret" />
      </div>
      <Chip spin={!oppDone}>{oppDone ? `${opp} is locked in too` : `${opp} is setting their secret`}</Chip>
    </div>
  );
}

/** The viewer's secret, hidden until tapped. */
function MySecret({ code }: { code: string }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setShown((s) => !s)}
      aria-pressed={shown}
      aria-label={shown ? `Your secret ${code.split("").join(" ")}. Tap to hide` : "Your secret is hidden. Tap to show"}
      className="chip bg-you-soft text-you"
    >
      <Icon3D name={shown ? "openlock" : "padlock"} size={18} />
      Your secret <span className="mono text-[13px] tracking-[.12em]">{shown ? code : "••••"}</span>
    </button>
  );
}

function SpectatorSecrets({ setup }: { setup: boolean }) {
  return (
    <Chip icon="padlock">
      {setup ? "Players are setting secrets" : "Secrets stay hidden until the end"}
    </Chip>
  );
}

/** Both secrets once the match is over, flipping open 120 ms apart. */
function Secrets({ secrets, seat, names }: { secrets: [string | null, string | null]; seat: Viewer; names: [string, string] }) {
  const left: Seat = seat === "spectator" ? 0 : seat;
  const cards = [left, other(left)].map((s, i) => ({
    s,
    label: seat === s ? "Your secret" : `${names[s]}’s secret`,
    tone: i === 0 ? "text-you shadow-[inset_0_0_0_1.5px_rgb(var(--you))]" : "text-opp shadow-[inset_0_0_0_1.5px_rgb(var(--opp))]",
  }));
  return (
    <div className="grid grid-cols-2 gap-2.5" data-testid="secrets">
      {cards.map(({ s, label, tone }, i) => (
        <div key={s} className={`card animate-flip px-3.5 py-3 ${tone}`} style={{ animationDelay: `${i * 120}ms` }}>
          <span className="block truncate text-sm text-ink-3">{label}</span>
          <span className="mono text-[26px] font-semibold tracking-[.12em]">{secrets[s] ?? "none"}</span>
        </div>
      ))}
    </div>
  );
}

function GuessEntry({
  round,
  pending,
  opp,
  error,
  onGuess,
}: {
  round: number;
  pending: string | null;
  opp: string;
  error?: MoveError | null;
  onGuess(code: string): void;
}) {
  const [code, setCode] = useState("");
  const [illegal, reject] = useIllegal(error);
  if (pending)
    return (
      <div className="card flex flex-col items-start gap-2 px-3.5 py-3" data-testid="guess-pending">
        <span className="text-sm text-ink-3">Your guess · round {round}</span>
        <span className="mono text-[26px] font-semibold tracking-[.12em] text-you">{pending}</span>
        <Chip spin className="max-w-full">
          <span className="truncate">Round closes when {opp} guesses</span>
        </Chip>
      </div>
    );
  return (
    <div className="flex flex-col gap-2.5 pb-1">
      <Shake illegal={illegal}>
        <CodeSlots value={code} size="sm" invalid={Boolean(illegal)} label="Your guess" />
      </Shake>
      <IllegalReason illegal={illegal} />
      <Keypad value={code} onChange={setCode} onSubmit={onGuess} onInvalid={reject} submitLabel="Guess" size="sm" />
    </div>
  );
}

function status(view: CtcView, seat: Viewer, names: [string, string]): string {
  if (view.phase === "over") return "Match over";
  if (seat === "spectator") {
    if (view.phase === "setup") return "Both players are setting secrets";
    return `Round ${view.round} · both guessing`;
  }
  const opp = names[other(seat)];
  const mine = view.submitted[seat];
  const theirs = view.submitted[other(seat)];
  if (view.phase === "setup") return mine ? `Waiting for ${opp}` : "Set your secret";
  if (mine) return `Waiting for ${opp}’s guess`;
  return theirs ? `${opp} guessed · your turn` : `Round ${view.round} · your guess`;
}

function seatState(view: CtcView, s: Seat): string {
  if (view.phase === "setup") return view.submitted[s] ? "Locked" : "Setting secret";
  if (view.phase === "rounds") return view.submitted[s] ? "Guessed" : "Thinking";
  return "";
}

/** The match as it stood after `step` log entries, replayed with the game's own rules. */
function ReplayStep({ log, step: at, seed, names }: ReplayStepProps) {
  const cur = useMemo(() => {
    const game = getGame("crack-the-code") as GameDef<CtcState, unknown, unknown>;
    let m = initial(game, seed);
    try {
      for (let i = 0; i < at; i++) m = step(game, seed, m, log[i], i);
      return { ...m, error: null };
    } catch (err) {
      return { ...m, error: (err as Error).message };
    }
  }, [log, at, seed]);

  const s = cur.state;
  const phase =
    s.phase === "setup" ? "Setting secrets" : s.phase === "rounds" ? `Round ${s.round}` : "Match over";
  return (
    <div className="flex flex-col gap-2.5" data-testid="replay-step">
      <div className="flex items-center gap-2">
        <ReplaySecret code={s.secrets[0]} name={names[0]} tone="you" />
        <span className="eyebrow min-w-0 flex-1 truncate text-center">{phase}</span>
        <ReplaySecret code={s.secrets[1]} name={names[1]} tone="opp" />
      </div>
      {s.history.length > 0 || s.pending.some(Boolean) ? (
        <RoundHistory
          history={s.history}
          seat="spectator"
          names={names}
          follow={false}
          current={s.phase === "rounds" && s.pending.some(Boolean) ? { round: s.round, mine: null, submitted: [!!s.pending[0], !!s.pending[1]] } : null}
        />
      ) : (
        <div className="card flex items-center gap-3 text-small text-ink-3">
          <Icon3D name="padlock" size={32} />
          {at === 0 ? "Match starts. Both players pick a secret." : "Secrets are fixed and committed to the ledger before round 1."}
        </div>
      )}
      {cur.error && (
        <p className="text-small text-mismatch" role="alert">
          The log stops replaying here: {cur.error}
        </p>
      )}
    </div>
  );
}

/** A revealed secret in a replay. Codes are public once the match is over. */
function ReplaySecret({ code, name, tone }: { code: string | null; name: string; tone: "you" | "opp" }) {
  return (
    <span className={`chip max-w-[45%] ${tone === "you" ? "bg-you-soft text-you" : "bg-opp-soft text-opp"}`}>
      <Icon3D name={code ? "openlock" : "padlock"} size={18} />
      <span className="truncate">{name}</span>
      <span className="mono text-[13px] tracking-[.12em]">{code ?? "····"}</span>
    </span>
  );
}

export const ctcAdapter: GameAdapter<CtcView, CtcMove> = {
  id: "crack-the-code",
  icon: "vault",
  Board,
  status,
  seatState,
  timer: (view) => ({ total: view.phase === "setup" ? SETUP_MS : ROUND_MS, owner: "both" }),
  ReplayStep,
  describeMove: (m) => (m.type === "secret" ? "locks a secret" : `guesses ${m.code}`),
  rules: {
    title: "Crack the Code",
    art: "vault",
    lines: [
      "Each player sets a secret of 4 different digits from 1 to 9.",
      "Every round you both guess the other's code at the same time, within 45 seconds.",
      "Saffron cells are digits in the right spot. Grey cells are digits in the code but in another spot.",
      "First to put all 4 in the right spot wins. Both in the same round is a draw, and so is reaching round 30.",
      "A fingerprint of both secrets goes on the ledger before the first guess, so neither can change.",
    ],
  },
  hasHiddenInfo: true,
  showsErrors: true,
};
