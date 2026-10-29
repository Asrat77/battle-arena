import assert from "node:assert/strict";
import { test } from "node:test";
import { listGames } from "../engine/registry";
import { GAME_CATALOG, GAME_ICONS, GAME_OPTIONS } from "./gameCatalog";

test("the frontend catalog covers every engine game in the same order", () => {
  assert.deepEqual(GAME_CATALOG.map((g) => g.id), listGames().map((g) => g.id));
  for (const game of listGames()) {
    assert.equal(GAME_CATALOG.find((g) => g.id === game.id)?.name, game.name);
    assert.ok(GAME_ICONS[game.id]);
    assert.ok(GAME_OPTIONS.some((option) => option.value === game.id));
  }
});
