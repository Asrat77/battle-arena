import assert from "node:assert/strict";
import { test } from "node:test";
import { dotsAndBoxes as game } from "../../engine/games/dotsAndBoxes";
import { nextEdge } from "./geometry";

test("arrow aiming stays in a row, steps to the nearest row, and skips drawn lines", () => {
  const { edges } = game.setup({ seed: "x" });
  assert.equal(nextEdge(edges, 0, "right"), 1);
  assert.equal(nextEdge(edges, 0, "left"), null);
  assert.equal(nextEdge(edges, 0, "up"), null);
  assert.equal(nextEdge(edges, 0, "down"), 30);
  assert.equal(nextEdge(edges, 31, "up"), 0);
  assert.equal(nextEdge(edges, 31, "down"), 5);
  const drawn = edges.slice(); drawn[1] = 0;
  assert.equal(nextEdge(drawn, 0, "right"), 2);
});
