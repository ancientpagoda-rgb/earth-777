import test from "node:test";
import assert from "node:assert/strict";
import {
  ICE_DENSITY_KG_M3,
  iceLoad777VolumeClosure,
  normalizeIceLoad777Cell,
  validateIceLoad777Grid
} from "../src/reconstruction/SpatialIceLoad777.js";
import {
  normalizeGia777OutputCell,
  normalizeGia777RunMetadata,
  validateGia777OutputCache
} from "../src/reconstruction/GiaSolverOutputCache777.js";
import {
  cachedGia777At,
  cachedIceLoad777At,
  iceGia777CacheStatus
} from "../src/reconstruction/IceGiaSpatialCache777.js";

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("numeric ice thickness is rejected unless explicitly authorized as a 777 ka load", () => {
  const raw = normalizeIceLoad777Cell({ latitude: 70, longitude: -40, iceThicknessMeters: 900, cellAreaM2: 1e6 });
  assert.equal(raw.targetEligible, false);
  assert.equal(raw.iceVolumeM3, null);
  const transformed = normalizeIceLoad777Cell({
    latitude: 70,
    longitude: -40,
    iceThicknessMeters: 900,
    sigmaMeters: 50,
    cellAreaM2: 1e6,
    transformedToTargetIceLoad: true,
    modelId: "ice-model",
    runId: "777-test"
  });
  assert.equal(transformed.targetEligible, true);
  near(transformed.iceVolumeM3, 9e8);
  near(transformed.iceMassKg, 9e8 * ICE_DENSITY_KG_M3);
});

test("missing ice cells stay unknown rather than being filled with zero", () => {
  const grid = validateIceLoad777Grid([]);
  assert.equal(grid.eligibleCellCount, 0);
  assert.equal(grid.totalKnownIceVolumeM3, null);
  assert.equal(grid.volumeClosureAvailable, false);
});

test("ice-volume closure requires explicit complete coverage and target", () => {
  const grid = validateIceLoad777Grid([{ iceThicknessMeters: 100, cellAreaM2: 2e6, transformedToTargetIceLoad: true }]);
  const partial = iceLoad777VolumeClosure(grid, { targetSeaLevelEquivalentVolumeM3: 2.2e8, coverageFraction: 0.5 });
  assert.equal(partial.residualM3, null);
  const complete = iceLoad777VolumeClosure(grid, { targetSeaLevelEquivalentVolumeM3: 2.2e8, targetSeaLevelEquivalentSigmaM3: 1e7, coverageFraction: 1 });
  near(complete.modeledIceVolumeM3, 2e8);
  near(complete.residualM3, -2e7);
  near(complete.normalizedResidualSigma, -2);
});

const validRun = {
  solverId: "selen4",
  solverVersion: "4",
  solverSourceDoi: "10.5194/gmd-12-5055-2019",
  runId: "earth777-synthetic-test",
  targetYearBP: 777000,
  iceHistoryId: "ice-history-test",
  earthModelId: "earth-rheology-test",
  configurationHash: "sha256:test"
};

test("GIA numeric fields require complete run provenance before target assimilation", () => {
  const incomplete = normalizeGia777OutputCell({ solidEarthTargetMinusModernMeters: 5, localSeaSurfaceTargetMinusEustaticMeters: 2 }, { solverId: "selen4" });
  assert.equal(incomplete.targetEligible, false);
  assert.equal(incomplete.status, "numeric-output-with-incomplete-run-provenance");
  const complete = normalizeGia777OutputCell({
    latitude: 60,
    longitude: -20,
    solidEarthTargetMinusModernMeters: 5,
    localSeaSurfaceTargetMinusEustaticMeters: 2,
    solidEarthSigmaMeters: 1,
    localSeaSurfaceSigmaMeters: 0.5
  }, validRun);
  assert.equal(complete.targetEligible, true);
  assert.equal(complete.sample.solverExecuted, true);
  near(complete.sample.localGiaCorrectionMeters, -3);
});

test("GIA run metadata requires target age, ice history, Earth model and configuration hash", () => {
  assert.equal(normalizeGia777RunMetadata(validRun).validForTargetAssimilation, true);
  assert.equal(normalizeGia777RunMetadata({ ...validRun, iceHistoryId: null }).validForTargetAssimilation, false);
  assert.equal(normalizeGia777RunMetadata({ ...validRun, targetYearBP: 776000 }).validForTargetAssimilation, false);
});

test("GIA cache validation rejects undocumented outputs", () => {
  const records = [{ solidEarthTargetMinusModernMeters: -2, localSeaSurfaceTargetMinusEustaticMeters: 1 }];
  assert.equal(validateGia777OutputCache(records, {}).eligibleCellCount, 0);
  assert.equal(validateGia777OutputCache(records, validRun).eligibleCellCount, 1);
});

test("generated runtime cache starts unresolved, not zero-valued", () => {
  const status = iceGia777CacheStatus();
  assert.equal(status.status, "unresolved-no-spatial-cache");
  assert.equal(status.hasIceCoverage, false);
  assert.equal(status.hasGiaCoverage, false);
  assert.equal(cachedIceLoad777At(70, -40), null);
  assert.equal(cachedGia777At(70, -40), null);
  assert.match(status.meta.epistemicRule, /must not be interpreted as zero ice thickness/i);
});
