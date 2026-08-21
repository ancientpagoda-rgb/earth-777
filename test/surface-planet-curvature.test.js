import test from "node:test";
import assert from "node:assert/strict";
import {
  EARTH_MEAN_RADIUS_KM,
  SURFACE_CURVATURE_POLICY,
  surfaceCurvatureBlend,
  tangentSphereDropKm
} from "../src/render/SurfacePlanetCurvature.js";

test("surface curvature policy is explicit and stable", () => {
  assert.equal(SURFACE_CURVATURE_POLICY, "distance-blended-local-spherical-cap-v1");
});

test("curvature stays flat at ordinary regional distance and reaches full strength far out", () => {
  assert.equal(surfaceCurvatureBlend(80), 0);
  assert.equal(surfaceCurvatureBlend(140), 0);
  assert.ok(surfaceCurvatureBlend(220) > 0 && surfaceCurvatureBlend(220) < 1);
  assert.equal(surfaceCurvatureBlend(320), 1);
  assert.equal(surfaceCurvatureBlend(420), 1);
});

test("tangent sphere drop matches small-angle Earth curvature", () => {
  assert.equal(tangentSphereDropKm(0), 0);
  const drop100 = tangentSphereDropKm(100);
  const approximation100 = (100 * 100) / (2 * EARTH_MEAN_RADIUS_KM);
  assert.ok(Math.abs(drop100 - approximation100) < 0.001);
  assert.ok(tangentSphereDropKm(300) > drop100);
});
