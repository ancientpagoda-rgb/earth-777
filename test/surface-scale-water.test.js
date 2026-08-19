import test from "node:test";
import assert from "node:assert/strict";
import { surfaceScaleBandForDistance, surfaceWaterPolicy } from "../src/render/SurfaceScaleController.js";

test("surface scale bands descend from region to ground", () => {
  assert.equal(surfaceScaleBandForDistance(42).id, "regional");
  assert.equal(surfaceScaleBandForDistance(3).id, "landscape");
  assert.equal(surfaceScaleBandForDistance(0.8).id, "ecology");
  assert.equal(surfaceScaleBandForDistance(0.08).id, "ground");
});

test("local branch lakes are suppressed at regional and landscape scale", () => {
  for (const bandId of ["regional", "landscape"]) {
    const policy = surfaceWaterPolicy({
      bandId,
      waterBody: "lake",
      baseElevationMeters: 420,
      seaLevelMeters: -14,
      lakeCoverageFraction: 0.72
    });
    assert.equal(policy.visible, false);
    assert.equal(policy.reason, "local-lake-deferred");
  }
});

test("local lakes materialize only close to the surface and remain bounded", () => {
  const ecology = surfaceWaterPolicy({ bandId: "ecology", waterBody: "lake", lakeCoverageFraction: 1 });
  const ground = surfaceWaterPolicy({ bandId: "ground", waterBody: "lake", lakeCoverageFraction: 1 });
  assert.equal(ecology.visible, true);
  assert.ok(ecology.spanFraction <= 0.36);
  assert.equal(ground.visible, true);
  assert.ok(ground.spanFraction <= 0.58);
});

test("fallback ocean water is suppressed inland but retained at coasts", () => {
  const inland = surfaceWaterPolicy({
    bandId: "regional",
    waterBody: "ocean",
    baseElevationMeters: 410,
    seaLevelMeters: -14
  });
  assert.equal(inland.visible, false);
  assert.equal(inland.reason, "inland-ocean-suppressed");

  const coast = surfaceWaterPolicy({
    bandId: "regional",
    waterBody: "ocean",
    baseElevationMeters: 18,
    seaLevelMeters: -14
  });
  assert.equal(coast.visible, true);
  assert.equal(coast.reason, "coastal-ocean");
});
