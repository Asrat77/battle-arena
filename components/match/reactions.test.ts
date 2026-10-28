import assert from "node:assert/strict";
import { test } from "node:test";
import { REACTIONS } from "@/backend/src/chat";
import { PLAYER_BAR, REACTION_ART, SPECTATOR_BAR } from "./reactions";

test("every server reaction has art, and only GG is drawn as text", () => {
  assert.deepEqual(Object.keys(REACTION_ART).sort(), [...REACTIONS].sort());
  for (const [key, art] of Object.entries(REACTION_ART)) {
    assert.equal(art.key, key);
    assert.equal(art.icon === undefined, key === "GG", key);
  }
});

test("the bars only offer reactions the server accepts", () => {
  for (const key of [...PLAYER_BAR, ...SPECTATOR_BAR]) assert.ok((REACTIONS as readonly string[]).includes(key), key);
});
