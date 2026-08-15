import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import {
  LAND_SURFACE_FEEDBACK_POLICY,
  landSurfaceFeedbackAt
} from "../src/sim/LandSurfaceFeedback.js";
import { atmosphericCirculationAt } from "../src/sim/GeneralAtmosphereCirculation.js";

function evolvedState(overrides = {}) {
  const checkpoint = checkpointState();
  return {
    ...checkpoint,
    elapsedYears: 12_000,
    yearBP: checkpoint.yearBP - 12_000,
    productivityIndex: 1,
    oceanTemperatureAnomaly: checkpoint.temperatureAnomaly,
    ...overrides
  };
}

const vegetation = Object.freeze({ lai: 2.8, npp: 650 });
const checkpointClimate = Object.freeze({
  temperatureCelsius: 20,
  precipitationMmPerYear: 900,
  cloudCoverPercent: 48
});

test("land-surface feedback is exactly neutral at the calibrated checkpoint", () => {
  const state = checkpointState();
  const feedback = landSurfaceFeedbackAt(state, vegetation, checkpointClimate, checkpointClimate);
  assert.equal(feedback.policy, LAND_SURFACE_FEEDBACK_POLICY);
  assert.equal(feedback.active, false);
  assert.equal(feedback.surfaceAlbedoDelta, 0);
  assert.equal(feedback.evaporativeFractionDelta, 0);
  assert.equal(feedback.roughnessLogRatio, 0);
  assert.equal(feedback.moistureRecyclingRatio, 1);
});

test("wetter productive land increases cover, evapotranspiration and recycling without a category switch", () => {
  const state = evolvedState({ productivityIndex: 1.35 });
  const feedback = landSurfaceFeedbackAt(state, vegetation, checkpointClimate, {
    temperatureCelsius: 20.5,
    precipitationMmPerYear: 1400,
    cloudCoverPercent: 55
  });
  assert.equal(feedback.active, true);
  assert.ok(feedback.estimatedLai > feedback.checkpointLai);
  assert.ok(feedback.vegetationCover > feedback.checkpointVegetationCover);
  assert.ok(feedback.evaporativeFractionDelta > 0);
  assert.ok(feedback.moistureRecyclingRatio > 1);
});

test("drying land reduces cover and recycling and changes atmospheric solution deterministically", () => {
  const state = evolvedState({ productivityIndex: 0.62 });
  const feedback = landSurfaceFeedbackAt(state, vegetation, checkpointClimate, {
    temperatureCelsius: 24,
    precipitationMmPerYear: 280,
    cloudCoverPercent: 28
  });
  assert.ok(feedback.estimatedLai < feedback.checkpointLai);
  assert.ok(feedback.moistureRecyclingRatio < 1);
  const withoutFeedback = atmosphericCirculationAt(state, 6, 18, 20, checkpointClimate);
  const withFeedback = atmosphericCirculationAt(state, 6, 18, 20, checkpointClimate, feedback);
  const repeated = atmosphericCirculationAt(state, 6, 18, 20, checkpointClimate, feedback);
  assert.deepEqual(withFeedback, repeated);
  assert.equal(withFeedback.landSurfacePolicy, LAND_SURFACE_FEEDBACK_POLICY);
  assert.equal(withFeedback.landSurfaceFeedbackActive, true);
  assert.notEqual(withFeedback.moistureSupplyIndex, withoutFeedback.moistureSupplyIndex);
  assert.notEqual(withFeedback.thermalIndex, withoutFeedback.thermalIndex);
});

test("land-surface implementation contains no named geographic outcome special cases", () => {
  const source = readFileSync(new URL("../src/sim/LandSurfaceFeedback.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Africa|Sahara|India|Amazon|Australia|Greenland/i);
  assert.match(source, /without geographic outcome rules/);
});
