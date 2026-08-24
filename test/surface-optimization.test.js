import test from "node:test";
import assert from "node:assert/strict";
import { SurfaceChunkCache } from "../src/render/SurfaceChunkCache.js";
import { TerrainEpochMorpher } from "../src/render/TerrainEpochMorpher.js";
import { gridIndicesForSegments } from "../src/render/TerrainGridTopology.js";
import { buildTerrainChunkData } from "../src/render/SurfaceComputeKernel.js";

function attribute(values, itemSize) {
  return { array: new Float32Array(values), itemSize, needsUpdate: false };
}

function fakeMesh(value) {
  const attributes = {
    position: attribute([0, value, 0, 1, value, 0], 3),
    normal: attribute([0, 1, 0, 0, 1, 0], 3),
    color: attribute([value, 0, 0, value, 0, 0], 3),
    elevationMeters: attribute([value, value], 1)
  };
  return {
    userData: { epoch: value },
    geometry: {
      attributes,
      disposed: false,
      getAttribute(name) { return this.attributes[name]; },
      computeBoundingSphere() {},
      dispose() { this.disposed = true; }
    }
  };
}

function cacheResult(seed = 1) {
  return {
    positions: new Float32Array([0, seed, 0]),
    colors: new Float32Array([seed, 0, 0]),
    elevations: new Float32Array([seed]),
    indices: new Uint32Array([0]),
    normals: new Float32Array([0, 1, 0]),
    segments: 8,
    hydrology: { streamVertexCount: seed }
  };
}

test("terrain grid topology is reused by segment count", () => {
  const first = gridIndicesForSegments(8);
  const second = gridIndicesForSegments(8);
  assert.equal(first, second);
  assert.equal(first.length, 8 * 8 * 6);
});

test("surface chunk cache returns isolated typed-array copies", async () => {
  const cache = new SurfaceChunkCache({ memoryLimit: 2 });
  cache.put("epoch-a", cacheResult(3));
  const first = await cache.get("epoch-a");
  first.positions[1] = 99;
  const second = await cache.get("epoch-a");
  assert.equal(second.positions[1], 3);
  assert.equal(cache.diagnostics().memoryHits, 2);
});

test("terrain epoch morphing reuses the visible mesh and reaches its target", () => {
  const current = fakeMesh(0);
  const target = fakeMesh(10);
  const morpher = new TerrainEpochMorpher({ durationMs: 1_000 });
  assert.equal(morpher.start("0:0", current, target, { now: 100, durationMs: 1_000 }), true);
  morpher.update(600, { isCurrent: () => true });
  assert.ok(current.geometry.getAttribute("position").array[1] > 0);
  assert.ok(current.geometry.getAttribute("position").array[1] < 10);
  morpher.update(1_100, { isCurrent: () => true });
  assert.equal(current.geometry.getAttribute("position").array[1], 10);
  assert.equal(target.geometry.disposed, true);
  assert.equal(morpher.hasWork(), false);
});

test("surface terrain couples elapsed time and runoff into evolving relief", () => {
  const config = {
    origin: { latitude: 39, longitude: -96 },
    baseElevationMeters: 320,
    earthState: { elapsedYears: 0, seaLevel: 0 },
    branchSeed: 777001,
    geomorphologyPatch: null,
    regionalTerrainPatch: null,
    regionalTerrainPatches: [],
    chunkSizeKm: 8,
    radius: 2,
    segments: 8,
    verticalScale: 1,
    biomeGroundColor: [0.3, 0.4, 0.2],
    surfaceVisualDrivers: { runoffMmPerYear: 850, lai: 4, npp: 900, treeDensity: 0.6 }
  };
  const checkpoint = buildTerrainChunkData(config, 0, 0);
  const evolved = buildTerrainChunkData({ ...config, earthState: { ...config.earthState, elapsedYears: 20_000 } }, 0, 0);
  assert.notDeepEqual([...checkpoint.elevations], [...evolved.elevations]);
  assert.equal(evolved.hydrology.policy, checkpoint.hydrology.policy);
});
