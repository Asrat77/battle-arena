import assert from "node:assert/strict";
import { test } from "node:test";
import { playerInitials } from "./initials";

test("initials distinguish players, including matching names", () => {
  assert.deepEqual(playerInitials(["Tito", "Abebe"]), ["T", "A"]);
  assert.deepEqual(playerInitials(["Tito", "Tara"]), ["TI", "TA"]);
  assert.deepEqual(playerInitials(["Tito", "Tina"]), ["TI1", "TI2"]);
  assert.deepEqual(playerInitials(["Tito", "tito"]), ["TI1", "TI2"]);
  assert.deepEqual(playerInitials(["Éva", "Selam"]), ["É", "S"]);
  assert.deepEqual(playerInitials(["", ""]), ["?1", "?2"]);
});
