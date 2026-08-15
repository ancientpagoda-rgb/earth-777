import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const terrainSource = readFileSync(new URL("../src/render/TerrainChunkManager.js", import.meta.url), "utf8");
const surfaceSource = readFileSync(new URL("../src/render/SurfaceTerrainSystem.js", import.meta.url), "utf8");
const ecologySource = readFileSync(new URL("../src/render/SurfaceEcologyManager.js", import.meta.url), "utf8");
const hydrologySource = readFileSync(new URL("../src/sim/EarthSystemHydrology.js", import.meta.url), "utf8");

test("surface terrain projects scientific geomorphic offset and gradient before sub-grid presentation carving", () => {
  assert.match(hydrologySource, /SURFACE_GEOMORPHOLOGY_PATCH_POLICY/);
  assert.match(hydrologySource, /geomorphicGradientEastMetersPerKm/);
  assert.match(hydrologySource, /geomorphicGradientNorthMetersPerKm/);
  assert.match(surfaceSource, /surfaceGeomorphologyPatch/);
  assert.match(surfaceSource, /setGeomorphologyPatch/);
  assert.match(terrainSource, /_geomorphicOffsetAt/);
  assert.match(terrainSource, /tectonicElevationOffsetMeters[\s\S]*_geomorphicOffsetAt/);
});

test("local channel representation uses routed reach bearing and suppresses distant coarse-cell rivers", () => {
  assert.match(hydrologySource, /closestPointToOriginOnSegment/);
  assert.match(hydrologySource, /channelDistanceFromSelectionKm/);
  assert.match(terrainSource, /_channelIncisionMeters/);
  assert.match(terrainSource, /subgridChannelPresentation/);
  assert.match(ecologySource, /network-routed/);
  assert.match(ecologySource, /routeDistance > visibleReachKm/);
  assert.match(ecologySource, /channelBearingRadians/);
});

test("surface geomorphology remains outcome-agnostic", () => {
  for (const source of [terrainSource, surfaceSource, ecologySource, hydrologySource]) {
    assert.doesNotMatch(source, /Nile|Amazon|Mississippi|Ganges|Sahara|Caspian|Great Lakes/i);
  }
});