import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildNceiPaleoSearchUrl,
  NCEI_PAGE_LIMIT,
  NCEI_TARGET_YEAR_BP,
  nextNceiPageUrl,
  normalizeNceiSearchResponse,
  normalizeNceiStudySites
} from "../scripts/ncei-paleo-evidence-utils.mjs";
import { harvestTopographyEvidenceAt, normalizeTopographyEvidenceRecord } from "../src/reconstruction/TopographyEvidenceHarvester.js";
import { NCEI_PALEO_EVIDENCE_META, NCEI_PALEO_EVIDENCE_RECORDS } from "../src/data/generated/ncei-paleo-evidence.generated.js";

const fixtureStudy = {
  NOAAStudyId: 77701,
  xmlId: 90001,
  studyName: "Example 777 ka marine core",
  earliestYear: 810000,
  mostRecentYear: 740000,
  dataTypeId: 14,
  site: [
    { siteId: 10, geo: { geometry: { coordinates: [41.25, -126.5] }, properties: { elevation: -3100 } } },
    { siteId: 11, latitude: 39.5, longitude: -124.0, elevationMeters: -1900 }
  ]
};

test("NCEI query follows documented NOAA BP-overlap pagination contract", () => {
  const url = new URL(buildNceiPaleoSearchUrl());
  assert.equal(url.origin + url.pathname, "https://www.ncei.noaa.gov/access/paleo-search/study/search.json");
  assert.equal(url.searchParams.get("dataPublisher"), "NOAA");
  assert.equal(url.searchParams.get("earliestYear"), "802000");
  assert.equal(url.searchParams.get("latestYear"), "752000");
  assert.equal(url.searchParams.get("timeFormat"), "BP");
  assert.equal(url.searchParams.get("timeMethod"), "overAny");
  assert.equal(url.searchParams.get("limit"), String(NCEI_PAGE_LIMIT));
  assert.equal(url.searchParams.get("skip"), "0");
  assert.match(url.searchParams.get("dataTypeId"), /14/);
});

test("NCEI study sites normalize to discovery-only evidence records", () => {
  const records = normalizeNceiStudySites(fixtureStudy);
  assert.equal(records.length, 2);
  assert.equal(records[0].latitude, 41.25);
  assert.equal(records[0].longitude, -126.5);
  assert.equal(records[0].siteElevationMeters, -3100);
  assert.deepEqual(records[0].ageRangeBP, [740000, 810000]);
  assert.equal(records[0].field, "marineSedimentEvidence");
  assert.equal(records[0].relation, "nearby-age-paleo-evidence");
  assert.equal(records[0].archiveSourceId, "ncei-paleo-search");
  assert.equal(Object.hasOwn(records[0], "value"), false);
  assert.match(records[0].studyUrl, /\/study\/77701$/);
});

test("NCEI search response flattens sites and follows page next link", () => {
  const payload = {
    study: [fixtureStudy],
    page: [{ next: "https://www.ncei.noaa.gov/access/paleo-search/study/search.json?skip=10&limit=10" }]
  };
  assert.equal(normalizeNceiSearchResponse(payload).length, 2);
  assert.equal(nextNceiPageUrl(payload), payload.page[0].next);
});

test("ingested archive records match the NCEI source catalog but remain field-ineligible for bedrock", () => {
  const rawRecord = normalizeNceiStudySites(fixtureStudy)[0];
  const normalized = normalizeTopographyEvidenceRecord(rawRecord);
  assert.equal(normalized.sourceCatalogMatched, true);
  assert.equal(normalized.catalogSourceId, "ncei-paleo-search");
  const harvest = harvestTopographyEvidenceAt(41.25, -126.5, [rawRecord]);
  assert.equal(harvest.ranked.length, 1);
  assert.equal(harvest.targetConstraints.length, 0);
  assert.equal(harvest.ranked[0].queryFieldEligible, false);
  assert.equal(harvest.ranked[0].targetEligible, false);
});

test("generated NCEI cache has a stable empty-before-ingestion contract", () => {
  assert.equal(NCEI_PALEO_EVIDENCE_META.sourceId, "ncei-paleo-search");
  assert.equal(NCEI_PALEO_EVIDENCE_META.targetYearBP, NCEI_TARGET_YEAR_BP);
  assert.ok(Array.isArray(NCEI_PALEO_EVIDENCE_RECORDS));
});

test("ingestion source has no default page cap and writes raw cache outside git plus generated output", () => {
  const source = fs.readFileSync(new URL("../scripts/ingest-ncei-paleo-evidence.mjs", import.meta.url), "utf8");
  assert.match(source, /Number\.POSITIVE_INFINITY/);
  assert.match(source, /data\/raw/);
  assert.match(source, /ncei-paleo-evidence\.generated\.js/);
  assert.match(source, /while \(url && pageCount < MAX_PAGES\)/);
  assert.match(source, /nextNceiPageUrl/);
});

test("package keeps evidence ingestion separate from legacy ingest and chains spatial anchors after discovery", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["data:evidence:ncei"], "node scripts/ingest-ncei-paleo-evidence.mjs");
  assert.equal(pkg.scripts["data:evidence:gmrt"], "node scripts/ingest-gmrt-modern-anchors.mjs");
  assert.equal(pkg.scripts["data:evidence:gmrt-patches"], "node scripts/ingest-gmrt-terrain-patches.mjs");
  assert.equal(pkg.scripts["data:evidence"], "npm run data:evidence:ncei && npm run data:evidence:gmrt && npm run data:evidence:gmrt-patches");
  assert.doesNotMatch(pkg.scripts["data:ingest"], /data:evidence/);
});
