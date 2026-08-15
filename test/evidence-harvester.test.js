import test from "node:test";
import assert from "node:assert/strict";
import { bedrockElevationAt } from "../src/data/generated/etopo-2022.generated.js";
import {
  EVIDENCE_RELATIONS,
  harvestEvidence,
  rankEvidenceRecord
} from "../src/reconstruction/EvidenceHarvester.js";
import {
  terrain777BedrockSampleFromEvidence,
  TERRAIN_777_RECONSTRUCTION_POLICY
} from "../src/reconstruction/TerrainReconstruction777.js";
import {
  TOPOGRAPHY_EVIDENCE_SOURCES,
  topographyEvidenceSourceById
} from "../src/reconstruction/TopographyEvidenceSources.js";
import {
  normalizeTopographyEvidenceRecord,
  TOPOGRAPHY_EVIDENCE_HARVEST_POLICY
} from "../src/reconstruction/TopographyEvidenceHarvester.js";

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

const query = { targetYearBP: 777_000, latitude: 40, longitude: -120, field: "bedrockElevationMeters", uncertaintyScale: 100 };

test("direct target evidence outranks otherwise comparable modern/model evidence", () => {
  const records = [
    { sourceId: "direct", field: "bedrockElevationMeters", relation: EVIDENCE_RELATIONS.DIRECT_TARGET, ageBP: 777_000, value: 500, sigma: 20, latitude: 40, longitude: -120, sourceQuality: 0.9 },
    { sourceId: "modern", field: "bedrockElevationMeters", relation: EVIDENCE_RELATIONS.MODERN_ANCHOR, value: 520, sigma: 20, latitude: 40, longitude: -120, sourceQuality: 0.9 },
    { sourceId: "model", field: "bedrockElevationMeters", relation: EVIDENCE_RELATIONS.MODEL_COMPLETION, value: 480, sigma: 20, latitude: 40, longitude: -120, sourceQuality: 0.9 }
  ];
  const harvest = harvestEvidence(records, query);
  assert.equal(harvest.ranked[0].sourceId, "direct");
  assert.equal(harvest.targetConstraints.length, 1);
  assert.equal(harvest.modernAnchors.length, 1);
  assert.equal(harvest.modelCompletion.length, 1);
});

test("nearby paleo evidence is ranked but cannot alter 777 ka until transformed", () => {
  const modern = bedrockElevationAt(40, -120);
  const evidence = [{
    sourceId: "nearby-787ka-core",
    field: "bedrockElevationMeters",
    relation: EVIDENCE_RELATIONS.NEARBY_PALEO,
    ageBP: 787_000,
    ageSigmaYears: 500,
    value: modern + 250,
    sigma: 12,
    latitude: 40,
    longitude: -120,
    sourceQuality: 0.98
  }];
  const sample = terrain777BedrockSampleFromEvidence(40, -120, evidence);
  close(sample.reconstructedElevationMeters, modern);
  assert.equal(sample.assimilatedHarvestConstraintCount, 0);
  assert.equal(sample.nearbyUnassimilatedEvidenceCount, 1);
  assert.equal(sample.evidenceHarvest.ranked[0].targetEligible, false);
});

test("explicit target transformation makes a hindcast eligible without relabeling it as direct paleo observation", () => {
  const modern = bedrockElevationAt(40, -120);
  const evidence = [{
    sourceId: "physical-hindcast",
    field: "bedrockElevationMeters",
    relation: EVIDENCE_RELATIONS.TRANSFORMED_HINDCAST,
    transformedToTarget: true,
    value: modern - 60,
    sigma: 15,
    latitude: 40,
    longitude: -120,
    sourceQuality: 0.95,
    method: "closed uplift erosion GIA hindcast"
  }];
  const sample = terrain777BedrockSampleFromEvidence(40, -120, evidence, { modernAnchorSigmaMeters: 5 });
  assert.equal(sample.assimilatedHarvestConstraintCount, 1);
  assert.equal(sample.estimates.some((estimate) => estimate.sourceId === "physical-hindcast" && estimate.stream === "physics-hindcast"), true);
  assert.ok(sample.reconstructedElevationMeters < modern);
});

test("process calibration remains provenance and never becomes an elevation estimate", () => {
  const modern = bedrockElevationAt(40, -120);
  const evidence = [{
    sourceId: "terrace-uplift-rate",
    field: "rockUpliftRate",
    parameter: "rockUpliftRateMmPerYear",
    relation: EVIDENCE_RELATIONS.PROCESS_CALIBRATION,
    ageRangeBP: [80_000, 125_000],
    value: 0.3,
    sigma: 0.05,
    latitude: 40,
    longitude: -120,
    sourceQuality: 0.95
  }];
  const sample = terrain777BedrockSampleFromEvidence(40, -120, evidence);
  close(sample.reconstructedElevationMeters, modern);
  assert.equal(sample.calibrationRecordCount, 1);
  assert.equal(sample.historicalCalibration.some((entry) => entry.sourceId === "terrace-uplift-rate"), true);
  assert.equal(sample.estimates.some((entry) => entry.sourceId === "terrace-uplift-rate"), false);
});

test("spatial distance lowers otherwise identical evidence rank", () => {
  const local = rankEvidenceRecord({ sourceId: "local", relation: EVIDENCE_RELATIONS.DIRECT_TARGET, ageBP: 777_000, value: 10, sigma: 10, latitude: 40, longitude: -120, sourceQuality: 0.9 }, query);
  const remote = rankEvidenceRecord({ sourceId: "remote", relation: EVIDENCE_RELATIONS.DIRECT_TARGET, ageBP: 777_000, value: 10, sigma: 10, latitude: 45, longitude: -120, sourceQuality: 0.9 }, query);
  assert.ok(local.evidenceScore > remote.evidenceScore);
  assert.ok(remote.distanceKm > local.distanceKm);
});

test("missing coordinates remain unresolved rather than becoming zero-zero", () => {
  const ranked = rankEvidenceRecord({ sourceId: "unlocated", relation: EVIDENCE_RELATIONS.NEARBY_PALEO, ageBP: 777_000, value: 10, sigma: 10 }, { targetYearBP: 777_000 });
  assert.equal(ranked.distanceKm, null);
  assert.equal(ranked.scoreComponents.spatial, 0.72);
});

test("target-overlapping age intervals are eligible while non-overlapping intervals are not", () => {
  const records = [
    { sourceId: "overlap", relation: EVIDENCE_RELATIONS.TARGET_INTERVAL, ageRangeBP: [775_000, 779_000], value: 1, sigma: 1 },
    { sourceId: "miss", relation: EVIDENCE_RELATIONS.TARGET_INTERVAL, ageRangeBP: [760_000, 770_000], value: 2, sigma: 1 }
  ];
  const harvest = harvestEvidence(records, query);
  assert.equal(harvest.targetConstraints.some((entry) => entry.sourceId === "overlap"), true);
  assert.equal(harvest.targetConstraints.some((entry) => entry.sourceId === "miss"), false);
});

test("topography source manifest spans modern DEMs, paleo discovery, geomorphic calibration and plate hindcasts", () => {
  for (const sourceId of ["etopo-2022", "gebco-2026", "copernicus-dem-glo30", "opentopography-global-dem-api", "gmrt-4.5.0", "ncei-paleo-search", "usgs-marine-terraces", "walis", "pangaea-submerged-terraces-918191", "earthbyte-gplates", "sesar-geosamples", "spratt-lisiecki-2016"]) {
    assert.ok(topographyEvidenceSourceById(sourceId), sourceId);
  }
  assert.ok(TOPOGRAPHY_EVIDENCE_SOURCES.length >= 12);
  assert.equal(topographyEvidenceSourceById("gebco-2026").relation, EVIDENCE_RELATIONS.MODERN_ANCHOR);
  assert.equal(topographyEvidenceSourceById("ncei-paleo-search").relation, EVIDENCE_RELATIONS.NEARBY_PALEO);
  assert.equal(topographyEvidenceSourceById("usgs-marine-terraces").relation, EVIDENCE_RELATIONS.PROCESS_CALIBRATION);
  assert.equal(topographyEvidenceSourceById("spratt-lisiecki-2016").relation, EVIDENCE_RELATIONS.DIRECT_TARGET);
});

test("source normalization inherits catalog relation and quality but explicit record relation wins", () => {
  const gebco = normalizeTopographyEvidenceRecord({ sourceId: "gebco-2026", value: -100 });
  assert.equal(gebco.sourceCatalogMatched, true);
  assert.equal(gebco.relation, EVIDENCE_RELATIONS.MODERN_ANCHOR);
  assert.equal(gebco.sourceQuality, topographyEvidenceSourceById("gebco-2026").sourceQuality);
  const direct = normalizeTopographyEvidenceRecord({ sourceId: "usgs-marine-terraces", relation: EVIDENCE_RELATIONS.DIRECT_TARGET, ageBP: 777_000, value: 4 });
  assert.equal(direct.relation, EVIDENCE_RELATIONS.DIRECT_TARGET);
});

test("terrain harvester path reports source normalization and evidence accounting", () => {
  const sample = terrain777BedrockSampleFromEvidence(0, 0, [{ sourceId: "gebco-2026", value: -20 }]);
  assert.equal(sample.policy, TERRAIN_777_RECONSTRUCTION_POLICY);
  assert.equal(sample.evidenceRecordCount, 1);
  assert.equal(sample.evidenceHarvest.policy, TOPOGRAPHY_EVIDENCE_HARVEST_POLICY);
  assert.equal(sample.evidenceHarvest.genericRankingPolicy, "target-age-distance-uncertainty-source-ranking-v1");
  assert.equal(sample.sourceCatalogMatchedCount, 1);
  assert.equal(sample.modernAnchorEvidenceCount, 1);
  assert.equal(sample.assimilatedHarvestConstraintCount, 0);
});
