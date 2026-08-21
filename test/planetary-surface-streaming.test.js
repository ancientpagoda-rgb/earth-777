import test from "node:test";
import assert from "node:assert/strict";
import {
  geographicDestination,
  PLANETARY_SURFACE_STREAMING_POLICY,
  surfaceRebasePlan
} from "../src/render/SurfacePlanetaryStreaming.js";

test("geographic destination moves about one degree north per 111 km", () => {
  const next = geographicDestination({ latitude: 0, longitude: 0 }, 0, 111.32);
  assert.ok(Math.abs(next.latitude - 1) < 0.01);
  assert.ok(Math.abs(next.longitude) < 1e-9);
});

test("geographic destination wraps continuously across the dateline", () => {
  const next = geographicDestination({ latitude: 0, longitude: 179.7 }, 100, 0);
  assert.ok(next.longitude < -179 && next.longitude >= -180);
  assert.ok(Math.abs(next.latitude) < 0.01);
});

test("northward travel can cross a pole instead of clamping", () => {
  const next = geographicDestination({ latitude: 89.5, longitude: 20 }, 0, 180);
  assert.ok(next.latitude < 89.5);
  assert.ok(next.latitude > 88);
  assert.ok(Math.abs(Math.abs(next.longitude - 20) - 180) < 0.5 || Math.abs(next.longitude + 160) < 0.5);
});

test("surface rebasing moves by whole terrain chunks and leaves a small local residual", () => {
  const plan = surfaceRebasePlan({
    origin: { latitude: 38.97, longitude: -95.24 },
    focusXKm: 190,
    focusZKm: 31,
    chunkSizeKm: 84
  });
  assert.ok(plan);
  assert.equal(plan.policy, PLANETARY_SURFACE_STREAMING_POLICY);
  assert.equal(plan.chunkShiftX, 2);
  assert.equal(plan.chunkShiftZ, 0);
  assert.equal(plan.shiftXKm, 168);
  assert.equal(plan.shiftZKm, 0);
  assert.equal(plan.residualXKm, 22);
  assert.equal(plan.residualZKm, 31);
  assert.ok(Math.hypot(plan.residualXKm, plan.residualZKm) < 42);
  assert.ok(plan.origin.longitude > -95.24);
});

test("surface rebasing stays dormant while focus remains inside the local precision window", () => {
  const plan = surfaceRebasePlan({
    origin: { latitude: 10, longitude: 20 },
    focusXKm: 45,
    focusZKm: 35,
    chunkSizeKm: 84
  });
  assert.equal(plan, null);
});

test("floating origin scales down with landscape-sized chunks", () => {
  const plan = surfaceRebasePlan({
    origin: { latitude: 35, longitude: -100 },
    focusXKm: 13,
    focusZKm: 2,
    chunkSizeKm: 8
  });
  assert.ok(plan);
  assert.equal(plan.chunkShiftX, 2);
  assert.equal(plan.shiftXKm, 16);
  assert.ok(Math.abs(plan.residualXKm) < 8);
});

test("repeated eastward rebases can circle the planet without unbounded coordinates", () => {
  let origin = { latitude: 0, longitude: 0 };
  for (let index = 0; index < 480; index += 1) {
    const plan = surfaceRebasePlan({
      origin,
      focusXKm: 170,
      focusZKm: 0,
      chunkSizeKm: 84
    });
    assert.ok(plan);
    assert.ok(plan.origin.longitude >= -180 && plan.origin.longitude < 180);
    assert.ok(Math.abs(plan.residualXKm) < 84);
    origin = plan.origin;
  }
  assert.ok(Number.isFinite(origin.latitude));
  assert.ok(Number.isFinite(origin.longitude));
});
