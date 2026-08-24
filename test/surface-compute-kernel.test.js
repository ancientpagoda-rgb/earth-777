import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { TerrainChunkManager } from "../src/render/TerrainChunkManager.js";
import { buildEcologyChunkPlan, buildTerrainChunkData, surfaceHeightAt } from "../src/render/SurfaceComputeKernel.js";

function nearlyEqual(actual, expected, tolerance = 1e-5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} within ${tolerance}`);
}

function staticConfig(manager) {
  return {
    origin: { ...manager.origin },
    baseElevationMeters: manager.baseElevationMeters,
    earthState: manager.earthState,
    branchSeed: manager.branchSeed,
    geomorphologyPatch: manager.geomorphologyPatch,
    chunkSizeKm: manager.chunkSizeKm,
    radius: manager.radius,
    segments: manager.segments,
    verticalScale: manager.verticalScale,
    biomeGroundColor: manager.biomeProfile?.groundColor ?? null
  };
}

test("surface worker terrain kernel preserves main-thread terrain sampling", () => {
  const scene = new THREE.Scene();
  const manager = new TerrainChunkManager(scene, { chunkSizeKm: 2, radius: 2, segments: 8, verticalScale: 0.55 });
  manager.setOrigin(12.25, 36.5);
  const config = staticConfig(manager);

  for (const [x, z] of [[0, 0], [0.75, -0.4], [-1.4, 1.25], [2.8, -2.2]]) {
    nearlyEqual(surfaceHeightAt(config, x, z), manager.heightAt(x, z), 1e-9);
  }

  const expectedMesh = manager._createChunk(0, 0);
  const actual = buildTerrainChunkData(config, 0, 0);
  const expectedPosition = expectedMesh.geometry.getAttribute("position").array;
  const expectedColor = expectedMesh.geometry.getAttribute("color").array;
  const expectedElevation = expectedMesh.geometry.getAttribute("elevationMeters").array;
  const expectedIndex = expectedMesh.geometry.getIndex().array;

  assert.equal(actual.positions.length, expectedPosition.length);
  assert.equal(actual.colors.length, expectedColor.length);
  assert.equal(actual.elevations.length, expectedElevation.length);
  assert.equal(actual.indices.length, expectedIndex.length);
  for (let i = 0; i < actual.positions.length; i += 1) nearlyEqual(actual.positions[i], expectedPosition[i], 1e-6);
  for (let i = 0; i < actual.colors.length; i += 1) nearlyEqual(actual.colors[i], expectedColor[i], 1e-6);
  for (let i = 0; i < actual.elevations.length; i += 1) nearlyEqual(actual.elevations[i], expectedElevation[i], 1e-4);
  assert.deepEqual([...actual.indices], [...expectedIndex]);
  assert.equal(actual.normals.length, actual.positions.length);
  manager.dispose();
});

test("worker ecology planning is deterministic for an identical scientific context", () => {
  const scene = new THREE.Scene();
  const manager = new TerrainChunkManager(scene, { chunkSizeKm: 2, radius: 2, segments: 8, verticalScale: 0.55 });
  manager.setOrigin(-3.5, 24.25);
  const config = staticConfig(manager);
  const payload = {
    chunkX: 0,
    chunkZ: 0,
    profile: { grassDensity: 0.8, treeDensity: 0.4, shrubDensity: 0.5, rockDensity: 0.2 },
    quality: 0.82,
    waterLevelKm: -Infinity
  };
  const first = buildEcologyChunkPlan(config, payload);
  const second = buildEcologyChunkPlan(config, payload);
  for (const key of Object.keys(first)) assert.deepEqual([...first[key]], [...second[key]]);
  assert.ok(first.grass.length > 0);
  assert.ok(first.trunk.length > 0);
  assert.equal(first.trunk.length % 7, 0);
  assert.equal(first.crown.length, first.trunk.length);
  manager.dispose();
});

test("centennial surface epochs visibly advance ecological succession", () => {
  const scene = new THREE.Scene();
  const manager = new TerrainChunkManager(scene, { chunkSizeKm: 84, radius: 2, segments: 12, verticalScale: 2.4 });
  manager.setOrigin(9.6, -73.9);
  const base = {
    ...staticConfig(manager),
    surfaceVisualDrivers: {
      lai: 4.8,
      npp: 1450,
      runoffMmPerYear: 780,
      treeDensity: 0.72,
      grassDensity: 0.55,
      shrubDensity: 0.32
    }
  };
  const first = buildTerrainChunkData({ ...base, earthState: { elapsedYears: 400, seaLevel: 0 } }, 0, 0);
  const second = buildTerrainChunkData({ ...base, earthState: { elapsedYears: 800, seaLevel: 0 } }, 0, 0);
  let colorDelta = 0;
  for (let index = 0; index < first.colors.length; index += 1) colorDelta += Math.abs(first.colors[index] - second.colors[index]);
  assert.ok(colorDelta > 2.5, `expected visible epoch color change, received ${colorDelta}`);
  manager.dispose();
});
