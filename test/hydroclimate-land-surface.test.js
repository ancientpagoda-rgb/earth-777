import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { LAND_SURFACE_FEEDBACK_POLICY } from "../src/sim/LandSurfaceFeedback.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";

const compressed = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
const climate = new Krapp777ClimateLayer(gunzipSync(compressed));
const vegetation = Object.freeze({
  annualAt() {
    return Object.freeze({ lai: 3.2, npp: 700, biomeCode: 1, biomeLabel: "test canopy" });
  }
});

function branchState(overrides = {}) {
  const checkpoint = checkpointState();
  return {
    ...checkpoint,
    elapsedYears: 15_000,
    yearBP: checkpoint.yearBP - 15_000,
    temperatureAnomaly: checkpoint.temperatureAnomaly + 1.3,
    oceanTemperatureAnomaly: checkpoint.temperatureAnomaly + 0.7,
    productivityIndex: 1.25,
    tectonicTimeMyr: 0.015,
    tectonicBoundaryActivity: 1,
    ...overrides
  };
}

test("hydroclimate enables a deterministic two-pass solve when checkpoint vegetation is attached", () => {
  const state = branchState();
  const uncoupled = new SpatialHydroClimate(climate);
  const coupled = new SpatialHydroClimate(climate);
  assert.equal(coupled.setCheckpointVegetation(vegetation), true);
  const first = coupled.sample(state, 12, 22, 0.65);
  const repeated = coupled.sample(state, 12, 22, 0.65);
  const control = uncoupled.sample(state, 12, 22, 0.65);
  assert.deepEqual(first, repeated);
  assert.equal(first.landSurfacePolicy, LAND_SURFACE_FEEDBACK_POLICY);
  assert.equal(first.landSurfaceFeedbackActive, true);
  assert.ok(Number.isFinite(first.estimatedVegetationLai));
  assert.ok(Number.isFinite(first.vegetationCoverFraction));
  assert.notDeepEqual(
    [first.temperatureCelsius, first.precipitationMmPerYear, first.landMoistureRecycling],
    [control.temperatureCelsius, control.precipitationMmPerYear, control.landMoistureRecycling]
  );
  const diagnostics = coupled.diagnostics(state, 0.65);
  assert.equal(diagnostics.landSurfaceFeedbackEnabled, true);
  assert.equal(diagnostics.landSurfaceSolvePasses, 2);
});

test("attaching vegetation never changes the exact 777 ka checkpoint climate", () => {
  const state = checkpointState();
  const field = new SpatialHydroClimate(climate);
  field.setCheckpointVegetation(vegetation);
  const sample = field.sample(state, 12, 22, 0.65);
  const baseline = climate.annualAt(sample.latitude, sample.longitude);
  assert.equal(sample.landSurfaceFeedbackActive, false);
  assert.equal(sample.temperatureCelsius, Number(baseline.temperatureCelsius.toFixed(3)));
  assert.equal(sample.precipitationMmPerYear, baseline.precipitationMmPerYear);
  assert.equal(sample.cloudCoverPercent, baseline.cloudCoverPercent);
});
