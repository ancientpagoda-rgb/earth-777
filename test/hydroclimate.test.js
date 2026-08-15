import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { GENERAL_ATMOSPHERE_POLICY } from "../src/sim/GeneralAtmosphereCirculation.js";
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

function branchState(overrides = {}) {
  const checkpoint = checkpointState();
  return {
    ...checkpoint,
    elapsedYears: 10_000,
    yearBP: checkpoint.yearBP - 10_000,
    oceanTemperatureAnomaly: checkpoint.temperatureAnomaly,
    tectonicTimeMyr: 0.01,
    tectonicBoundaryActivity: 1,
    productivityIndex: 1,
    ...overrides
  };
}

test("CWF spatial detail maps to bounded hydroclimate grid spacing", () => {
  assert.equal(gridSpacingForSpatialDetail(0), 4);
  assert.equal(gridSpacingForSpatialDetail(0.35), 2);
  assert.equal(gridSpacingForSpatialDetail(0.65), 1);
  assert.equal(gridSpacingForSpatialDetail(1), 0.5);
});

test("checkpoint materialization preserves Krapp climate exactly while atmosphere anomaly is zero", () => {
  const state = checkpointState();
  const field = materializer();
  const sample = field.sample(state, 0, 20, 0.35);
  assert.ok(sample);
  assert.equal(sample.policy, HYDROCLIMATE_POLICY);
  assert.equal(sample.atmospherePolicy, GENERAL_ATMOSPHERE_POLICY);
  assert.equal(sample.gridSpacingDegrees, 2);
  const baseline = climate.annualAt(sample.latitude, sample.longitude);
  assert.ok(baseline);
  assert.ok(Math.abs(sample.temperatureCelsius - baseline.temperatureCelsius) < 0.002);
  assert.ok(Math.abs(sample.precipitationMmPerYear - baseline.precipitationMmPerYear) < 0.02);
  assert.ok(Math.abs(sample.cloudCoverPercent - baseline.cloudCoverPercent) < 0.02);
  assert.equal(sample.precipitationScale, 1);
  assert.match(sample.epistemicStatus, /study-constrained Krapp checkpoint/);
});

test("Free Earth branch hydroclimate diverges deterministically through general circulation", () => {
  const checkpoint = checkpointState();
  const branch = branchState({
    temperatureAnomaly: checkpoint.temperatureAnomaly + 2,
    oceanTemperatureAnomaly: checkpoint.temperatureAnomaly + 1,
    eccentricity: Math.max(0.01, checkpoint.eccentricity * 1.25),
    precession: checkpoint.precession + 95
  });
  const first = materializer().sample(branch, 18, 20, 0.65);
  const second = materializer().sample(branch, 18, 20, 0.65);
  const baseline = materializer().sample(checkpoint, 18, 20, 0.65);
  assert.deepEqual(first, second);
  assert.ok(first.temperatureCelsius > baseline.temperatureCelsius + 1);
  assert.notEqual(first.precipitationMmPerYear, baseline.precipitationMmPerYear);
  assert.notEqual(first.precipitationScale, 1);
  assert.ok(Number.isFinite(first.windEastMs));
  assert.ok(Number.isFinite(first.windNorthMs));
  assert.ok(Number.isFinite(first.itczLatitude));
  assert.ok(Number.isFinite(first.oceanMoistureFetch));
  assert.match(first.epistemicStatus, /general atmosphere response/);
});

test("orbital geometry can redistribute rainfall without a prescribed regional target", () => {
  const checkpoint = checkpointState();
  const firstState = branchState({ eccentricity: 0.04, obliquity: 24.2, precession: 25 });
  const secondState = { ...firstState, precession: 205 };
  const field = materializer();
  const first = field.sample(firstState, 22, 30, 0.85);
  const second = field.sample(secondState, 22, 30, 0.85);
  assert.ok(first && second);
  assert.notEqual(first.precipitationMmPerYear, second.precipitationMmPerYear);
  assert.notEqual(first.wettestMonthIndex, second.wettestMonthIndex);
  assert.ok(Number.isFinite(first.subtropicalSubsidence));
  assert.ok(Number.isFinite(second.subtropicalSubsidence));
  assert.notDeepEqual(
    [first.windEastMs, first.windNorthMs, first.itczLatitude],
    [second.windEastMs, second.windNorthMs, second.itczLatitude]
  );
  assert.notEqual(checkpoint.precession, secondState.precession);
});

test("hydroclimate diagnostics declare mechanisms and no geographic special cases", () => {
  const diagnostics = materializer().diagnostics(branchState(), 0.65);
  assert.equal(diagnostics.atmospherePolicy, GENERAL_ATMOSPHERE_POLICY);
  assert.equal(diagnostics.geographicSpecialCases, 0);
  assert.ok(diagnostics.mechanisms.includes("Hadley/ITCZ migration"));
  assert.ok(diagnostics.mechanisms.includes("orographic lift and rain shadow"));
});

test("regional inspection consumes generalized gridded hydroclimate and exposes resolution", () => {
  const branch = branchState({ temperatureAnomaly: checkpointState().temperatureAnomaly + 0.8 });
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
