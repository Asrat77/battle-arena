// Crack the Code: each seat picks a secret of 4 distinct digits 1-9, then both
// guess the other's secret at the same time each round. Feedback per guess is
// `present` (digits of the guess that are in the secret, in any position) and
// `exact` (digits in the right position). First to 4 exact wins; both in the
// same round is a draw.

import { sha256Hex } from "../hash";
import type { GameDef, Outcome, Rng, Seat, Viewer } from "../types";

export const SETUP_MS = 60_000;
export const ROUND_MS = 45_000;
/** Rounds after which the match is a draw, so a match always ends. */
export const MAX_ROUNDS = 30;
export const CODE_LENGTH = 4;

export type CtcMove = { type: "secret"; code: string } | { type: "guess"; code: string };

export interface Guess {
  code: string;
  present: number;
  exact: number;
}

export interface Round {
  round: number;
  /** Each seat's guess at the opponent's secret, or null if they missed the round. */
  guesses: [Guess | null, Guess | null];
}

export interface CtcState {
  phase: "setup" | "rounds" | "over";
  secrets: [string | null, string | null];
  salts: [string, string];
  /** Seats that missed the setup deadline. */
  forfeited: Seat[];
  round: number;
  pending: [string | null, string | null];
  history: Round[];
}

export interface CtcView {
  phase: CtcState["phase"];
  round: number;
  /** The viewer's own secret; null for spectators and before it is set. */
  mySecret: string | null;
  /** Whether each seat has submitted for the current phase (secret or guess). */
  submitted: [boolean, boolean];
  /** The viewer's own unresolved guess this round. */
  myPending: string | null;
  history: Round[];
  /** Both secrets, only once the match is over. */
  secrets: [string | null, string | null] | null;
}

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export function isCode(code: unknown): code is string {
  return typeof code === "string" && /^[1-9]{4}$/.test(code) && new Set(code).size === CODE_LENGTH;
}

export function feedback(guess: string, secret: string): Omit<Guess, "code"> {
  let present = 0;
  let exact = 0;
  for (let i = 0; i < guess.length; i++) {
    if (secret.includes(guess[i])) present++;
    if (guess[i] === secret[i]) exact++;
  }
  return { present, exact };
}

export function commitment(secret: string, salt: string): string {
  return sha256Hex(secret + salt);
}

/** All 3024 legal codes, in ascending order. */
export const ALL_CODES: readonly string[] = (() => {
  const out: string[] = [];
  for (let n = 1234; n <= 9876; n++) if (isCode(String(n))) out.push(String(n));
  return out;
})();

function resolveRound(s: CtcState): CtcState {
  const guesses = ([0, 1] as const).map((seat) => {
    const code = s.pending[seat];
    const target = s.secrets[other(seat)];
    return code && target ? { code, ...feedback(code, target) } : null;
  }) as [Guess | null, Guess | null];
  const history = [...s.history, { round: s.round, guesses }];
  const won = guesses.some((g) => g?.exact === CODE_LENGTH);
  const over = won || s.round >= MAX_ROUNDS;
  return {
    ...s,
    history,
    pending: [null, null],
    phase: over ? "over" : "rounds",
    round: over ? s.round : s.round + 1,
  };
}

export const crackTheCode: GameDef<CtcState, CtcMove, CtcView> = {
  id: "crack-the-code",
  name: "Crack the Code",

  setup({ seed }) {
    return {
      phase: "setup",
      secrets: [null, null],
      salts: [sha256Hex(`${seed}:salt:0`), sha256Hex(`${seed}:salt:1`)],
      forfeited: [],
      round: 0,
      pending: [null, null],
      history: [],
    };
  },

  validate(s, seat, m) {
    if (typeof m !== "object" || m === null) return "move must be {type, code}";
    if (!isCode(m.code)) return "code must be 4 distinct digits 1-9";
    if (s.phase === "setup") {
      if (m.type !== "secret") return "submit your secret first";
      if (s.secrets[seat]) return "secret already set";
      return null;
    }
    if (s.phase === "rounds") {
      if (m.type !== "guess") return "secret is already set; send a guess";
      if (s.pending[seat]) return "already guessed this round";
      return null;
    }
    return "match is over";
  },

  apply(s, seat, m) {
    if (m.type === "secret") {
      const secrets: CtcState["secrets"] = [...s.secrets];
      secrets[seat] = m.code;
      const ready = secrets[0] !== null && secrets[1] !== null;
      return { ...s, secrets, phase: ready ? "rounds" : "setup", round: ready ? 1 : 0 };
    }
    const pending: CtcState["pending"] = [...s.pending];
    pending[seat] = m.code;
    const next = { ...s, pending };
    return pending[0] !== null && pending[1] !== null ? resolveRound(next) : next;
  },

  onTimeout(s) {
    if (s.phase === "setup") {
      const forfeited = ([0, 1] as const).filter((seat) => s.secrets[seat] === null);
      return { ...s, forfeited, phase: "over" };
    }
    if (s.phase === "rounds") return resolveRound(s);
    return s;
  },

  deadlineMs(s) {
    if (s.phase === "setup") return SETUP_MS;
    if (s.phase === "rounds") return ROUND_MS;
    return null;
  },

  activeSeats(s) {
    if (s.phase === "setup") return ([0, 1] as const).filter((seat) => s.secrets[seat] === null);
    if (s.phase === "rounds") return ([0, 1] as const).filter((seat) => s.pending[seat] === null);
    return [];
  },

  outcome(s): Outcome | null {
    if (s.phase !== "over") return null;
    if (s.forfeited.length === 2) return { winner: null, draw: true, reason: "no secrets set" };
    if (s.forfeited.length === 1) return { winner: other(s.forfeited[0]), draw: false, reason: "no secret set" };
    const last = s.history[s.history.length - 1];
    const cracked = ([0, 1] as const).filter((seat) => last?.guesses[seat]?.exact === CODE_LENGTH);
    if (cracked.length === 1) return { winner: cracked[0], draw: false, reason: "cracked the code" };
    if (cracked.length === 2) return { winner: null, draw: true, reason: "both cracked the code" };
    return { winner: null, draw: true, reason: "round limit" };
  },

  view(s, viewer: Viewer) {
    const own = viewer === "spectator" ? null : viewer;
    const submitted: [boolean, boolean] =
      s.phase === "setup"
        ? [s.secrets[0] !== null, s.secrets[1] !== null]
        : [s.pending[0] !== null, s.pending[1] !== null];
    return {
      phase: s.phase,
      round: s.round,
      mySecret: own === null ? null : s.secrets[own],
      submitted,
      myPending: own === null ? null : s.pending[own],
      history: s.history,
      secrets: s.phase === "over" ? [s.secrets[0], s.secrets[1]] : null,
    };
  },

  commitments(s) {
    const out: Record<string, string> = {};
    for (const seat of [0, 1] as const) {
      const secret = s.secrets[seat];
      if (secret) out[String(seat)] = commitment(secret, s.salts[seat]);
    }
    return out;
  },

  reveal: (s) => ({ secrets: s.secrets, salts: s.salts }),

  bot(view, seat, rng: Rng) {
    if (view.phase === "setup") return { type: "secret", code: rng.pick(ALL_CODES) };
    const mine = view.history.map((r) => r.guesses[seat]).filter((g): g is Guess => g !== null);
    const candidates = ALL_CODES.filter((code) =>
      mine.every((g) => {
        const f = feedback(g.code, code);
        return f.present === g.present && f.exact === g.exact;
      }),
    );
    return { type: "guess", code: rng.pick(candidates.length ? candidates : ALL_CODES) };
  },
};
