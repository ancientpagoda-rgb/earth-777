import test from "node:test";
import assert from "node:assert/strict";
import { bedrockElevationAt } from "../src/data/generated/etopo-2022.generated.js";
import {
  reconstructedBedrockElevation777At,
  terrain777BedrockSample,
  TERRAIN_777_RECONSTRUCTION_POLICY
} from "../src/reconstruction/TerrainReconstruction777.js";

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("default terrain reconstruction uses ETOPO as the unresolved global fallback", () => {
  const latitude = 38.9;
  const longitude = -95.2;
  const modern = bedrockElevationAt(latitude, longitude);
  const sample = terrain777BedrockSample(latitude, longitude);
  assert.equal(sample.policy, TERRAIN_777_RECONSTRUCTION_POLICY);
  close(sample.modernElevationMeters, modern);
  close(sample.reconstructedElevationMeters, modern);
  assert.equal(sample.modernAnchorSourceId, "etopo-2022");
  assert.equal(sample.modernAnchorReplacementUsed, false);
  assert.equal(sample.reconstructionStatus, "provisional-modern-anchor-awaiting-local-hindcast");
  assert.equal(sample.provenance.modernAnchor.sourceId, "etopo-2022");
  assert.equal(sample.provenance.hindcastCorrection.sourceId, "terrain-hindcast-unresolved-v1");
  assert.equal(sample.sigma, null);
  assert.match(sample.epistemicStatus, /best available modern solid-surface anchor/i);
  assert.match(sample.epistemicStatus, /explicit hindcast transform/i);
});

test("an explicit hindcast correction changes the target-epoch terrain estimate without inventing complete uncertainty", () => {
  const latitude = 46;
  const longitude = 8;
  const modern = bedrockElevationAt(latitude, longitude);
  const sample = terrain777BedrockSample(latitude, longitude, {
    hindcastCorrection: {
      value: -42,
      sigma: 18,
      sourceId: "synthetic-hindcast-test",
      method: "test uplift reversal"
    }
  });
  close(sample.reconstructedElevationMeters, modern - 42);
  assert.equal(sample.reconstructionStatus, "assimilated-target-epoch-terrain");
  assert.equal(sample.sigma, null);
});

test("paleo target evidence fuses only when local modern-anchor uncertainty is explicitly supplied", () => {
  const latitude = 10;
  const longitude = 20;
  const modern = bedrockElevationAt(latitude, longitude);
  const transformedValue = modern + 30;
  const paleoValue = transformedValue + 20;
  const modernSigma = 4;
  const correctionSigma = 20;
  const transformedSigma = Math.hypot(modernSigma, correctionSigma);
  const sample = terrain777BedrockSample(latitude, longitude, {
    modernAnchorSigmaMeters: modernSigma,
    hindcastCorrection: { value: 30, sigma: correctionSigma, sourceId: "hindcast-test", method: "test" },
    paleoConstraints: [{ value: paleoValue, sigma: 10, sourceId: "paleo-test", method: "dated target evidence" }]
  });
  const expected = (transformedValue / (transformedSigma ** 2) + paleoValue / (10 ** 2))
    / (1 / (transformedSigma ** 2) + 1 / (10 ** 2));
  close(sample.reconstructedElevationMeters, expected);
  assert.equal(sample.reconstructionMethod, "bidirectionally constrained");
  assert.equal(sample.estimates.some((entry) => entry.sourceId === "paleo-test"), true);
});

test("historical calibration does not directly move terrain without a process hindcast", () => {
  const latitude = -30;
  const longitude = 120;
  const modern = bedrockElevationAt(latitude, longitude);
  const sample = terrain777BedrockSample(latitude, longitude, {
    historicalCalibration: [{ parameter: "uplift-rate", value: 0.2, sigma: 0.05, sourceId: "historical-test" }]
  });
  close(sample.reconstructedElevationMeters, modern);
  assert.equal(sample.historicalCalibration.length, 1);
});

test("elevation convenience sampler resolves through the reconstruction service", () => {
  const latitude = 0;
  const longitude = 0;
  close(reconstructedBedrockElevation777At(latitude, longitude), terrain777BedrockSample(latitude, longitude).reconstructedElevationMeters);
});
