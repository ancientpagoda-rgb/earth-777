import test from "node:test";
import assert from "node:assert/strict";

import {
  RECONSTRUCTION_ASSIMILATION_POLICY,
  assimilateReconstructionScalar,
  reconstructionMethodSummary
} from "../src/reconstruction/ReconstructionAssimilation.js";

test("modern Earth enters 777 ka reconstruction only through an explicit hindcast transform", () => {
  const result = assimilateReconstructionScalar({
    field: "elevationMeters",
    modernAnchor: { value: 441, sigma: 2, sourceId: "modern-dem" },
    hindcastCorrection: { value: -15, sigma: 8, sourceId: "geomorphic-hindcast", method: "uplift-erosion-hindcast" }
  });
  assert.equal(result.policy, RECONSTRUCTION_ASSIMILATION_POLICY);
  assert.equal(result.value, 426);
  assert.ok(Math.abs(result.sigma - Math.hypot(2, 8)) < 1e-12);
  assert.equal(reconstructionMethodSummary(result), "modern-data hindcast");
});

test("paleo evidence and modern-data hindcast fuse into a bidirectionally constrained estimate", () => {
  const result = assimilateReconstructionScalar({
    field: "elevationMeters",
    modernAnchor: { value: 441, sigma: 2, sourceId: "modern-dem" },
    hindcastCorrection: { value: -15, sigma: 8, sourceId: "geomorphic-hindcast" },
    paleoConstraints: [
      { value: 420, sigma: 4, sourceId: "dated-paleo-elevation", method: "proxy-observation" }
    ],
    historicalCalibration: [
      { parameter: "erosionRate", value: 0.00004, sigma: 0.00001, sourceId: "historical-survey" }
    ]
  });
  assert.ok(result.value > 419 && result.value < 426);
  assert.ok(result.sigma < 4);
  assert.equal(result.historicalCalibration.length, 1);
  assert.equal(reconstructionMethodSummary(result), "bidirectionally constrained");
});

test("historical trends are calibration evidence, never naive 777 kyr extrapolation", () => {
  const result = assimilateReconstructionScalar({
    field: "channelPositionMeters",
    modernAnchor: { value: 100, sigma: 1, sourceId: "modern-channel" },
    historicalCalibration: [
      { parameter: "channelMigrationMetersPerYear", value: 2, sigma: 0.5, sourceId: "historical-map-series" }
    ]
  });
  assert.equal(result.value, null);
  assert.equal(result.estimates.length, 0);
  assert.equal(result.historicalCalibration.length, 1);
  assert.match(result.caveat, /not linearly projected/i);
});

test("model completion remains explicitly lower-confidence when no observational constraint exists", () => {
  const result = assimilateReconstructionScalar({
    field: "soilDepthMeters",
    modelCompletion: { value: 0.8, sigma: 0.35, sourceId: "pedogenesis-model" }
  });
  assert.equal(result.value, 0.8);
  assert.equal(reconstructionMethodSummary(result), "model completion");
  assert.ok(result.confidence < 0.3);
});

test("same evidence produces exactly the same reconstruction", () => {
  const input = {
    field: "annualPrecipitationMm",
    modernAnchor: { value: 780, sigma: 25, sourceId: "modern-climate" },
    hindcastCorrection: { value: 90, sigma: 70, sourceId: "climate-hindcast" },
    paleoConstraints: [
      { value: 845, sigma: 55, sourceId: "paleo-proxy-a" },
      { value: 900, sigma: 95, sourceId: "paleo-proxy-b" }
    ]
  };
  assert.deepEqual(assimilateReconstructionScalar(input), assimilateReconstructionScalar(input));
});
