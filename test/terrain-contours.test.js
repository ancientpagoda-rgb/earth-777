import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { TerrainChunkManager } from "../src/render/TerrainChunkManager.js";

test("close-detail contours use readable spacing and contrast", () => {
  const manager = new TerrainChunkManager(new THREE.Scene(), { segments: 24 });
  manager.configure({ segments: 24 });
  const diagnostics = manager.diagnostics();
  assert.equal(diagnostics.contourIntervalMeters, 10);
  assert.ok(diagnostics.contourOpacity >= 0.5);
  assert.equal(diagnostics.contourMajorEvery, 5);
  assert.equal(diagnostics.contoursFollowDisplayedTerrain, true);
  manager.dispose();
});

test("contour elevation follows the same microrelief that shapes the rendered mesh", () => {
  const manager = new TerrainChunkManager(new THREE.Scene(), { chunkSizeKm: 2, segments: 18, verticalScale: 0.55 });
  manager.origin = { latitude: 38.97, longitude: -95.23 };
  manager.baseElevationMeters = 100;
  manager._elevationAt = () => 100;
  manager._channelIncisionMeters = () => 0;
  const mesh = manager._createChunk(0, 0);
  const elevation = mesh.geometry.getAttribute("elevationMeters");
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < elevation.count; index += 1) {
    minimum = Math.min(minimum, elevation.getX(index));
    maximum = Math.max(maximum, elevation.getX(index));
  }
  assert.ok(maximum - minimum > 3, `expected displayed microrelief in contour coordinate, got ${maximum - minimum} m`);
  mesh.geometry.dispose();
  manager.dispose();
});

test("shader emphasizes major contours and uses the revised program key", () => {
  const source = readFileSync(new URL("../src/render/TerrainChunkManager.js", import.meta.url), "utf8");
  assert.match(source, /majorContour/);
  assert.match(source, /mod\(contourIndex, 5\.0\)/);
  assert.match(source, /terrain-contours-v2/);
  assert.match(source, /displayedElevationMeters/);
});
