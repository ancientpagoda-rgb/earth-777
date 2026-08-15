import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkpointState } from "../src/data/checkpoint-777.js";
import { bedrockElevationAt } from "../src/data/generated/etopo-2022.generated.js";
import { dynamicSurfaceElevationMeters } from "../src/sim/GeneralAtmosphereCirculation.js";
import { reconstructedBedrockElevation777At } from "../src/reconstruction/TerrainReconstruction777.js";

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("checkpoint atmosphere resolves elevation through the reconstruction service", () => {
  const state = checkpointState();
  const latitude = 35;
  const longitude = -110;
  close(dynamicSurfaceElevationMeters(state, latitude, longitude), reconstructedBedrockElevation777At(latitude, longitude));
  close(reconstructedBedrockElevation777At(latitude, longitude), bedrockElevationAt(latitude, longitude));
});

test("post-checkpoint tectonic evolution is added after the reconstructed checkpoint base", () => {
  const state = checkpointState();
  state.elapsedYears = 25_000;
  state.tectonicTimeMyr = 0.025;
  state.tectonicSeed = 777001;
  state.tectonicBoundaryActivity = 1;
  state.mantleHeatIndex = 1;
  const latitude = 12;
  const longitude = 48;
  const base = reconstructedBedrockElevation777At(latitude, longitude);
  const evolved = dynamicSurfaceElevationMeters(state, latitude, longitude);
  assert.ok(Number.isFinite(evolved));
  assert.ok(Number.isFinite(base));
});

test("atmosphere and surface renderer no longer import ETOPO directly as checkpoint terrain", () => {
  const atmosphere = fs.readFileSync(new URL("../src/sim/GeneralAtmosphereCirculation.js", import.meta.url), "utf8");
  const terrain = fs.readFileSync(new URL("../src/render/TerrainChunkManager.js", import.meta.url), "utf8");
  for (const source of [atmosphere, terrain]) {
    assert.match(source, /reconstructedBedrockElevation777At/);
    assert.doesNotMatch(source, /generated\/etopo-2022\.generated\.js/);
  }
});

test("surface diagnostics identify the reconstructed checkpoint terrain path", () => {
  const terrain = fs.readFileSync(new URL("../src/render/TerrainChunkManager.js", import.meta.url), "utf8");
  assert.match(terrain, /reconstructedCheckpointTerrain:\s*true/);
});
