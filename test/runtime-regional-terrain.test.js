import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildRegionalTerrainUrl,
  parseRegionalTerrainAscii,
  regionalTerrainFeatherWeightAt,
  regionalTerrainResidualAtPatches,
  regionalTerrainValueAt
} from "../src/reconstruction/RuntimeRegionalTerrainPatch.js";
import { interpolatedEtopoBedrockElevationAt } from "../src/reconstruction/ModernTerrainAnchorSelector.js";

const GRID = `ncols 2\nnrows 2\nxllcorner 10\nyllcorner 20\ncellsize 1\nNODATA_value -9999\n100 200\n300 400\n`;

test("runtime regional terrain parses ArcASCII bounds and values", () => {
  const patch = parseRegionalTerrainAscii(GRID);
  assert.equal(patch.ncols, 2);
  assert.equal(patch.nrows, 2);
  assert.equal(patch.west, 10);
  assert.equal(patch.east, 12);
  assert.equal(patch.south, 20);
  assert.equal(patch.north, 22);
  assert.deepEqual([...patch.values], [100, 200, 300, 400]);
});

test("runtime regional terrain bilinearly samples between cells", () => {
  const patch = parseRegionalTerrainAscii(GRID);
  // 11E, 21N lies exactly between the four 1-degree cell centers.
  assert.equal(regionalTerrainValueAt(patch, 21, 11), 250);
  assert.equal(regionalTerrainValueAt(patch, 21.5, 10.5), 100);
  assert.equal(regionalTerrainValueAt(patch, 20.5, 11.5), 400);
});

test("runtime regional refinement fades to zero at patch boundaries", () => {
  const patch = {
    values: new Float32Array([1, 1, 1, 1]),
    cellsizeDegrees: 0.01,
    south: 0,
    north: 1,
    west: 0,
    east: 1
  };
  assert.equal(regionalTerrainFeatherWeightAt(patch, 0, 0.5), 0);
  assert.equal(regionalTerrainFeatherWeightAt(patch, 0.5, 0), 0);
  assert.ok(regionalTerrainFeatherWeightAt(patch, 0.5, 0.5) > 0.99);
  assert.ok(regionalTerrainFeatherWeightAt(patch, 0.04, 0.5) < regionalTerrainFeatherWeightAt(patch, 0.5, 0.5));
});

test("overlapping retained terrain patches blend without doubling relief", () => {
  const latitude = 1;
  const longitude = 1;
  const compact = interpolatedEtopoBedrockElevationAt(latitude, longitude);
  const patch = {
    values: new Float32Array(4).fill(compact + 240),
    ncols: 2,
    nrows: 2,
    cellsizeDegrees: 0.01,
    south: 0,
    north: 2,
    west: 0,
    east: 2
  };
  const one = regionalTerrainResidualAtPatches([patch], latitude, longitude);
  const overlap = regionalTerrainResidualAtPatches([patch, patch], latitude, longitude);
  assert.ok(Math.abs(one - 240) < 0.01);
  assert.ok(Math.abs(overlap - one) < 0.01);
});

test("runtime regional terrain URL requests a complete unmasked surface", () => {
  const url = new URL(buildRegionalTerrainUrl(8.8, -68.5, { spanDegrees: 1.5, resolutionMeters: 400 }));
  assert.equal(url.protocol, "https:");
  assert.equal(url.searchParams.get("layer"), "topo");
  assert.equal(url.searchParams.get("format"), "esriascii");
  assert.equal(url.searchParams.get("mresolution"), "400");
  assert.equal(Number(url.searchParams.get("north")) - Number(url.searchParams.get("south")), 1.5);
});

test("regional refinement refreshes the full visible terrain window", () => {
  const source = readFileSync(new URL("../src/render/WorkerSurfaceTerrainSystem.js", import.meta.url), "utf8");
  const start = source.indexOf("  _queueVisibleTerrainRefresh(");
  const end = source.indexOf("\n  _queueConcentricLodRefresh()", start);
  assert.ok(start >= 0 && end > start);
  const refresh = source.slice(start, end);
  assert.match(refresh, /radius = this\.radius/);
  assert.match(refresh, /for \(let dz = -refreshRadius; dz <= refreshRadius/);
  assert.match(refresh, /for \(let dx = -refreshRadius; dx <= refreshRadius/);
  assert.doesNotMatch(refresh, /_chunkOverlapsRegionalTerrainPatch/);
});

test("playback epochs refresh the camera core so evolution can recur", () => {
  const source = readFileSync(new URL("../src/render/WorkerSurfaceTerrainSystem.js", import.meta.url), "utf8");
  assert.match(source, /PLAYBACK_TERRAIN_REFRESH_RADIUS = 1/);
  assert.match(source, /radius: this\.playbackSpeed >= 1_000 \? 0 : PLAYBACK_TERRAIN_REFRESH_RADIUS/);
  assert.match(source, /reason: "playback-epoch"/);
});

test("regional refinement requests broad patches retained by the worker atlas", () => {
  const terrainSource = readFileSync(new URL("../src/render/WorkerSurfaceTerrainSystem.js", import.meta.url), "utf8");
  const workerSource = readFileSync(new URL("../src/render/surface-compute.worker.js", import.meta.url), "utf8");
  assert.match(terrainSource, /spanDegrees: 3\.0, resolutionMeters: 900/);
  assert.match(workerSource, /REGIONAL_TERRAIN_ATLAS_LIMIT = 6/);
  assert.match(workerSource, /regionalTerrainPatches\.push\(patch\)/);
});

test("regional refinement stages a complete terrain generation before swapping it onscreen", () => {
  const source = readFileSync(new URL("../src/render/WorkerSurfaceTerrainSystem.js", import.meta.url), "utf8");
  assert.match(source, /refreshBatchId = \+\+this\.terrainRefreshSerial/);
  assert.match(source, /batch\.meshes\.size < batch\.expectedKeys\.size/);
  assert.match(source, /_stageTerrainRefreshMesh\(candidate, mesh\)/);
  assert.match(source, /pendingAtomicRefreshes/);
});
