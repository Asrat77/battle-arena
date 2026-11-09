// Battleship: each seat hides a fleet of four ships on its own 8×8 sea, then
// the seats take turns firing one shot at the other sea. Sink the whole enemy
// fleet first to win. Shots stay even: when seat 0 sinks the last ship, seat 1
// still gets its reply shot, and sinking the last ship with it is a draw.
//
// Fleets are hidden data, so they are committed (hash of fleet + salt) as soon
// as both are placed and revealed with their salts at the end, like a Crack the
// Code secret.

import { canonical } from "../canonical";
import { sha256Hex } from "../hash";
import type { GameDef, Outcome, Rng, Seat, Viewer } from "../types";

export const SIZE = 8;
export const CELLS = SIZE * SIZE;
export const PLACE_MS = 60_000;
export const TURN_MS = 30_000;
export const COLS = "ABCDEFGH";

export const FLEET = [
  { id: "battleship", name: "Battleship", size: 4 },
  { id: "cruiser", name: "Cruiser", size: 3 },
  { id: "submarine", name: "Submarine", size: 3 },
  { id: "destroyer", name: "Destroyer", size: 2 },
] as const;
export type ShipId = (typeof FLEET)[number]["id"];

export const rules = [
  "Each player hides four ships on their own 8×8 sea: a Battleship (4 squares), a Cruiser (3), a Submarine (3) and a Destroyer (2). Ships lie straight, across or down, and never overlap.",
  "You have 60 seconds to place your fleet. Drag a ship to move it, tap it twice to turn it, or shuffle for a new layout. If time runs out, your fleet is placed for you.",
  "Then take turns firing one shot at a square of the other sea. Fire means a hit, a splash means a miss. A ship sinks once every square it covers is hit.",
  "Sink the whole enemy fleet first to win. Shots stay even: if the first player sinks the last ship, the second player still gets a reply shot, and sinking the last ship with it makes the match a draw.",
  "Each shot has 30 seconds. On timeout a random open square is fired at for you.",
  "Both fleets are sealed on the ledger before the first shot and revealed at the end, so anyone can check that no ship was moved.",
];

/** A ship's bow (top-left square) and heading: h runs right, v runs down. */
export interface Placement {
  cell: number;
  dir: "h" | "v";
}
/** One placement per ship, in FLEET order. */
export type Fleet = Placement[];

export type BattleshipMove = { type: "place"; fleet: Fleet } | { type: "fire"; cell: number };

export interface Shot {
  cell: number;
  hit: boolean;
  /** Index into FLEET of the ship this shot sank, if it sank one. */
  sunk: number | null;
}

export interface SunkShip {
  ship: number;
  at: Placement;
}

export interface BattleshipState {
  phase: "placing" | "battle" | "over";
  fleets: [Fleet | null, Fleet | null];
  salts: [string, string];
  /** Seats whose fleet was placed for them when placement timed out. */
  auto: [boolean, boolean];
  /** shots[seat] are the squares that seat fired at the other sea, in order. */
  shots: [number[], number[]];
  turn: Seat;
}

export interface BattleshipView {
  phase: BattleshipState["phase"];
  turn: Seat;
  placed: [boolean, boolean];
  auto: [boolean, boolean];
  /** The viewer's own fleet; null for spectators and before it is placed. */
  myFleet: Fleet | null;
  /** shots[seat] are the shots that seat fired, with their results. */
  shots: [Shot[], Shot[]];
  /** sunk[seat] are the ships of seat's own fleet that are sunk, with where they lay. */
  sunk: [SunkShip[], SunkShip[]];
  /** The latest shot of the match, if any. */
  last: { seat: Seat; cell: number } | null;
  /** Both fleets, only once the match is over. */
  fleets: [Fleet | null, Fleet | null] | null;
}

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
export const cellName = (cell: number) => `${COLS[cell % SIZE]}${Math.floor(cell / SIZE) + 1}`;

/** The squares a ship covers, or null if it runs off the sea. */
export function shipCells(at: Placement, size: number): number[] | null {
  if (!Number.isInteger(at.cell) || at.cell < 0 || at.cell >= CELLS) return null;
  const r = Math.floor(at.cell / SIZE), c = at.cell % SIZE;
  if (at.dir === "h" ? c + size > SIZE : r + size > SIZE) return null;
  return Array.from({ length: size }, (_, i) => (at.dir === "h" ? at.cell + i : at.cell + i * SIZE));
}

/** Why a fleet is not a legal layout, or null if it is. */
export function fleetError(fleet: unknown): string | null {
  if (!Array.isArray(fleet) || fleet.length !== FLEET.length) return `fleet must place ${FLEET.length} ships`;
  const taken = new Set<number>();
  for (let i = 0; i < FLEET.length; i++) {
    const p = fleet[i] as Placement;
    if (!p || typeof p !== "object" || (p.dir !== "h" && p.dir !== "v")) return "each ship needs {cell, dir: h|v}";
    const cells = shipCells(p, FLEET[i].size);
    if (!cells) return `the ${FLEET[i].name} runs off the sea`;
    for (const cell of cells) {
      if (taken.has(cell)) return "ships cannot overlap";
      taken.add(cell);
    }
  }
  return null;
}

/** Square → index of the ship on it. */
export function occupancy(fleet: Fleet): Map<number, number> {
  const map = new Map<number, number>();
  fleet.forEach((p, i) => shipCells(p, FLEET[i].size)?.forEach((cell) => map.set(cell, i)));
  return map;
}

/** Resolve a list of shots against the fleet they were fired at. */
export function resolveShots(fleet: Fleet | null, shots: readonly number[]): Shot[] {
  if (!fleet) return shots.map((cell) => ({ cell, hit: false, sunk: null }));
  const at = occupancy(fleet);
  const left = FLEET.map((f) => f.size);
  return shots.map((cell) => {
    const ship = at.get(cell);
    if (ship === undefined) return { cell, hit: false, sunk: null };
    left[ship] -= 1;
    return { cell, hit: true, sunk: left[ship] === 0 ? ship : null };
  });
}

/** Ships of `fleet` sunk by `shots`, in the order they went down. */
export function sunkShips(fleet: Fleet | null, shots: readonly number[]): SunkShip[] {
  if (!fleet) return [];
  return resolveShots(fleet, shots).flatMap((s) => (s.sunk === null ? [] : [{ ship: s.sunk, at: { ...fleet[s.sunk] } }]));
}

export function commitment(fleet: Fleet, salt: string): string {
  return sha256Hex(canonical(fleet) + salt);
}

/** A random legal fleet. Biggest ships first, so it always fits. */
export function randomFleet(rng: Rng): Fleet {
  const taken = new Set<number>();
  return FLEET.map(({ size }) => {
    for (;;) {
      const at: Placement = { cell: rng.int(CELLS), dir: rng.next() < 0.5 ? "h" : "v" };
      const cells = shipCells(at, size);
      if (cells && cells.every((c) => !taken.has(c))) {
        cells.forEach((c) => taken.add(c));
        return at;
      }
    }
  });
}

const tidy = (fleet: Fleet): Fleet => fleet.map(({ cell, dir }) => ({ cell, dir }));

/** Whether the fleet fired at by `seat` is fully sunk. */
const sankAll = (s: BattleshipState, seat: Seat) => sunkShips(s.fleets[other(seat)], s.shots[seat]).length === FLEET.length;

function fire(s: BattleshipState, cell: number): BattleshipState {
  const shots: BattleshipState["shots"] = [s.shots[0].slice(), s.shots[1].slice()];
  shots[s.turn].push(cell);
  const next = { ...s, shots, turn: other(s.turn) };
  // Seat 0 fires first, so shot counts are even after every seat 1 shot.
  const even = shots[0].length === shots[1].length;
  return even && (sankAll(next, 0) || sankAll(next, 1)) ? { ...next, phase: "over" } : next;
}

const openCells = (shots: readonly number[]) => Array.from({ length: CELLS }, (_, i) => i).filter((c) => !shots.includes(c));

function startBattle(s: BattleshipState): BattleshipState {
  return s.fleets[0] && s.fleets[1] ? { ...s, phase: "battle", turn: 0 } : s;
}

export const battleship: GameDef<BattleshipState, BattleshipMove, BattleshipView> = {
  id: "battleship",
  name: "Battleship",

  setup: ({ seed }) => ({
    phase: "placing",
    fleets: [null, null],
    salts: [sha256Hex(`${seed}:salt:0`), sha256Hex(`${seed}:salt:1`)],
    auto: [false, false],
    shots: [[], []],
    turn: 0,
  }),

  validate(s, seat, m) {
    if (s.phase === "over") return "match is over";
    if (!m || typeof m !== "object") return "move must be {type: place|fire}";
    if (s.phase === "placing") {
      if (m.type !== "place") return "place your fleet first";
      if (s.fleets[seat]) return "fleet already placed";
      return fleetError(m.fleet);
    }
    if (m.type !== "fire") return "fleets are placed; fire a shot";
    if (seat !== s.turn) return "not your turn";
    if (!Number.isInteger(m.cell) || m.cell < 0 || m.cell >= CELLS) return `cell must be 0..${CELLS - 1}`;
    return s.shots[seat].includes(m.cell) ? "you already fired at that square" : null;
  },

  apply(s, seat, m) {
    if (m.type === "place") {
      const fleets: BattleshipState["fleets"] = [...s.fleets];
      fleets[seat] = tidy(m.fleet);
      return startBattle({ ...s, fleets });
    }
    return fire(s, m.cell);
  },

  onTimeout(s, rng) {
    if (s.phase === "placing") {
      const fleets: BattleshipState["fleets"] = [...s.fleets];
      const auto: BattleshipState["auto"] = [...s.auto];
      for (const seat of [0, 1] as const) {
        if (fleets[seat]) continue;
        fleets[seat] = randomFleet(rng);
        auto[seat] = true;
      }
      return startBattle({ ...s, fleets, auto });
    }
    if (s.phase === "battle") return fire(s, rng.pick(openCells(s.shots[s.turn])));
    return s;
  },

  deadlineMs: (s) => (s.phase === "placing" ? PLACE_MS : s.phase === "battle" ? TURN_MS : null),

  activeSeats(s) {
    if (s.phase === "placing") return ([0, 1] as const).filter((seat) => !s.fleets[seat]);
    return s.phase === "battle" ? [s.turn] : [];
  },

  outcome(s): Outcome | null {
    if (s.phase !== "over") return null;
    const [a, b] = [sankAll(s, 0), sankAll(s, 1)];
    if (a && b) return { winner: null, draw: true, reason: "both fleets sunk" };
    return { winner: a ? 0 : 1, draw: false, reason: "fleet sunk" };
  },

  view(s, viewer: Viewer) {
    const total = s.shots[0].length + s.shots[1].length;
    const lastSeat: Seat = total % 2 === 1 ? 0 : 1;
    return {
      phase: s.phase,
      turn: s.turn,
      placed: [s.fleets[0] !== null, s.fleets[1] !== null],
      auto: [...s.auto],
      myFleet: viewer === "spectator" || !s.fleets[viewer] ? null : tidy(s.fleets[viewer]!),
      shots: [resolveShots(s.fleets[1], s.shots[0]), resolveShots(s.fleets[0], s.shots[1])],
      sunk: [sunkShips(s.fleets[0], s.shots[1]), sunkShips(s.fleets[1], s.shots[0])],
      last: total ? { seat: lastSeat, cell: s.shots[lastSeat][s.shots[lastSeat].length - 1] } : null,
      fleets: s.phase === "over" ? [s.fleets[0] && tidy(s.fleets[0]), s.fleets[1] && tidy(s.fleets[1])] : null,
    };
  },

  commitments(s) {
    const out: Record<string, string> = {};
    for (const seat of [0, 1] as const) {
      const fleet = s.fleets[seat];
      if (fleet) out[String(seat)] = commitment(fleet, s.salts[seat]);
    }
    return out;
  },

  reveal: (s) => ({ fleets: s.fleets, salts: s.salts }),

  bot(view, seat, rng) {
    if (view.phase === "placing") return { type: "place", fleet: randomFleet(rng) };
    const heat = targetHeat(view.shots[seat], view.sunk[other(seat)]);
    const open = heat.flatMap((h, cell) => (h > 0 ? [{ cell, h }] : []));
    if (!open.length) return { type: "fire", cell: rng.pick(openCells(view.shots[seat].map((s) => s.cell))) };
    // Finishing a damaged ship it mostly takes the hottest square. Searching, it
    // guesses with a soft lean toward roomy water, so it plays like a person, not a solver.
    if (chasing(view.shots[seat], view.sunk[other(seat)])) {
      const best = Math.max(...open.map((o) => o.h));
      if (rng.next() < 0.85) return { type: "fire", cell: rng.pick(open.filter((o) => o.h === best)).cell };
    }
    const weights = open.map((o) => Math.sqrt(o.h));
    let roll = rng.next() * weights.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < open.length; i++) if ((roll -= weights[i]) < 0) return { type: "fire", cell: open[i].cell };
    return { type: "fire", cell: open[open.length - 1].cell };
  },
};

/**
 * How likely each open square holds a ship, given the shots so far: count every
 * way the ships still afloat could lie, and weight the ways that run through a
 * hit that has not sunk anything yet. Fired squares score 0.
 */
export function targetHeat(shots: readonly Shot[], sunk: readonly SunkShip[]): number[] {
  const fired = new Set(shots.map((s) => s.cell));
  const wrecked = wreckCells(sunk);
  const blocked = new Set([...shots.filter((s) => !s.hit).map((s) => s.cell), ...wrecked]);
  const open = new Set(shots.filter((s) => s.hit && !wrecked.has(s.cell)).map((s) => s.cell));
  const afloat = FLEET.map((_, i) => i).filter((i) => !sunk.some((s) => s.ship === i));
  const heat = Array<number>(CELLS).fill(0);
  for (const ship of afloat) {
    for (let cell = 0; cell < CELLS; cell++) {
      for (const dir of ["h", "v"] as const) {
        const cells = shipCells({ cell, dir }, FLEET[ship].size);
        if (!cells || cells.some((c) => blocked.has(c))) continue;
        const through = cells.filter((c) => open.has(c)).length;
        if (open.size && !through) continue;
        const weight = open.size ? 1 + 40 * through * through : 1;
        for (const c of cells) if (!fired.has(c)) heat[c] += weight;
      }
    }
  }
  return heat;
}

const wreckCells = (sunk: readonly SunkShip[]) => new Set(sunk.flatMap((s) => shipCells(s.at, FLEET[s.ship].size) ?? []));

/** Whether some hit is not part of a sunk ship yet. */
export function chasing(shots: readonly Shot[], sunk: readonly SunkShip[]): boolean {
  const wrecked = wreckCells(sunk);
  return shots.some((s) => s.hit && !wrecked.has(s.cell));
}
