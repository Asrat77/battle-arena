import assert from "node:assert/strict";
import { test } from "node:test";
import { dotsAndBoxes, available, TURN_MS, type DotsState } from "../../engine/games/dotsAndBoxes";
import { verifyMatch } from "../../engine/verify";
import { createApp } from "./app";
import { FakeClock } from "./clock";
import { MemoryStore } from "./store";

test("a complete match resets the capture clock, records once and verifies", async () => {
  const clock = new FakeClock();
  const app = createApp({ store: new MemoryStore(), clock, ledger: { blockTimeMs: 5 } });
  const players: [string, string] = [app.identity.signup("Alice").profile.id, app.identity.signup("Bob").profile.id];
  const m = app.matches.create({ game: dotsAndBoxes, players });
  const move = (edge: number) => assert.equal(app.matches.move(players[(m.cur.state as DotsState).turn], m.id, { edge }), null);
  try {
    [0, 5, 30].forEach(move);
    clock.advance(5000);
    const seat = (m.cur.state as DotsState).turn;
    move(31);
    assert.equal((m.cur.state as DotsState).turn, seat);
    assert.equal(m.deadline, clock.now() + TURN_MS);
    while (!m.cur.outcome) move(available((m.cur.state as DotsState).edges)[0]);
    app.ledger.flush();
    await new Promise((resolve) => setImmediate(resolve));
    const stored = app.recorder.get(m.id)!;
    assert.equal(stored.status, "recorded");
    assert.equal(stored.commitIndex, null);
    assert.equal(verifyMatch({ record: stored.record, blocks: app.ledger.blocks(), publicKey: app.ledger.publicKey }).ok, true);
    assert.equal(app.rewards.player(players[0]).history.filter((h) => h.matchId === m.id).length, 1);
  } finally { app.ledger.flush(); app.io.close(); }
});
