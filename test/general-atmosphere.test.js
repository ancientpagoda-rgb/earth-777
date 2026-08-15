import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import {
  GENERAL_ATMOSPHERE_POLICY,
  atmosphericCirculationAt,
  branchAtmosphereResponseAt,
  dailyMeanInsolationIndex,
  dynamicSurfaceElevationMeters
} from "../src/sim/GeneralAtmosphereCirculation.js";

function evolvedState(overrides = {}) {
  const checkpoint = checkpointState();
  return {
    ...checkpoint,
    elapsedYears: 20_000,
    yearBP: checkpoint.yearBP - 20_000,
    oceanTemperatureAnomaly: checkpoint.temperatureAnomaly,
    tectonicTimeMyr: 0.02,
    tectonicBoundaryActivity: 1,
    productivityIndex: 1,
    ...overrides
  };
}

test("general atmosphere preserves the calibrated checkpoint as zero branch anomaly", () => {
  const checkpoint = checkpointState();
  const response = branchAtmosphereResponseAt(checkpoint, 6, 18, 34, {
    precipitationMmPerYear: 620,
    cloudCoverPercent: 45
  });
  assert.equal(response.precipitationScale, 1);
  assert.equal(response.temperatureDeltaCelsius, 0);
  assert.equal(response.cloudDeltaPercent, 0);
  assert.equal(response.current.policy, GENERAL_ATMOSPHERE_POLICY);
});

test("orbital seasonality migrates tropical ascent rather than pinning an ITCZ latitude", () => {
  const state = evolvedState();
  const northernSummer = atmosphericCirculationAt(state, 5, 5, 20, { precipitationMmPerYear: 900 });
  const northernWinter = atmosphericCirculationAt(state, 11, 5, 20, { precipitationMmPerYear: 900 });
  assert.ok(northernSummer.itczLatitude > northernWinter.itczLatitude + 8);
  assert.notEqual(dailyMeanInsolationIndex(state, 5, 25), dailyMeanInsolationIndex(state, 11, 25));
});

test("changing orbital geometry changes circulation and rainfall without changing a geography rule", () => {
  const base = evolvedState({ eccentricity: 0.035, obliquity: 24.1, precession: 40 });
  const shifted = { ...base, precession: 220 };
  const first = branchAtmosphereResponseAt(base, 5, 22, 32, { precipitationMmPerYear: 500, cloudCoverPercent: 35 });
  const second = branchAtmosphereResponseAt(shifted, 5, 22, 32, { precipitationMmPerYear: 500, cloudCoverPercent: 35 });
  assert.notEqual(first.current.insolationIndex, second.current.insolationIndex);
  assert.notEqual(first.current.precipitationPotential, second.current.precipitationPotential);
  assert.notEqual(first.precipitationScale, second.precipitationScale);
});

test("surface winds include finite thermal pressure-gradient flow and moisture transport", () => {
  const state = evolvedState({ temperatureAnomaly: 0.4, oceanTemperatureAnomaly: -0.2 });
  const samples = [
    atmosphericCirculationAt(state, 5, 18, -18, { precipitationMmPerYear: 700 }),
    atmosphericCirculationAt(state, 5, 18, 72, { precipitationMmPerYear: 700 }),
    atmosphericCirculationAt(state, 5, -18, 145, { precipitationMmPerYear: 700 })
  ];
  assert.ok(samples.every((sample) => Number.isFinite(sample.windEastMs) && Number.isFinite(sample.windNorthMs)));
  assert.ok(samples.every((sample) => Number.isFinite(sample.oceanMoistureFetch) && sample.oceanMoistureFetch >= 0 && sample.oceanMoistureFetch <= 1));
  assert.ok(samples.some((sample) => Math.abs(sample.pressureGradientEastMs) + Math.abs(sample.pressureGradientNorthMs) > 0.05));
});

test("orography and dynamic tectonic elevation enter the same atmospheric solution", () => {
  const state = evolvedState({ tectonicTimeMyr: 0.5, tectonicBoundaryActivity: 1.2 });
  const elevation = dynamicSurfaceElevationMeters(state, 35, 75);
  const sample = atmosphericCirculationAt(state, 5, 35, 75, { precipitationMmPerYear: 800 });
  assert.ok(Number.isFinite(elevation));
  assert.ok(Number.isFinite(sample.orographicLift));
  assert.ok(Number.isFinite(sample.rainShadow));
  assert.ok(sample.orographicLift >= 0);
  assert.ok(sample.rainShadow >= 0);
});

test("general atmosphere is deterministic for identical state and coordinates", () => {
  const state = evolvedState({ eccentricity: 0.03, obliquity: 23.8, precession: 123 });
  const first = atmosphericCirculationAt(state, 8, -12.5, 108.2, { precipitationMmPerYear: 1100 });
  const second = atmosphericCirculationAt(state, 8, -12.5, 108.2, { precipitationMmPerYear: 1100 });
  assert.deepEqual(first, second);
});

test("atmosphere implementation contains no named geographic outcome special cases", () => {
  const source = readFileSync(new URL("../src/sim/GeneralAtmosphereCirculation.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Africa|Sahara|India|Amazon|Australia|Greenland/i);
  assert.match(source, /no geographic outcome is hard-coded/);
});
