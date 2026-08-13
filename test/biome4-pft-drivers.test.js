import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { Biome4PftDriverLayer, BIOME4_PFT_DRIVERS_META } from "../src/data/biome4-pft-drivers.js";
import { evaluateBiome4PftClimateEligibility } from "../src/sim/Biome4PftEligibility.js";
import { biome4MaximumSnowDepth, BIOME4_SNOW_POLICY } from "../src/sim/Biome4Snow.js";

const raw = gunzipSync(readFileSync(new URL("../public/data/biome4-pft-drivers.bin.gz", import.meta.url)));
const drivers = new Biome4PftDriverLayer(raw);

function firstValidCell() {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let index = 0; index < BIOME4_PFT_DRIVERS_META.rows * BIOME4_PFT_DRIVERS_META.cols; index += 1) {
    const value = view.getInt16(index * 2, true);
    if (value === BIOME4_PFT_DRIVERS_META.tmin.missingValue) continue;
    const row = Math.floor(index / BIOME4_PFT_DRIVERS_META.cols);
    const col = index % BIOME4_PFT_DRIVERS_META.cols;
    return {
      raw: value,
      latitude: BIOME4_PFT_DRIVERS_META.northLatitude - row * BIOME4_PFT_DRIVERS_META.spacingDegrees,
      longitude: BIOME4_PFT_DRIVERS_META.westLongitude + col * BIOME4_PFT_DRIVERS_META.spacingDegrees
    };
  }
  return null;
}

test("BIOME4 tmin driver preserves the pinned source int16 and operational /10 scale", () => {
  assert.equal(BIOME4_PFT_DRIVERS_META.uncompressedBytes, 518_400);
  assert.equal(BIOME4_PFT_DRIVERS_META.compressedBytes, 90_813);
  assert.equal(BIOME4_PFT_DRIVERS_META.assetSha256, "084b7ac85ea60888acfe647a6315fce68acf376f8ac5d470d0a1f55e5a0d78c9");
  const cell = firstValidCell();
  assert.ok(cell);
  const sample = drivers.absoluteMinimumTemperatureAt(cell.latitude, cell.longitude);
  assert.ok(sample);
  assert.equal(sample.rawTenthCelsius, cell.raw);
  assert.equal(sample.temperatureCelsius, cell.raw / 10);
});

test("BIOME4 snow reproduction is deterministic and resolves the snow-dependent tundra-shrub gate", () => {
  const temperature = [-20,-18,-10,0,5,10,12,10,5,0,-10,-18];
  const precipitation = Array(12).fill(1200);
  const snowA = biome4MaximumSnowDepth(temperature, precipitation);
  const snowB = biome4MaximumSnowDepth(temperature, precipitation);
  assert.equal(snowA.policy, BIOME4_SNOW_POLICY);
  assert.equal(snowA.maximumSnowDepthModelUnits, snowB.maximumSnowDepthModelUnits);
  assert.ok(snowA.maximumSnowDepthModelUnits > 15);

  const result = evaluateBiome4PftClimateEligibility(temperature, {
    absoluteMinimumTemperatureCelsius: -25,
    maximumSnowDepthModelUnits: snowA.maximumSnowDepthModelUnits
  });
  const tundraShrub = result.evaluations.find((entry) => entry.id === 11);
  assert.equal(tundraShrub.status, "eligible");
  assert.equal(tundraShrub.unresolvedConstraints.length, 0);
});
