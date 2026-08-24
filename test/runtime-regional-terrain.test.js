import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildRegionalTerrainUrl,
  parseRegionalTerrainAscii,
  regionalTerrainFeatherWeightAt,
  regionalTerrainValueAt
} from "../src/reconstruction/RuntimeRegionalTerrainPatch.js";

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
  const start = source.indexOf("  _queueVisibleTerrainRefresh() {");
  const end = source.indexOf("\n  _queueConcentricLodRefresh()", start);
  assert.ok(start >= 0 && end > start);
  const refresh = source.slice(start, end);
  assert.match(refresh, /for \(let dz = -this\.radius; dz <= this\.radius/);
  assert.match(refresh, /for \(let dx = -this\.radius; dx <= this\.radius/);
  assert.doesNotMatch(refresh, /_chunkOverlapsRegionalTerrainPatch/);
});
