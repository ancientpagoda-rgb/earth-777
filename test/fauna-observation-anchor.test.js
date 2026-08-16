import test from "node:test";
import assert from "node:assert/strict";
import {
  faunaObservationRecenterThresholdKm,
  shouldRecenterFaunaObservation
} from "../src/render/SurfaceFaunaManager.js";

test("fauna observation recenter threshold reuses a multi-kilometer window", () => {
  const threshold = faunaObservationRecenterThresholdKm(3.5, 0.55);
  assert.ok(threshold > 0.2);
  assert.ok(Math.abs(threshold - 0.44) < 1e-12);
});

test("camera motion within the observation anchor does not request a rebuild", () => {
  const anchor = { x: 10, z: -4 };
  const threshold = faunaObservationRecenterThresholdKm(3.5, 0.55);
  assert.equal(shouldRecenterFaunaObservation(anchor, { x: 10 + threshold - 0.01, z: -4 }, 3.5, 0.55), false);
  assert.equal(shouldRecenterFaunaObservation(anchor, { x: 10 + threshold + 0.01, z: -4 }, 3.5, 0.55), true);
});

test("missing anchors rebuild and large windows keep bounded recenter distances", () => {
  assert.equal(shouldRecenterFaunaObservation(null, { x: 0, z: 0 }, 3.5, 0.55), true);
  assert.ok(faunaObservationRecenterThresholdKm(12, 2) <= 1.25);
  assert.ok(faunaObservationRecenterThresholdKm(0.5, 0.5) <= 0.5);
});
