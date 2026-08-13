import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Biome4SoilLayer, BIOME4_SOIL_META } from "../src/data/biome4-soil.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { Krapp777VegetationLayer } from "../src/data/krapp-777-vegetation.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import { MassConservingHydrology } from "../src/sim/MassConservingHydrology.js";
import { SpatialVegetation } from "../src/sim/SpatialVegetation.js";

const soilRaw = gunzipSync(readFileSync(new URL("../public/data/biome4-soil.bin.gz", import.meta.url)));
const climateRaw = gunzipSync(readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url)));
const vegetationRaw = gunzipSync(readFileSync(new URL("../public/data/krapp-777-vegetation.bin.gz", import.meta.url)));
const soil = new Biome4SoilLayer(soilRaw);
const climate = new Krapp777ClimateLayer(climateRaw);
const vegetation = new Krapp777VegetationLayer(vegetationRaw);
const state = checkpointState();
const hydrology = new MassConservingHydrology(new SpatialHydroClimate(climate), soil);
const spatial = new SpatialVegetation(vegetation, hydrology);

function firstJointCell() {
  const statusOffset = BIOME4_SOIL_META.status.byteOffset;
  const count = BIOME4_SOIL_META.rows * BIOME4_SOIL_META.cols;
  for (let index = 0; index < count; index += 1) {
    if (soilRaw[statusOffset + index] !== 0) continue;
    const row = Math.floor(index / BIOME4_SOIL_META.cols);
    const col = index % BIOME4_SOIL_META.cols;
    const latitude = BIOME4_SOIL_META.northLatitude - row * BIOME4_SOIL_META.spacingDegrees;
    const longitude = BIOME4_SOIL_META.westLongitude + col * BIOME4_SOIL_META.spacingDegrees;
    if (!vegetation.annualAt(latitude, longitude)) continue;
    const trace = hydrology.dailyWaterTrace(state, latitude, longitude, 0.9);
    if (trace?.dailyWaterTrace?.length === 365) return { latitude, longitude, trace };
  }
  throw new Error("No joint BIOME4 soil/climate/vegetation cell with a daily trace found");
}

const joint = firstJointCell();

test("real BIOME4 soil produces a conserved opt-in 365-day PFT water trace", () => {
  assert.equal(joint.trace.soilProfileApplied, true);
  assert.equal(joint.trace.dailyWaterTrace.length, 365);
  assert.ok(Math.abs(joint.trace.waterBalanceResidualMm) < 1e-6);
  assert.equal(joint.trace.monthlyTemperatureCelsius.length, 12);
  assert.equal(joint.trace.monthlyCloudCoverPercent.length, 12);
});

test("normal vegetation sampling remains lightweight and keeps the published category", () => {
  const sample = spatial.sample(state, joint.latitude, joint.longitude, 0.9);
  assert.ok(sample);
  assert.equal(sample.checkpointCategoryRetained, true);
  assert.equal("daily" in sample, false);
  assert.equal("dailyWaterTrace" in sample, false);
});

test("selected-region PFT diagnostics consume the conserved trace without enabling biome transitions", () => {
  const baseline = spatial.sample(state, joint.latitude, joint.longitude, 0.9);
  const diagnostics = spatial.pftDiagnostics(state, joint.latitude, joint.longitude, 0.9);
  assert.ok(diagnostics);
  assert.equal(diagnostics.status, "resolved");
  assert.equal(diagnostics.biomeCode, baseline.biomeCode);
  assert.equal(diagnostics.checkpointCategoryRetained, true);
  assert.equal(diagnostics.hydrologyFeedbackEnabled, false);
  assert.equal(diagnostics.parallelVirtualHydrologyEnabled, true);
  assert.equal(diagnostics.laiNppOptimizationEnabled, true);
  assert.equal(diagnostics.competitiveOccupancyEnabled, false);
  for (const candidate of diagnostics.candidates) {
    if (!candidate.virtualHydrology) continue;
    assert.ok(Math.abs(candidate.virtualHydrology.massBalanceResidualMm) < 1e-6);
    assert.equal(candidate.virtualHydrology.sharedHydrologyMutated, false);
    if (candidate.climateEligibilityStatus === "eligible") {
      assert.ok(candidate.laiNppOptimization);
      assert.equal(candidate.laiNppOptimization.evaluationCount, 16);
      assert.equal(candidate.laiNppOptimization.checkpointCategoryMutationEnabled, false);
      assert.ok(Number.isFinite(candidate.laiNppOptimization.optimumNpp));
      assert.ok(candidate.laiNppOptimization.optimumLai >= 0);
    } else {
      assert.equal(candidate.laiNppOptimization, null);
    }
  }
  assert.ok(diagnostics.candidateCount >= diagnostics.resolvedCount);
  assert.ok(Array.isArray(diagnostics.candidates));
  assert.ok(diagnostics.candidates.every((candidate) => candidate.pftId > 0));
  assert.ok(diagnostics.candidates.every((candidate) => candidate.status === "resolved-diagnostic"));
});

test("PFT diagnostics are deterministic and cached separately from lightweight vegetation samples", () => {
  const first = spatial.pftDiagnostics(state, joint.latitude, joint.longitude, 0.9);
  const second = spatial.pftDiagnostics(state, joint.latitude, joint.longitude, 0.9);
  assert.equal(first, second);
  const info = spatial.diagnostics(state, 0.9);
  assert.equal(info.pftWaterPhenologyIntegrated, true);
  assert.equal(info.pftHydrologyFeedbackEnabled, false);
  assert.equal(info.pftLaiNppOptimizationIntegrated, true);
  assert.equal(info.pftCompetitionEnabled, false);
  assert.equal(info.categoricalBiomeTransitionsEnabled, false);
  assert.ok(info.cachedPftDiagnostics >= 1);
});
