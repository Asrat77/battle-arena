"use client";

import type { CtcView } from "@/engine/games/crackTheCode";
import type { Viewer } from "@/engine/types";
import { CodeInput } from "./CodeInput";
import { CtcRounds } from "./CtcRounds";

interface Props {
  view: CtcView;
  seat: Viewer;
  labels: [string, string];
  onMove(move: { type: "secret" | "guess"; code: string }): void;
}

export function CtcPlay({ view, seat, labels, onMove }: Props) {
  const playing = seat !== "spectator" && view.phase !== "over";
  const mineDone = seat !== "spectator" && view.submitted[seat];

  return (
    <div className="space-y-4">
      {seat !== "spectator" && (
        <p className="text-sm">
          Your secret: <span className="font-mono text-lg">{view.mySecret ?? "not set"}</span>
        </p>
      )}

      {playing && view.phase === "setup" && !mineDone && (
        <div className="space-y-1">
          <p className="text-sm">Pick a secret code: 4 different digits from 1 to 9.</p>
          <CodeInput label="Lock secret" onSubmit={(code) => onMove({ type: "secret", code })} />
        </div>
      )}
      {playing && view.phase === "rounds" && !mineDone && (
        <div className="space-y-1">
          <p className="text-sm">Round {view.round}: guess your opponent&apos;s code.</p>
          <CodeInput label="Guess" onSubmit={(code) => onMove({ type: "guess", code })} />
        </div>
      )}
      {playing && mineDone && (
        <p className="text-sm text-gray-600">
          {view.myPending ? `Guessed ${view.myPending}. ` : ""}Waiting for the opponent…
        </p>
      )}

      <CtcRounds history={view.history} labels={labels} />
    </div>
  );
}
