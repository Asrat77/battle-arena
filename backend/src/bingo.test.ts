import assert from "node:assert/strict";
import { test } from "node:test";
import { bingo, openNumbers, type BingoState } from "../../engine/games/bingo";
import { verifyMatch } from "../../engine/verify";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { MemoryStore } from "./store";

test("a complete match keeps sheets private, records once and verifies", async () => {
  const clock = new FakeClock();
  const app = createApp({ store: new MemoryStore(), clock, ledger: { blockTimeMs: 5 } });
  const players: [string, string] = [app.identity.signup("Alice").profile.id, app.identity.signup("Bob").profile.id];
  const m = app.matches.create({ game: bingo, players });
  const state = () => m.cur.state as BingoState;
  try {
    const view = bingo.view(state(), 1);
    assert.deepEqual(view.grid, state().grids[1]);
    assert.ok(!JSON.stringify(view).includes(JSON.stringify(state().grids[0])));
    while (!m.cur.outcome) assert.equal(app.matches.move(players[state().turn], m.id, { number: openNumbers(state().grids[state().turn], state().called)[0] }), null);
    app.ledger.flush();
    await new Promise((resolve) => setImmediate(resolve));
    const stored = app.recorder.get(m.id)!;
    assert.equal(stored.status, "recorded");
    assert.equal(verifyMatch({ record: stored.record, blocks: app.ledger.blocks(), publicKey: app.ledger.publicKey }).ok, true);
    assert.equal(app.rewards.player(players[0]).history.filter((h) => h.matchId === m.id).length, 1);
  } finally { app.ledger.flush(); app.io.close(); }
});
