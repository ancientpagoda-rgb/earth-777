import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import {
  SURFACE_PLANET_FAR_FIELD_POLICY,
  createSurfacePlanetFarField,
  geographicSurfaceFrame,
  globalToSurfaceMatrix
} from "../src/render/SurfacePlanetFarField.js";
import { surfaceNearClipKm } from "../src/render/SurfacePresentation.js";

const closeVector = (actual, expected, epsilon = 1e-9) => {
  assert.ok(actual.distanceTo(expected) < epsilon, `${actual.toArray()} != ${expected.toArray()}`);
};

test("surface tangent frame maps east, up and north onto the local terrain axes", () => {
  const frame = geographicSurfaceFrame(38.97, -95.24);
  const matrix = globalToSurfaceMatrix(38.97, -95.24);
  closeVector(frame.east.clone().transformDirection(matrix), new THREE.Vector3(1, 0, 0));
  closeVector(frame.up.clone().transformDirection(matrix), new THREE.Vector3(0, 1, 0));
  closeVector(frame.north.clone().transformDirection(matrix), new THREE.Vector3(0, 0, 1));
});

test("far field is a full georeferenced Earth tangent beneath the local origin", () => {
  const scene = new THREE.Scene();
  const farField = createSurfacePlanetFarField(scene, { radiusKm: 100, tangentInsetKm: 0.05, widthSegments: 32, heightSegments: 16 });
  assert.equal(farField.mesh.userData.presentation, SURFACE_PLANET_FAR_FIELD_POLICY);
  assert.equal(farField.material.depthWrite, false);
  assert.equal(farField.mesh.visible, false);
  assert.equal(farField.setOrigin({ latitude: 0, longitude: 0 }), true);
  assert.equal(farField.mesh.visible, true);
  const tangent = geographicSurfaceFrame(0, 0).up.multiplyScalar(100).applyMatrix4(farField.mesh.matrix);
  assert.ok(Math.abs(tangent.y + 0.05) < 1e-9);
  assert.equal(farField.diagnostics().radiusKm, 100);
  assert.equal(farField.diagnostics().rasterMapped, false);
  farField.dispose();
  assert.equal(scene.children.includes(farField.mesh), false);
});

test("regional detail smoothly blends before its finite square border and raster updates reach the far Earth", () => {
  const aerial = readFileSync(new URL("../src/render/RegionalAerialMaterial.js", import.meta.url), "utf8");
  const earthView = readFileSync(new URL("../src/render/earth-view.js", import.meta.url), "utf8");
  const rasterRefresh = readFileSync(new URL("../src/render/RasterRefresh.js", import.meta.url), "utf8");
  assert.match(aerial, /aerialDetailCoverage/);
  assert.match(aerial, /aerialCurvatureBlend = smoothstep\(110\.0, 300\.0/);
  assert.match(aerial, /diffuseColor\.a \*= aerialDetailCoverage/);
  assert.doesNotMatch(aerial, /aerialDither/);
  assert.match(aerial, /"#include <alphatest_fragment>",[\s\S]*diffuseColor\.a \*= aerialDetailCoverage/);
  assert.doesNotMatch(aerial, /"#include <dithering_fragment>",[\s\S]*aerialDetailCoverage/);
  assert.match(earthView, /surfacePlanetaryFarField\?\.setTexture/);
  assert.match(rasterRefresh, /surfacePlanetaryFarField\?\.setTexture/);
});

test("surface near plane gains depth precision only for distant aerial views", () => {
  assert.equal(surfaceNearClipKm(0), 0.00005);
  assert.equal(surfaceNearClipKm(2), 0.00005);
  assert.ok(surfaceNearClipKm(90) > 0.02);
  assert.equal(surfaceNearClipKm(180), 0.05);
  assert.equal(surfaceNearClipKm(420), 0.05);
});
