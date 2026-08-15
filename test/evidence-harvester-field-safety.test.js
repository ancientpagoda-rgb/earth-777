import test from "node:test";
import assert from "node:assert/strict";
import { bedrockElevationAt } from "../src/data/generated/etopo-2022.generated.js";
import { EVIDENCE_RELATIONS, harvestEvidence } from "../src/reconstruction/EvidenceHarvester.js";
import { normalizeTopographyEvidenceRecord } from "../src/reconstruction/TopographyEvidenceHarvester.js";
import { terrain777BedrockSampleFromEvidence } from "../src/reconstruction/TerrainReconstruction777.js";

test("exact target evidence for a different field cannot enter terrain target constraints", () => {
  const harvest = harvestEvidence([{
    sourceId: "sea-level",
    field: "globalSeaLevel",
    relation: EVIDENCE_RELATIONS.DIRECT_TARGET,
    ageBP: 777_000,
    value: -12.76,
    sigma: 9.52,
    globalCoverage: true
  }], { targetYearBP: 777_000, field: "bedrockElevationMeters" });
  assert.equal(harvest.ranked[0].targetEligible, true);
  assert.equal(harvest.ranked[0].queryFieldEligible, false);
  assert.equal(harvest.targetConstraints.length, 0);
});

test("Spratt-Lisiecki source normalization keeps sea level separate from bedrock elevation", () => {
  const record = normalizeTopographyEvidenceRecord({ sourceId: "spratt-lisiecki-2016", ageBP: 777_000, value: -12.76, sigma: 9.52 });
  assert.equal(record.field, "globalSeaLevel");
  assert.equal(record.relation, EVIDENCE_RELATIONS.DIRECT_TARGET);
});

test("sea-level evidence cannot numerically move reconstructed bedrock through the terrain harvester", () => {
  const latitude = 10;
  const longitude = 20;
  const modern = bedrockElevationAt(latitude, longitude);
  const sample = terrain777BedrockSampleFromEvidence(latitude, longitude, [{
    sourceId: "spratt-lisiecki-2016",
    ageBP: 777_000,
    value: modern + 1000,
    sigma: 1,
    globalCoverage: true
  }]);
  assert.equal(sample.assimilatedHarvestConstraintCount, 0);
  assert.equal(sample.reconstructedElevationMeters, modern);
});
