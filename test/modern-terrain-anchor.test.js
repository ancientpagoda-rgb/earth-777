import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bedrockElevationAt } from "../src/data/generated/etopo-2022.generated.js";
import {
  gebcoTidMeasurementQuality,
  MODERN_TERRAIN_ANCHOR_POLICY,
  selectModernTerrainAnchor
} from "../src/reconstruction/ModernTerrainAnchorSelector.js";
import { terrain777BedrockSample } from "../src/reconstruction/TerrainReconstruction777.js";
import { GMRT_MODERN_ANCHORS, GMRT_MODERN_ANCHOR_META } from "../src/data/generated/gmrt-modern-anchors.generated.js";
import { buildGmrtPointUrl, normalizeGmrtPointResponse } from "../scripts/gmrt-modern-anchor-utils.mjs";

const lat = 36;
const lon = -123;

test("ETOPO remains the deterministic global fallback when no higher-resolution anchor exists", () => {
  const selected = selectModernTerrainAnchor(lat, lon, []);
  assert.equal(selected.policy, MODERN_TERRAIN_ANCHOR_POLICY);
  assert.equal(selected.selected.sourceId, "etopo-2022");
  assert.equal(selected.selected.value, bedrockElevationAt(lat, lon));
  assert.equal(selected.replacementUsed, false);
});

test("direct high-resolution GMRT anchor replaces ETOPO locally but remains a modern anchor", () => {
  const selected = selectModernTerrainAnchor(lat, lon, [{
    sourceId: "gmrt-4.5.0",
    field: "bedrockElevationMeters",
    relation: "modern-spatial-anchor",
    value: -2440,
    latitude: lat,
    longitude: lon,
    resolutionMeters: 120,
    directMeasurement: true,
    measurementClass: "direct",
    sourceQuality: 0.97,
    spatialSupportKm: 0.35
  }]);
  assert.equal(selected.selected.sourceId, "gmrt-4.5.0");
  assert.equal(selected.selected.value, -2440);
  assert.equal(selected.replacementUsed, true);
  const sample = terrain777BedrockSample(lat, lon, {
    modernAnchorCandidates: [selected.selected],
    useCachedHighResolutionAnchors: false
  });
  assert.equal(sample.modernAnchorSourceId, "gmrt-4.5.0");
  assert.equal(sample.modernElevationMeters, -2440);
  assert.equal(sample.reconstructionStatus, "provisional-modern-anchor-awaiting-local-hindcast");
});

test("GEBCO direct-measurement TID classes outrank predicted/interpolated classes", () => {
  assert.ok(gebcoTidMeasurementQuality(11) > gebcoTidMeasurementQuality(40));
  const selection = selectModernTerrainAnchor(lat, lon, [
    {
      sourceId: "gebco-2026-predicted",
      field: "bathymetryMeters",
      relation: "modern-spatial-anchor",
      value: -2000,
      latitude: lat,
      longitude: lon,
      resolutionMeters: 464,
      tidCode: 40,
      sourceQuality: 0.92,
      spatialSupportKm: 1
    },
    {
      sourceId: "gebco-2026-multibeam",
      field: "bathymetryMeters",
      relation: "modern-spatial-anchor",
      value: -2100,
      latitude: lat,
      longitude: lon,
      resolutionMeters: 464,
      tidCode: 11,
      sourceQuality: 0.92,
      spatialSupportKm: 1
    }
  ]);
  assert.equal(selection.selected.sourceId, "gebco-2026-multibeam");
});

test("local modern anchor evidence cannot bleed beyond declared spatial support", () => {
  const selection = selectModernTerrainAnchor(lat, lon, [{
    sourceId: "gmrt-4.5.0",
    field: "bedrockElevationMeters",
    relation: "modern-spatial-anchor",
    value: -3000,
    latitude: lat + 1,
    longitude: lon,
    resolutionMeters: 120,
    directMeasurement: true,
    sourceQuality: 0.97,
    spatialSupportKm: 0.35
  }]);
  assert.equal(selection.selected.sourceId, "etopo-2022");
});

test("GMRT PointServer URL and normalization preserve attribution conservatively", () => {
  const url = new URL(buildGmrtPointUrl(lat, lon));
  assert.equal(url.origin + url.pathname, "https://www.gmrt.org/services/PointServer");
  assert.equal(url.searchParams.get("latitude"), String(lat));
  assert.equal(url.searchParams.get("longitude"), String(lon));
  assert.equal(url.searchParams.get("format"), "json");

  const direct = normalizeGmrtPointResponse({ elevation: -1234, source: "curated multibeam survey", resolution: 120 }, { latitude: lat, longitude: lon });
  assert.equal(direct.directMeasurement, true);
  assert.equal(direct.measurementClass, "direct");
  assert.equal(direct.resolutionMeters, 120);

  const unknown = normalizeGmrtPointResponse({ elevation: -1250 }, { latitude: lat, longitude: lon });
  assert.equal(unknown.directMeasurement, false);
  assert.equal(unknown.measurementClass, "mixed");
  assert.equal(unknown.resolutionMeters, null);
});

test("generated GMRT cache has a stable empty-before-ingestion contract", () => {
  assert.equal(GMRT_MODERN_ANCHOR_META.sourceId, "gmrt-4.5.0");
  assert.ok(Array.isArray(GMRT_MODERN_ANCHORS));
});

test("GMRT ingestion remains build-time, uncapped by default, and follows NCEI evidence discovery", () => {
  const source = fs.readFileSync(new URL("../scripts/ingest-gmrt-modern-anchors.mjs", import.meta.url), "utf8");
  assert.match(source, /Number\.POSITIVE_INFINITY/);
  assert.match(source, /PointServer/);
  assert.match(source, /ncei-paleo-evidence\.generated\.js/);
  assert.match(source, /data\/raw/);
  assert.match(source, /gmrt-modern-anchors\.generated\.js/);
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["data:evidence:gmrt"], "node scripts/ingest-gmrt-modern-anchors.mjs");
  assert.equal(pkg.scripts["data:evidence:gmrt-patches"], "node scripts/ingest-gmrt-terrain-patches.mjs");
  assert.equal(pkg.scripts["data:evidence"], "npm run data:evidence:ncei && npm run data:evidence:gmrt && npm run data:evidence:gmrt-patches");
});
