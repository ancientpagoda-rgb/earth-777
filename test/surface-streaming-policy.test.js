import test from "node:test";
import assert from "node:assert/strict";
import {
  localKilometersToGeographic,
  predictedRefinementCenter,
  regionalPatchContainsFocus,
  streamingSegmentsForCandidate
} from "../src/render/SurfaceStreamingPolicy.js";

test("concentric streaming spends mesh detail near the inspection point", () => {
  const center = streamingSegmentsForCandidate({ bandId: "regional", baseSegments: 18, distanceSquared: 0 });
  const middle = streamingSegmentsForCandidate({ bandId: "regional", baseSegments: 18, distanceSquared: 1 });
  const outer = streamingSegmentsForCandidate({ bandId: "regional", baseSegments: 18, distanceSquared: 8 });
  assert.ok(center > middle);
  assert.ok(middle > outer);
  assert.ok(outer >= 8);
});

test("local terrain focus converts continuously to geography", () => {
  const origin = { latitude: 38.97, longitude: -95.23 };
  const east = localKilometersToGeographic(origin, 10, 0);
  const north = localKilometersToGeographic(origin, 0, 10);
  assert.ok(east.longitude > origin.longitude);
  assert.ok(north.latitude > origin.latitude);
});

test("regional refinement predicts ahead of camera motion and quantizes cache keys", () => {
  const origin = { latitude: 38.97, longitude: -95.23 };
  const center = predictedRefinementCenter({
    origin,
    focusXKm: 20,
    focusZKm: 0,
    previousFocusXKm: 0,
    previousFocusZKm: 0,
    lookAheadKm: 20,
    quantizationDegrees: 0.25
  });
  const current = localKilometersToGeographic(origin, 20, 0);
  assert.ok(center.longitude >= current.longitude);
  assert.equal((center.latitude * 4) % 1, 0);
  assert.equal((center.longitude * 4) % 1, 0);
});

test("fine patch is retained until the focus enters its feather margin", () => {
  const patch = { south: 38.5, north: 39.5, west: -95.75, east: -94.75 };
  assert.equal(regionalPatchContainsFocus(patch, 39.0, -95.25, 0.2), true);
  assert.equal(regionalPatchContainsFocus(patch, 39.0, -95.70, 0.2), false);
});
