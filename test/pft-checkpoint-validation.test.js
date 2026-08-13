import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { Biome4PftDriverLayer } from "../src/data/biome4-pft-drivers.js";
import { Biome4SoilLayer } from "../src/data/biome4-soil.js";
import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { Krapp777VegetationLayer } from "../src/data/krapp-777-vegetation.js";
import { validateBiome4CheckpointCell } from "../src/sim/Biome4CheckpointValidation.js";
import { MassConservingHydrology } from "../src/sim/MassConservingHydrology.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import { SpatialVegetation } from "../src/sim/SpatialVegetation.js";

const climate = new Krapp777ClimateLayer(gunzipSync(readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url))));
const vegetation = new Krapp777VegetationLayer(gunzipSync(readFileSync(new URL("../public/data/krapp-777-vegetation.bin.gz", import.meta.url))));
const soil = new Biome4SoilLayer(gunzipSync(readFileSync(new URL("../public/data/biome4-soil.bin.gz", import.meta.url))));
const drivers = new Biome4PftDriverLayer(gunzipSync(readFileSync(new URL("../public/data/biome4-pft-drivers.bin.gz", import.meta.url))));
const state = checkpointState();
const hydrology = new MassConservingHydrology(new SpatialHydroClimate(climate), soil);
const spatial = new SpatialVegetation(vegetation, hydrology, drivers);

test("checkpoint classifier probe stays diagnostic on real 777 ka inputs", () => {
  const latitude = 39;
  const longitude = -95;
  const annual = spatial.sample(state, latitude, longitude, 0.9);
  const diagnostics = spatial.pftDiagnostics(state, latitude, longitude, 0.9);
  const trace = hydrology.dailyWaterTrace(state, latitude, longitude, 0.9);
  assert.ok(annual && diagnostics?.status === "resolved" && trace?.monthlyPrecipitationMmPerYear);
  const result = validateBiome4CheckpointCell({
    annualVegetation: annual,
    pftDiagnostics: diagnostics,
    monthlyPrecipitationMmPerYear: trace.monthlyPrecipitationMmPerYear
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.appliedToVegetation, false);
  assert.equal(result.checkpointCategoryMutationEnabled, false);
  assert.ok(result.publishedBiomeCode >= 1 && result.publishedBiomeCode <= 28);
  assert.ok(result.predictedBiomeCode >= 0 && result.predictedBiomeCode <= 28);
  assert.equal(typeof result.checkpointMatch, "boolean");
  console.log("BIOME4 checkpoint probe", JSON.stringify({ published: result.publishedBiomeCode, predicted: result.predictedBiomeCode, match: result.checkpointMatch, rule: result.classifier.rule }));
});
