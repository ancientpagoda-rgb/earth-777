import test from "node:test";
import assert from "node:assert/strict";
import {
  GLOBE_MAX_DISTANCE,
  GLOBE_MIN_DISTANCE,
  STARFIELD_INNER_RADIUS,
  STARFIELD_OUTER_RADIUS
} from "../src/render/GlobePresentation.js";

test("extreme globe zoom remains inside the star field", () => {
  assert.ok(GLOBE_MIN_DISTANCE > 1.42);
  assert.ok(GLOBE_MAX_DISTANCE > 50);
  assert.ok(STARFIELD_INNER_RADIUS > GLOBE_MAX_DISTANCE);
  assert.ok(STARFIELD_OUTER_RADIUS > STARFIELD_INNER_RADIUS);
});

test("star shell leaves far-camera depth headroom", () => {
  const farthestPossibleStarDistance = GLOBE_MAX_DISTANCE + STARFIELD_OUTER_RADIUS;
  assert.ok(farthestPossibleStarDistance < 700);
});
