import test from "node:test";
import assert from "node:assert/strict";
import {
  GIA_777_MODEL_REFERENCE,
  gia777BedrockHindcastComponent,
  gia777RelativeSeaLevelSample,
  gia777SeaSurfaceDatum,
  unresolvedGia777Sample
} from "../src/reconstruction/GlacialIsostaticAdjustment777.js";
import {
  ICE_777_INCEPTION_REGIONS,
  ICE_777_SOURCES,
  assertIceThicknessEvidence,
  ice777EvidenceSummary
} from "../src/reconstruction/IceReconstructionEvidence777.js";
import { reconstructionDatasetBySourceId } from "../src/reconstruction/ReconstructionDatasetCatalog.js";

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("GIA relative sea level follows sea-surface minus solid-Earth sign convention", () => {
  const sample = gia777RelativeSeaLevelSample({
    globalEustaticMetersVsModern: -12.76,
    globalEustaticSigmaMeters: 9.52,
    solidEarthTargetMinusModernMeters: 8,
    solidEarthSigmaMeters: 2,
    localSeaSurfaceTargetMinusEustaticMeters: 3,
    localSeaSurfaceSigmaMeters: 1,
    sourceId: "synthetic-sle-run",
    solverExecuted: true
  });
  near(sample.localGiaCorrectionMeters, -5);
  near(sample.relativeSeaLevelMetersVsModern, -17.76);
  near(sample.targetSeaSurfaceMetersVsModern, -9.76);
  near(sample.sigmaMeters, Math.hypot(9.52, 2, 1));
  assert.equal(sample.status, "externally-solved-local-gia");
});

test("unresolved GIA defaults are neutral numerically but uncertainty-incomplete", () => {
  const sample = unresolvedGia777Sample();
  near(sample.relativeSeaLevelMetersVsModern, -12.76);
  near(sample.localGiaCorrectionMeters, 0);
  assert.equal(sample.sigmaMeters, null);
  assert.equal(sample.targetSeaSurfaceSigmaMeters, null);
  assert.equal(sample.solverExecuted, false);
  assert.equal(sample.status, "global-eustatic-only-local-gia-unresolved");
  assert.match(sample.note, /not evidence that GIA was zero/i);
});

test("matched GIA exports separate solid-bed and sea-surface application", () => {
  const sample = gia777RelativeSeaLevelSample({
    solidEarthTargetMinusModernMeters: -6,
    solidEarthSigmaMeters: 2.5,
    localSeaSurfaceTargetMinusEustaticMeters: 1.5,
    localSeaSurfaceSigmaMeters: 1.2,
    sourceId: "selen4:test-run",
    method: "test self-consistent sea-level equation output",
    solverExecuted: true
  });
  const bed = gia777BedrockHindcastComponent(sample);
  const sea = gia777SeaSurfaceDatum(sample);
  near(bed.value, -6);
  near(bed.sigma, 2.5);
  near(sea.meanMetersVsModern, -11.26);
  near(sea.sigmaMeters, Math.hypot(9.52, 1.2));
  assert.equal(bed.stream, "physics-hindcast");
  assert.equal(sea.solverExecuted, true);
});

test("SELEN4 is a framework reference, not a claimed executed Earth 777 run", () => {
  assert.equal(GIA_777_MODEL_REFERENCE.sourceId, "selen4");
  assert.equal(GIA_777_MODEL_REFERENCE.doi, "10.5194/gmd-12-5055-2019");
  const catalog = reconstructionDatasetBySourceId("selen4");
  assert.ok(catalog);
  assert.equal(catalog.direct777Constraint, false);
  assert.match(catalog.targetRelation, /requires-explicit-run/);
});

test("Ruddiman MIS19 inception evidence cannot masquerade as ice thickness", () => {
  assert.equal(ICE_777_SOURCES.ruddiman2018.dynamicIceSheetSimulated, false);
  assert.equal(ICE_777_SOURCES.ruddiman2018.directIceThicknessConstraint, false);
  assert.ok(ICE_777_INCEPTION_REGIONS.length >= 3);
  assert.equal(ICE_777_INCEPTION_REGIONS.every((entry) => entry.directIceThicknessMeters == null), true);
  assert.equal(ice777EvidenceSummary().directThicknessConstraintCount, 0);
  assert.equal(assertIceThicknessEvidence({ iceThicknessMeters: 1200 }), false);
  assert.equal(assertIceThicknessEvidence({ iceThicknessMeters: 1200, transformedToTargetIceLoad: true }), true);
});

test("Ruddiman catalog advertises inception validation without adding ice thickness field", () => {
  const catalog = reconstructionDatasetBySourceId("ruddiman-2018-mis19");
  assert.ok(catalog.fields.includes("glacialInceptionEvidence"));
  assert.ok(catalog.fields.includes("persistentSnow"));
  assert.equal(catalog.fields.includes("iceThicknessMeters"), false);
  assert.match(catalog.note, /did not evolve a dynamic ice sheet/i);
});
