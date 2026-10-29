// HTTP bodies are untyped JSON here.
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { io as connect } from "socket.io-client";
import { crackTheCode } from "../../engine/games/crackTheCode";
import { gebeta, storeOf, type GebetaState } from "../../engine/games/gebeta";
import { ticTacToe } from "../../engine/games/ticTacToe";
import { initial, step, type MatchState } from "../../engine/replay";
import { createRng } from "../../engine/rng";
import type { LogEntry, MatchRecord, Outcome, Seat } from "../../engine/types";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { Ledger } from "./ledger";
import { BOT_DELAY_MS } from "./matches";
import type { StoredMatch } from "./recorder";
import { BADGES, elo, FARM_WINDOW_MS, POINTS, Rewards, START_RATING } from "./rewards";
import { MemoryStore } from "./store";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 27, 12);
const BOT = "bot";

function setup() {
  const store = new MemoryStore();
  const ledger = new Ledger(store, { blockTimeMs: 1 });
  const notes: { to: string; payload: any }[] = [];
  const rewards = new Rewards(store, ledger, {
    isPlayer: (id) => id !== BOT,
    notify: (to, payload) => notes.push({ to, payload }),
  });
  return { store, ledger, rewards, notes };
}

let n = 0;
function stored(opts: {
  players: [string, string];
  outcome: Outcome;
  endedAt?: number;
  gameId?: string;
  seed?: string;
  log?: LogEntry[];
}): StoredMatch {
  const record: MatchRecord = {
    matchId: `m${n++}`,
    gameId: opts.gameId ?? "first-to-three",
    players: opts.players,
    bot: opts.players.includes(BOT),
    seed: opts.seed ?? "seed",
    log: opts.log ?? [],
    outcome: opts.outcome,
    startedAt: (opts.endedAt ?? T0) - 1000,
    endedAt: opts.endedAt ?? T0,
  };
  return { record, reveal: {}, commitments: {}, resultHash: "h", status: "recorded", commitIndex: null, resultIndex: n };
}

const win = (seat: Seat): Outcome => ({ winner: seat, draw: false, reason: "test" });
const draw: Outcome = { winner: null, draw: true, reason: "test" };
const badgeIds = (r: Rewards, id: string) => r.player(id).badges.map((b) => b.id).sort();

/** A Crack the Code log where seat 0 cracks the code in `rounds` rounds. */
function ctcWin(rounds: number): Pick<MatchRecord, "gameId" | "seed" | "log" | "outcome"> {
  const log: LogEntry[] = [
    { t: 0, seat: 0, move: { type: "secret", code: "1234" } },
    { t: 1, seat: 1, move: { type: "secret", code: "5678" } },
  ];
  for (let r = 1; r <= rounds; r++) {
    log.push({ t: log.length, seat: 0, move: { type: "guess", code: r === rounds ? "5678" : "9123" } });
    log.push({ t: log.length, seat: 1, move: { type: "guess", code: "9876" } });
  }
  const seed = "ctc";
  let cur = initial(crackTheCode, seed);
  log.forEach((e, i) => (cur = step(crackTheCode, seed, cur, e, i)));
  assert.equal(cur.outcome?.winner, 0);
  return { gameId: crackTheCode.id, seed, log, outcome: cur.outcome! };
}

/** First bot-vs-bot Gebeta game whose winner's margin satisfies `want`. */
function gebetaGame(want: (margin: number) => boolean) {
  for (let g = 0; g < 500; g++) {
    const seed = `g${g}`;
    let cur: MatchState<GebetaState> = initial(gebeta, seed);
    const log: LogEntry[] = [];
    const rng = createRng(`${seed}:bots`);
    while (!cur.outcome) {
      const seat = cur.state.turn;
      const entry: LogEntry = { t: log.length, seat, move: gebeta.bot(gebeta.view(cur.state, seat), seat, rng) };
      cur = step(gebeta, seed, cur, entry, log.length);
      log.push(entry);
    }
    const w = cur.outcome.winner;
    if (w === null) continue;
    const margin = cur.state.board[storeOf(w)] - cur.state.board[storeOf(w === 0 ? 1 : 0)];
    if (want(margin)) return { gameId: gebeta.id, seed, log, outcome: cur.outcome, winner: w };
  }
  throw new Error("no such game");
}

describe("points table", () => {
  test("win, draw and loss vs player, plus first match of the day", () => {
    const { rewards } = setup();
    rewards.matchRecorded(stored({ players: ["a", "b"], outcome: win(0) }));
    assert.equal(rewards.player("a").points, POINTS.win + POINTS.firstOfDay);
    assert.equal(rewards.player("b").points, POINTS.loss + POINTS.firstOfDay);
    assert.deepEqual(rewards.player("a").history[0].reasons, ["win", "firstOfDay"]);

    // Same day: no bonus again.
    rewards.matchRecorded(stored({ players: ["a", "b"], outcome: draw, endedAt: T0 + 1000 }));
    assert.equal(rewards.player("a").points, POINTS.win + POINTS.firstOfDay + POINTS.draw);
    assert.equal(rewards.player("b").points, POINTS.loss + POINTS.firstOfDay + POINTS.draw);
    assert.deepEqual(rewards.player("b").history[0].reasons, ["draw"]);

    // Next UTC day: bonus again.
    rewards.matchRecorded(stored({ players: ["b", "a"], outcome: win(1), endedAt: T0 + DAY }));
    assert.equal(rewards.player("a").history[0].points, POINTS.win + POINTS.firstOfDay);
    assert.equal(rewards.player("b").history[0].points, POINTS.loss + POINTS.firstOfDay);
  });

  test("any result vs bot is 1 point and never changes rating", () => {
    const { rewards } = setup();
    rewards.matchRecorded(stored({ players: ["a", BOT], outcome: win(0) }));
    rewards.matchRecorded(stored({ players: [BOT, "a"], outcome: win(0), endedAt: T0 + 1 }));
    rewards.matchRecorded(stored({ players: ["a", BOT], outcome: draw, endedAt: T0 + 2 }));
    const a = rewards.player("a");
    assert.equal(a.points, 3 * POINTS.bot + POINTS.firstOfDay);
    assert.deepEqual(a.overall, { rating: START_RATING, wins: 0, losses: 0, draws: 0 });
    assert.equal(rewards.player(BOT).history.length, 0, "the bot earns nothing");
    assert.deepEqual(rewards.leaderboard(), [], "bot matches never reach the leaderboard");
  });

  test("tournament win is 30 bonus points and the Champion badge", () => {
    const { rewards } = setup();
    rewards.tournamentWon("a", "t1", T0);
    assert.equal(rewards.player("a").points, POINTS.tournamentWin);
    assert.deepEqual(badgeIds(rewards, "a"), ["champion"]);
  });

  test("a match is only rewarded once", () => {
    const { rewards } = setup();
    const s = stored({ players: ["a", "b"], outcome: win(0) });
    rewards.matchRecorded(s);
    rewards.matchRecorded(s);
    assert.equal(rewards.player("a").history.length, 1);
  });
});

describe("rating and leaderboard", () => {
  test("Elo moves per game and overall; rows link to recorded matches", () => {
    const { rewards } = setup();
    const s = stored({ players: ["a", "b"], outcome: win(0) });
    rewards.matchRecorded(s);
    const [ra, rb] = elo(START_RATING, START_RATING, 1);
    assert.equal(ra, START_RATING + 16);
    assert.equal(rewards.player("a").overall.rating, ra);
    assert.equal(rewards.player("b").games["first-to-three"].rating, rb);

    const rows = rewards.leaderboard();
    assert.deepEqual(
      rows.map((r) => [r.rank, r.profileId, r.wins, r.losses]),
      [
        [1, "a", 1, 0],
        [2, "b", 0, 1],
      ],
    );
    assert.deepEqual(rows[0].matches, [{ matchId: s.record.matchId, resultIndex: s.resultIndex, url: `/api/matches/${s.record.matchId}` }]);
    assert.equal(rows[0].profile, "/api/profiles/a");
    assert.equal(rewards.leaderboard("first-to-three").length, 2);
    assert.equal(rewards.leaderboard(gebeta.id).length, 0);
  });
});

describe("anti-farming", () => {
  test("same pair: only 3 matches per 24 h earn points or rank", () => {
    const { rewards } = setup();
    for (let i = 0; i < 5; i++) {
      rewards.matchRecorded(stored({ players: i % 2 ? ["b", "a"] : ["a", "b"], outcome: draw, endedAt: T0 + i * 1000 }));
    }
    const a = rewards.player("a");
    assert.equal(a.history.length, 5, "farmed matches are still listed");
    assert.deepEqual(a.history.slice(0, 2).map((h) => h.reasons), [["farmed"], ["farmed"]]);
    assert.equal(a.points, 3 * POINTS.draw + POINTS.firstOfDay);
    assert.equal(a.overall.draws, 3);

    // Another opponent is unaffected.
    rewards.matchRecorded(stored({ players: ["a", "c"], outcome: win(0), endedAt: T0 + 6000 }));
    assert.equal(rewards.player("a").overall.wins, 1);

    // Once the first match leaves the window, one more counts.
    rewards.matchRecorded(stored({ players: ["a", "b"], outcome: draw, endedAt: T0 + FARM_WINDOW_MS }));
    assert.equal(rewards.player("a").overall.draws, 4);
    rewards.matchRecorded(stored({ players: ["a", "b"], outcome: draw, endedAt: T0 + FARM_WINDOW_MS + 1 }));
    assert.equal(rewards.player("a").overall.draws, 4);
  });

  test("a capped match tells both players it paid nothing", () => {
    const { rewards, notes } = setup();
    for (let i = 0; i < 3; i++) rewards.matchRecorded(stored({ players: ["a", "b"], outcome: draw, endedAt: T0 + i }));
    notes.length = 0;
    const s = stored({ players: ["a", "b"], outcome: win(0), endedAt: T0 + 3 });
    rewards.matchRecorded(s);
    const points = notes.filter((x) => x.payload.kind === "points");
    assert.deepEqual(
      points.map((x) => [x.to, x.payload]),
      ["a", "b"].map((to) => [to, { kind: "points", matchId: s.record.matchId, points: 0, reasons: ["farmed"] }]),
    );
  });

  test("farmed wins grant no badges", () => {
    const { rewards } = setup();
    for (let i = 0; i < 3; i++) rewards.matchRecorded(stored({ players: ["a", "b"], outcome: win(1), endedAt: T0 + i }));
    rewards.matchRecorded(stored({ players: ["a", "b"], outcome: win(0), endedAt: T0 + 3 }));
    assert.deepEqual(badgeIds(rewards, "a"), []);
  });
});

describe("badges", () => {
  test("First Blood: first win against a player, not a bot", () => {
    const { rewards } = setup();
    rewards.matchRecorded(stored({ players: ["a", BOT], outcome: win(0) }));
    assert.deepEqual(badgeIds(rewards, "a"), []);
    rewards.matchRecorded(stored({ players: ["a", "b"], outcome: win(0), endedAt: T0 + 1 }));
    assert.deepEqual(badgeIds(rewards, "a"), ["firstBlood"]);
    assert.deepEqual(badgeIds(rewards, "b"), []);
  });

  test("Codebreaker: win Crack the Code in 5 rounds or fewer", () => {
    const { rewards } = setup();
    rewards.matchRecorded(stored({ players: ["a", BOT], ...ctcWin(6) }));
    assert.deepEqual(badgeIds(rewards, "a"), []);
    rewards.matchRecorded(stored({ players: ["a", BOT], ...ctcWin(5), endedAt: T0 + 1 }));
    assert.deepEqual(badgeIds(rewards, "a"), ["codebreaker"]);
  });

  test("Seed Master: win Gebeta by 10 or more seeds", () => {
    const { rewards } = setup();
    const close = gebetaGame((m) => m < 10);
    const players = (w: Seat): [string, string] => (w === 0 ? ["a", BOT] : [BOT, "a"]);
    rewards.matchRecorded(stored({ players: players(close.winner), ...close }));
    assert.deepEqual(badgeIds(rewards, "a"), []);
    const big = gebetaGame((m) => m >= 10);
    rewards.matchRecorded(stored({ players: players(big.winner), ...big, endedAt: T0 + 1 }));
    assert.deepEqual(badgeIds(rewards, "a"), ["seedMaster"]);
  });

  test("On a Roll: 3 wins in a row against players; a loss resets the streak", () => {
    const { rewards } = setup();
    const vs = (opp: string, w: Seat, t: number) => rewards.matchRecorded(stored({ players: ["a", opp], outcome: win(w), endedAt: T0 + t }));
    vs("b", 0, 1);
    vs("c", 0, 2);
    vs("d", 1, 3);
    vs(BOT, 0, 4); // bot matches neither extend nor break the streak
    vs("e", 0, 5);
    vs("f", 0, 6);
    assert.ok(!badgeIds(rewards, "a").includes("onARoll"));
    vs(BOT, 0, 7);
    vs("g", 0, 8);
    assert.deepEqual(badgeIds(rewards, "a"), ["firstBlood", "onARoll"]);
  });

  test("Explorer: finish all five games", () => {
    const { rewards } = setup();
    rewards.matchRecorded(stored({ players: [BOT, "a"], ...ctcWin(6) })); // a loses: finishing is enough
    assert.deepEqual(badgeIds(rewards, "a"), []);
    const g = gebetaGame(() => true);
    rewards.matchRecorded(stored({ players: g.winner === 0 ? [BOT, "a"] : ["a", BOT], ...g, endedAt: T0 + 1 }));
    assert.deepEqual(badgeIds(rewards, "a"), []);
    rewards.matchRecorded(stored({ gameId: ticTacToe.id, players: ["a", BOT], log: [], outcome: { winner: null, draw: true, reason: "series draw" }, endedAt: T0 + 2 }));
    assert.deepEqual(badgeIds(rewards, "a"), []);
    rewards.matchRecorded(stored({ gameId: "dots-and-boxes", players: ["a", BOT], log: [], outcome: { winner: 1, draw: false, reason: "forfeit" }, endedAt: T0 + 3 }));
    assert.deepEqual(badgeIds(rewards, "a"), []);
    rewards.matchRecorded(stored({ gameId: "bingo", players: ["a", BOT], log: [], outcome: { winner: 1, draw: false, reason: "forfeit" }, endedAt: T0 + 4 }));
    assert.deepEqual(badgeIds(rewards, "a"), ["explorer"]);
  });

  test("Explorer: a badge earned before the third game is retained", () => {
    const { store, rewards } = setup();
    const player = rewards.player("a");
    player.played = ["crack-the-code", "gebeta"];
    const legacy = { id: "explorer" as const, name: "Explorer", earnedAt: T0, source: "legacy-match", ledgerIndex: 1 };
    player.badges.push(legacy);
    store.write("rewards", { players: { a: player }, pairs: {}, processed: {} });
    rewards.matchRecorded(stored({ players: ["a", BOT], gameId: "gebeta", outcome: draw, endedAt: T0 + 1 }));
    assert.deepEqual(rewards.player("a").badges.find((b) => b.id === "explorer"), legacy);
  });

  test("Watcher: spectate 3 different matches to the end", () => {
    const { rewards } = setup();
    rewards.spectated("w", "m1");
    rewards.spectated("w", "m2");
    rewards.spectated("w", "m2");
    assert.deepEqual(badgeIds(rewards, "w"), []);
    rewards.spectated("w", "m3");
    assert.deepEqual(badgeIds(rewards, "w"), ["watcher"]);
  });

  test("badges are granted once and sealed in badge blocks; points are minted as tokens", async () => {
    const { rewards, ledger, notes } = setup();
    rewards.matchRecorded(stored({ players: ["a", "b"], outcome: win(0) }));
    rewards.matchRecorded(stored({ players: ["a", "c"], outcome: win(0), endedAt: T0 + 1 }));
    assert.equal(rewards.player("a").badges.length, 1);
    assert.equal(rewards.player("a").tokens, 0, "tokens appear once minted");
    ledger.flush();
    await new Promise((r) => setImmediate(r));

    const a = rewards.player("a");
    const badgeBlock = ledger.get(a.badges[0].ledgerIndex!)!;
    assert.equal(badgeBlock.kind, "badge");
    assert.deepEqual(badgeBlock.payload, { profileId: "a", badge: "firstBlood", source: a.badges[0].source, ts: T0 });
    assert.equal(a.tokens, a.points);
    const mints = ledger.blocks().filter((b) => b.kind === "mint" && (b.payload as any).to === "a");
    assert.equal(mints.reduce((sum, b) => sum + (b.payload as any).amount, 0), a.points);
    assert.ok(a.history.every((h) => h.mintIndex !== null));
    assert.ok(notes.some((x) => x.to === "a" && x.payload.kind === "badge" && x.payload.badge.name === "First Blood"));
    assert.ok(notes.some((x) => x.to === "a" && x.payload.kind === "points"));
  });
});

describe("rewards over the API", () => {
  test("a recorded bot match gives points but leaves the leaderboard empty", async () => {
    const clock = new FakeClock();
    const { httpServer, io, matches } = createApp({ store: new MemoryStore(), clock, ledger: { blockTimeMs: 5 } });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
    const api = async (path: string, body?: unknown) => {
      const res = await fetch(url + path, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: (await res.json()) as any };
    };
    try {
      const { body } = await api("/api/signup", { name: "Judge" });
      const socket = connect(url, { auth: { token: body.token }, transports: ["websocket"], forceNew: true, reconnection: false });
      const notes: any[] = [];
      socket.on("notify", (p) => notes.push(p));
      await new Promise<void>((r) => socket.once("connect", () => r()));
      const id = body.profile.id;

      const m = matches.create({ game: crackTheCode, players: [id, "bot"], botSeat: 1 });
      const move = (mv: unknown) => new Promise((r) => socket.emit("match:move", { matchId: m.id, move: mv }, r));
      await move({ type: "secret", code: "1234" });
      clock.advance(BOT_DELAY_MS[1]);
      const guesses = ["5678", "9123", "4567", "8912", "3456", "7891"];
      for (let i = 0; !m.cur.outcome; i++) {
        await move({ type: "guess", code: guesses[i % guesses.length] });
        if (!m.cur.outcome) clock.advance(BOT_DELAY_MS[1]);
      }

      let rewards: any;
      for (let i = 0; i < 200; i++) {
        rewards = (await api(`/api/profiles/${id}/rewards`)).body;
        if (rewards.tokens > 0) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.equal(rewards.points, POINTS.bot + POINTS.firstOfDay);
      assert.equal(rewards.tokens, rewards.points);
      assert.equal(rewards.history[0].matchId, m.id);
      assert.ok(notes.some((p) => p.kind === "points" && p.matchId === m.id));

      assert.deepEqual((await api("/api/leaderboard")).body, { game: null, rows: [] });
      assert.equal((await api("/api/leaderboard?game=crack-the-code")).status, 200);
      assert.equal((await api("/api/leaderboard?game=nope")).status, 404);
      assert.equal((await api("/api/profiles/0xnobody/rewards")).status, 404);
      assert.equal((await api("/api/badges")).body.length, Object.keys(BADGES).length);
      socket.disconnect();
    } finally {
      io.close();
    }
  });
});
