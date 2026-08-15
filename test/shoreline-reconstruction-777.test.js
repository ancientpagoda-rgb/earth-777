import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  shoreline777CheckpointConsistency,
  shoreline777Sample,
  SHORELINE_777_SOURCE
} from "../src/reconstruction/ShorelineReconstruction777.js";
import {
  terrainProcessEvidenceBySourceId,
  terrainHistoricalCalibrationRecords
} from "../src/reconstruction/TerrainProcessEvidence777.js";
import { terrain777BedrockSample } from "../src/reconstruction/TerrainReconstruction777.js";

test("published 777 ka sea-level datum matches the checkpoint", () => {
  const consistency = shoreline777CheckpointConsistency();
  assert.equal(consistency.meanMatchesCheckpoint, true);
  assert.equal(consistency.sigmaMatchesCheckpoint, true);
  assert.equal(SHORELINE_777_SOURCE.meanMetersVsModern, -12.76);
  assert.equal(SHORELINE_777_SOURCE.sigmaMeters, 9.52);
  assert.equal(SHORELINE_777_SOURCE.lower95MetersVsModern, -33.06);
  assert.equal(SHORELINE_777_SOURCE.upper95MetersVsModern, 4.17);
});

test("shoreline classification preserves the published uncertainty band", () => {
  assert.equal(shoreline777Sample(10).confidenceClass, "robust-land");
  assert.equal(shoreline777Sample(-40).confidenceClass, "robust-ocean");
  const median = shoreline777Sample(-12.76);
  assert.equal(median.confidenceClass, "uncertain-shoreline");
  assert.ok(Math.abs(median.landProbability - 0.5) < 1e-5);
  assert.equal(shoreline777Sample(0).confidenceClass, "uncertain-shoreline");
});

test("terrain samples carry shoreline confidence without changing reconstructed bedrock", () => {
  const sample = terrain777BedrockSample(0, 0);
  assert.ok(sample.shoreline);
  assert.equal(sample.shoreline.elevationMeters, sample.reconstructedElevationMeters);
  assert.equal(sample.medianLandAt777ka, sample.shoreline.medianLand);
  assert.equal(sample.shorelineConfidenceClass, sample.shoreline.confidenceClass);
});

test("published uplift and erosion records remain process calibration, not direct terrain deltas", () => {
  const california = terrainProcessEvidenceBySourceId("delong-2017-northern-california");
  const italy = terrainProcessEvidenceBySourceId("cyr-granger-italy-uplift");
  assert.equal(california.calibrationOnly, true);
  assert.equal(california.canDirectlyMove777Terrain, false);
  assert.match(california.timeCoverage, /450-350 ka/);
  assert.equal(italy.calibrationOnly, true);
  assert.equal(italy.canDirectlyMove777Terrain, false);
  assert.match(italy.timeCoverage, /0.9 Ma/);
  assert.equal(terrainHistoricalCalibrationRecords().length >= 3, true);
});

test("Observation panel uses reconstructed terrain and exposes shoreline confidence", () => {
  const source = fs.readFileSync(new URL("../src/render/RegionPanel.js", import.meta.url), "utf8");
  assert.match(source, /terrain777BedrockSample/);
  assert.match(source, /shoreline uncertain/);
  assert.match(source, /land probability/);
  assert.doesNotMatch(source, /generated\/etopo-2022\.generated\.js/);
});
