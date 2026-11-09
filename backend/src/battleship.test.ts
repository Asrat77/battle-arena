import assert from "node:assert/strict";
import { test } from "node:test";
import { battleship, occupancy, type BattleshipState, type Fleet } from "../../engine/games/battleship";
import { verifyMatch } from "../../engine/verify";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { MemoryStore } from "./store";

const ROWS: Fleet = [{ cell: 0, dir: "h" }, { cell: 16, dir: "h" }, { cell: 32, dir: "h" }, { cell: 48, dir: "h" }];
const COLS: Fleet = [{ cell: 7, dir: "v" }, { cell: 6, dir: "v" }, { cell: 5, dir: "v" }, { cell: 4, dir: "v" }];

test("a complete match keeps fleets private, seals them, records once and verifies", async () => {
  const clock = new FakeClock();
  const app = createApp({ store: new MemoryStore(), clock, ledger: { blockTimeMs: 5 } });
  const players: [string, string] = [app.identity.signup("Alice").profile.id, app.identity.signup("Bob").profile.id];
  const m = app.matches.create({ game: battleship, players });
  const state = () => m.cur.state as BattleshipState;
  try {
    assert.equal(app.matches.move(players[0], m.id, { type: "place", fleet: ROWS }), null);
    assert.equal(m.committed, false);
    assert.equal(app.matches.move(players[1], m.id, { type: "place", fleet: COLS }), null);
    assert.equal(m.committed, true);
    assert.deepEqual(Object.keys(m.commitments).sort(), ["0", "1"]);
    assert.ok(!JSON.stringify(battleship.view(state(), 1)).includes(JSON.stringify(ROWS)));

    const targets = [[...occupancy(COLS).keys()], [...occupancy(ROWS).keys()]];
    const misses = [[56, 57, 58, 59, 60, 61, 62, 63, 40, 41, 42, 43], [24, 25, 26, 27, 28, 29, 30, 31, 8, 9, 10, 11]];
    for (let i = 0; !m.cur.outcome; i++) {
      assert.equal(app.matches.move(players[0], m.id, { type: "fire", cell: targets[0][i] }), null);
      if (!m.cur.outcome) assert.equal(app.matches.move(players[1], m.id, { type: "fire", cell: misses[1][i] }), null);
    }
    assert.deepEqual(m.cur.outcome, { winner: 0, draw: false, reason: "fleet sunk" });
    app.ledger.flush();
    await new Promise((resolve) => setImmediate(resolve));
    const stored = app.recorder.get(m.id)!;
    assert.equal(stored.status, "recorded");
    const checks = verifyMatch({ record: stored.record, blocks: app.ledger.blocks(), publicKey: app.ledger.publicKey });
    assert.equal(checks.ok, true, JSON.stringify(checks));
    assert.equal(app.rewards.player(players[0]).history.filter((h) => h.matchId === m.id).length, 1);
  } finally { app.ledger.flush(); app.io.close(); }
});
