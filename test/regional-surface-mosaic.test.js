import test from "node:test";
import assert from "node:assert/strict";
import { regionalLandCoverColorAt } from "../src/render/SurfaceComputeKernel.js";

const baseConfig = Object.freeze({
  origin: Object.freeze({ latitude: 38.9, longitude: -95.2 }),
  branchSeed: 777001,
  chunkSizeKm: 28,
  radius: 1,
  baseElevationMeters: 260,
  surfaceVisualDrivers: Object.freeze({
    lai: 4.2,
    npp: 1280,
    runoffMmPerYear: 520,
    treeDensity: 0.72,
    grassDensity: 0.58,
    shrubDensity: 0.42
  })
});

function colorAt(config, x, z, lakePresence = 0) {
  return regionalLandCoverColorAt(config, x, z, 38.9, 285, 25, [0.27, 0.36, 0.19], lakePresence);
}

test("regional land-cover mosaic is deterministic but spatially varied", () => {
  const first = colorAt(baseConfig, 2.5, -3.75);
  const repeated = colorAt(baseConfig, 2.5, -3.75);
  const nearby = colorAt(baseConfig, 11.5, 7.25);
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, nearby);
});

test("vegetation and runoff influence reconstructed aerial color", () => {
  const dry = colorAt({
    ...baseConfig,
    surfaceVisualDrivers: {
      lai: 0.4,
      npp: 110,
      runoffMmPerYear: 45,
      treeDensity: 0.05,
      grassDensity: 0.32,
      shrubDensity: 0.12
    }
  }, 4, 6);
  const wetForest = colorAt({
    ...baseConfig,
    surfaceVisualDrivers: {
      lai: 6.2,
      npp: 1950,
      runoffMmPerYear: 1050,
      treeDensity: 1.0,
      grassDensity: 0.48,
      shrubDensity: 0.7
    }
  }, 4, 6);
  assert.ok(wetForest[1] > wetForest[0], "wet forest should remain green-dominant");
  assert.ok(wetForest[0] < dry[0], "wet forest should be darker/less red than dry ground");
});

test("regional lake presence produces a water-colored surface without rectangular overlay geometry", () => {
  const land = colorAt(baseConfig, -6, 3, 0);
  const lake = colorAt(baseConfig, -6, 3, 1);
  assert.ok(lake[2] > land[2], "lake-covered vertex should gain blue/teal contribution");
  assert.ok(lake[0] < land[0], "lake-covered vertex should lose terrestrial red contribution");
});
