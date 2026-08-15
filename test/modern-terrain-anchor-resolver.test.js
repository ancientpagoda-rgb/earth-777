import test from "node:test";
import assert from "node:assert/strict";
import { bedrockElevationAt } from "../src/data/generated/etopo-2022.generated.js";
import {
  BATHYMETRY_SOURCE_CLASS,
  gebcoTidSourceClass,
  MODERN_TERRAIN_ANCHOR_POLICY,
  resolveModernTerrainAnchor
} from "../src/reconstruction/ModernTerrainAnchorResolver.js";
import {
  terrain777BedrockSample,
  terrain777BedrockSampleFromEvidence
} from "../src/reconstruction/TerrainReconstruction777.js";

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("GEBCO 2026 TID classes preserve direct versus derived provenance", () => {
  assert.equal(gebcoTidSourceClass(11), BATHYMETRY_SOURCE_CLASS.MULTIBEAM);
  assert.equal(gebcoTidSourceClass(15), BATHYMETRY_SOURCE_CLASS.LIDAR);
  assert.equal(gebcoTidSourceClass(17), BATHYMETRY_SOURCE_CLASS.DIRECT_MIXED);
  assert.equal(gebcoTidSourceClass(40), BATHYMETRY_SOURCE_CLASS.PREDICTED);
  assert.equal(gebcoTidSourceClass(41), BATHYMETRY_SOURCE_CLASS.INTERPOLATED);
  assert.equal(gebcoTidSourceClass(47), BATHYMETRY_SOURCE_CLASS.INDIRECT_OBSERVED);
  assert.equal(gebcoTidSourceClass(70), BATHYMETRY_SOURCE_CLASS.MIXED_GRID);
  assert.equal(gebcoTidSourceClass(71), BATHYMETRY_SOURCE_CLASS.UNKNOWN);
});

test("direct multibeam anchor outranks comparable predicted bathymetry", () => {
  const result = resolveModernTerrainAnchor([
    { sourceId: "gebco-2026", value: -1800, tid: 40, sigmaMeters: 30, resolutionMeters: 450 },
    { sourceId: "gmrt-4.5.0", value: -1825, sourceClass: BATHYMETRY_SOURCE_CLASS.MULTIBEAM, sigmaMeters: 30, resolutionMeters: 100 }
  ], { latitude: 20, longitude: -140 });
  assert.equal(result.policy, MODERN_TERRAIN_ANCHOR_POLICY);
  assert.equal(result.selected.sourceId, "gmrt-4.5.0");
  assert.ok(result.ranked[0].anchorScore > result.ranked[1].anchorScore);
});

test("solid-bed polar anchor is preferred over modern ice-surface candidate", () => {
  const result = resolveModernTerrainAnchor([
    { sourceId: "rema-mosaic-v2", value: 2200, sigmaMeters: 4, resolutionMeters: 2 },
    { sourceId: "bedmachine-antarctica-v4", value: -350, sigmaMeters: 80, resolutionMeters: 500, sourceClass: BATHYMETRY_SOURCE_CLASS.DIRECT_MIXED }
  ], { latitude: -78, longitude: 110 });
  assert.equal(result.selected.sourceId, "bedmachine-antarctica-v4");
});

test("ETOPO remains deterministic fallback when no refined local anchor exists", () => {
  const lat = 38.97;
  const lon = -95.23;
  const sample = terrain777BedrockSample(lat, lon);
  near(sample.modernElevationMeters, bedrockElevationAt(lat, lon));
  assert.equal(sample.selectedModernAnchorSourceId, "etopo-2022");
  assert.equal(sample.modernAnchorResolution.candidateCount, 1);
});

test("numeric field-compatible modern evidence can replace ETOPO without becoming direct paleo evidence", () => {
  const lat = 20;
  const lon = -140;
  const etopo = bedrockElevationAt(lat, lon);
  const refined = etopo - 120;
  const sample = terrain777BedrockSampleFromEvidence(lat, lon, [{
    sourceId: "gmrt-4.5.0:tile:test",
    archiveSourceId: "gmrt-4.5.0",
    field: "bedrockElevationMeters",
    relation: "modern-spatial-anchor",
    value: refined,
    sigma: 15,
    resolutionMeters: 100,
    sourceClass: BATHYMETRY_SOURCE_CLASS.MULTIBEAM,
    sourceQuality: 0.93
  }]);
  assert.equal(sample.numericModernAnchorCandidateCount, 1);
  assert.equal(sample.selectedModernAnchorSourceId, "gmrt-4.5.0:tile:test");
  near(sample.modernElevationMeters, refined);
  near(sample.reconstructedElevationMeters, refined);
  assert.equal(sample.estimates.some((estimate) => estimate.stream === "paleo-observation"), false);
});

test("correlated modern candidates are selected, not inverse-variance fused", () => {
  const result = resolveModernTerrainAnchor([
    { sourceId: "etopo-2022", value: -1000, sigmaMeters: 20, resolutionMeters: 450 },
    { sourceId: "gebco-2026", value: -1100, sigmaMeters: 20, resolutionMeters: 450, tid: 11 }
  ], { latitude: 5, longitude: 160 });
  assert.equal(result.selected.value, -1100);
  assert.notEqual(result.selected.value, -1050);
  assert.match(result.rule, /do not statistically fuse/i);
});
