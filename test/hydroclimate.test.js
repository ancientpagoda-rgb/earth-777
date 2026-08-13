import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import {
  HYDROCLIMATE_POLICY,
  SpatialHydroClimate,
  gridSpacingForSpatialDetail
} from "../src/sim/SpatialHydroClimate.js";
import { regionalState } from "../src/sim/regional-state.js";

const compressed = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
const climate = new Krapp777ClimateLayer(gunzipSync(compressed));

function materializer() {
  return new SpatialHydroClimate(climate);
}

test("CWF spatial detail maps to bounded hydroclimate grid spacing", () => {
  assert.equal(gridSpacingForSpatialDetail(0), 4);
  assert.equal(gridSpacingForSpatialDetail(0.35), 2);
  assert.equal(gridSpacingForSpatialDetail(0.65), 1);
  assert.equal(gridSpacingForSpatialDetail(1), 0.5);
});

test("checkpoint materialization preserves Krapp climate at its selected grid cell", () => {
  const state = checkpointState();
  const field = materializer();
  const sample = field.sample(state, 0, 20, 0.35);
  assert.ok(sample);
  assert.equal(sample.policy, HYDROCLIMATE_POLICY);
  assert.equal(sample.gridSpacingDegrees, 2);
  const baseline = climate.annualAt(sample.latitude, sample.longitude);
  assert.ok(baseline);
  assert.ok(Math.abs(sample.temperatureCelsius - baseline.temperatureCelsius) < 0.002);
  assert.ok(Math.abs(sample.precipitationMmPerYear - baseline.precipitationMmPerYear) < 0.02);
  assert.ok(Math.abs(sample.cloudCoverPercent - baseline.cloudCoverPercent) < 0.02);
  assert.match(sample.epistemicStatus, /study-constrained Krapp checkpoint/);
});

test("Free Earth warming produces deterministic spatial hydroclimate divergence", () => {
  const checkpoint = checkpointState();
  const branch = {
    ...checkpoint,
    elapsedYears: 10_000,
    yearBP: checkpoint.yearBP - 10_000,
    temperatureAnomaly: checkpoint.temperatureAnomaly + 2
  };
  const first = materializer().sample(branch, 0, 20, 0.65);
  const second = materializer().sample(branch, 0, 20, 0.65);
  const baseline = materializer().sample(checkpoint, 0, 20, 0.65);
  assert.deepEqual(first, second);
  assert.ok(first.temperatureCelsius > baseline.temperatureCelsius + 1.5);
  assert.ok(first.precipitationMmPerYear > baseline.precipitationMmPerYear);
  assert.ok(first.precipitationScale > 1);
  assert.match(first.epistemicStatus, /model derived branch response/);
});

test("additional high-latitude ice suppresses modeled precipitation response", () => {
  const checkpoint = checkpointState();
  const warm = {
    ...checkpoint,
    elapsedYears: 5_000,
    temperatureAnomaly: checkpoint.temperatureAnomaly + 1.5
  };
  const icy = { ...warm, iceIndex: checkpoint.iceIndex + 0.35 };
  const field = materializer();
  const warmSample = field.sample(warm, 60, 20, 0.65);
  const icySample = field.sample(icy, 60, 20, 0.65);
  if (warmSample && icySample) {
    assert.ok(icySample.precipitationScale < warmSample.precipitationScale);
  }
});

test("regional inspection consumes gridded hydroclimate and exposes resolution", () => {
  const checkpoint = checkpointState();
  const branch = {
    ...checkpoint,
    elapsedYears: 2_500,
    temperatureAnomaly: checkpoint.temperatureAnomaly + 0.8
  };
  const field = materializer();
  const region = regionalState(branch, 0, 20, {
    climateLayer: climate,
    hydroClimate: field,
    spatialDetail: 0.85
  });
  assert.equal(region.gridSpacingDegrees, 0.5);
  assert.equal(region.hydroClimatePolicy, HYDROCLIMATE_POLICY);
  assert.ok(Number.isFinite(region.runoffPotential));
  assert.match(region.confidence, /model-derived gridded branch response/);
});
