"use client";

import { useMemo, useState } from "react";
import type { GameAdapter, ReplayStepProps } from "@/components/match/adapter";
import { dotsAndBoxes, rules, TURN_MS, type DotsMove, type DotsView } from "@/engine/games/dotsAndBoxes";
import { replay } from "@/engine/replay";
import { GAME_ICONS } from "@/lib/gameCatalog";
import { DotsBoard } from "./DotsBoard";
import { edgeLabel } from "./geometry";

const LiveBoard: GameAdapter<DotsView, DotsMove>["Board"] = ({ view, seat, names, onMove, disabled, error }) => {
  // A second click cannot submit a second move while the server acknowledges the first.
  const [sent, setSent] = useState<{ view: DotsView; error: unknown } | null>(null);
  const pending = sent?.view === view && sent?.error === error;
  return <DotsBoard view={view} seat={seat} names={names} disabled={disabled || pending} onMove={(edge) => {
    setSent({ view, error });
    onMove({ edge });
  }} />;
};

function ReplayStep({ log, step, seed, names }: ReplayStepProps) {
  const result = useMemo(() => {
    try { return { view: replay(dotsAndBoxes, seed, log.slice(0, step)).state as DotsView, error: null }; }
    catch (err) { return { view: null, error: (err as Error).message }; }
  }, [log, step, seed]);
  return <div data-testid="replay-step">{result.view && <DotsBoard view={result.view} seat="spectator" names={names} disabled />}
    {result.error && <p role="alert" className="text-small text-mismatch">The log stops replaying here: {result.error}</p>}</div>;
}

export const dotsAdapter: GameAdapter<DotsView, DotsMove> = {
  id: "dots-and-boxes", icon: GAME_ICONS["dots-and-boxes"], Board: LiveBoard, ReplayStep,
  status(view, seat, names) {
    if (view.moves === 60) return "Match over";
    const last = view.last;
    if (last?.captured.length) {
      const boxes = `${last.captured.length} ${last.captured.length === 1 ? "box" : "boxes"}`;
      return `${last.seat === seat ? "You claimed" : `${names[last.seat]} claimed`} ${boxes} · go again`;
    }
    return view.turn === seat ? "Your turn · draw a line" : `${names[view.turn]} is drawing a line`;
  },
  timer: (view) => ({ total: TURN_MS, owner: view.turn }),
  describeMove: (m) => `draws ${edgeLabel(m.edge).toLowerCase()}`,
  rules: { title: "Dots and Boxes", art: GAME_ICONS["dots-and-boxes"], lines: rules },
  hasHiddenInfo: false,
};
