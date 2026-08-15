import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildGmrtMaskedPatchUrl,
  gmrtPatchTileFor,
  packTerrainPatchInt16,
  parseEsriAsciiGrid,
  uniqueGmrtPatchTiles
} from "../scripts/gmrt-terrain-patch-utils.mjs";
import { terrainPatchValueAt } from "../src/reconstruction/ModernTerrainPatchCache.js";
import { selectModernTerrainAnchor } from "../src/reconstruction/ModernTerrainAnchorSelector.js";
import { GMRT_TERRAIN_PATCHES, GMRT_TERRAIN_PATCH_META } from "../src/data/generated/gmrt-terrain-patches.generated.js";

const ASCII = `ncols 2\nnrows 2\nxllcorner 10\nyllcorner 20\ncellsize 1\nNODATA_value -9999\n100 200\n300 -9999\n`;

function syntheticPatch() {
  const grid = parseEsriAsciiGrid(ASCII);
  const packed = packTerrainPatchInt16(grid);
  return Object.freeze({
    id: "synthetic",
    sourceId: "gmrt-4.5.0",
    west: packed.west,
    east: packed.west + packed.ncols * packed.cellsizeDegrees,
    south: packed.south,
    north: packed.south + packed.nrows * packed.cellsizeDegrees,
    ncols: packed.ncols,
    nrows: packed.nrows,
    cellsizeDegrees: packed.cellsizeDegrees,
    resolutionMeters: 200,
    nodata: packed.nodata,
    coverageFraction: packed.coverageFraction,
    dataBase64: packed.dataBase64
  });
}

test("evidence coordinates collapse deterministically into compact quarter-degree GMRT patch tiles", () => {
  const records = [
    { sourceId: "a", latitude: 41.20, longitude: -126.70 },
    { sourceId: "b", latitude: 41.22, longitude: -126.72 },
    { sourceId: "c", latitude: 41.31, longitude: -126.70 }
  ];
  const tiles = uniqueGmrtPatchTiles(records);
  assert.equal(tiles.length, 2);
  assert.deepEqual(tiles[0].evidenceSourceIds, ["a", "b"]);
  assert.deepEqual(gmrtPatchTileFor(41.20, -126.70), {
    id: "gmrt-41p000-m126p750-0p250",
    south: 41,
    north: 41.25,
    west: -126.75,
    east: -126.5,
    tileDegrees: 0.25
  });
});

test("GMRT patch request uses masked high-resolution GridServer rather than filled background topography", () => {
  const tile = gmrtPatchTileFor(-2.5, -89.5);
  const url = new URL(buildGmrtMaskedPatchUrl(tile));
  assert.equal(url.origin + url.pathname, "https://www.gmrt.org/services/GridServer");
  assert.equal(url.searchParams.get("layer"), "topo-mask");
  assert.equal(url.searchParams.get("format"), "esriascii");
  assert.equal(url.searchParams.get("mresolution"), "200");
});

test("ArcASCII parser and int16 packing preserve finite meters and masked NaN cells", () => {
  const grid = parseEsriAsciiGrid(ASCII);
  assert.equal(grid.ncols, 2);
  assert.equal(grid.nrows, 2);
  assert.equal(grid.values[0], 100);
  assert.ok(Number.isNaN(grid.values[3]));
  const packed = packTerrainPatchInt16(grid);
  assert.equal(packed.finiteCount, 3);
  assert.equal(packed.coverageFraction, 0.75);
  const patch = syntheticPatch();
  assert.equal(terrainPatchValueAt(patch, 21.5, 10.5), 100);
  assert.equal(terrainPatchValueAt(patch, 20.5, 10.5), 300);
  assert.equal(terrainPatchValueAt(patch, 20.5, 11.5), null);
});

test("ArcASCII center-origin headers are converted to cell-edge patch bounds", () => {
  const centered = parseEsriAsciiGrid(`ncols 1\nnrows 1\nxllcenter 10.5\nyllcenter 20.5\ncellsize 1\nNODATA_value -9999\n123\n`);
  assert.equal(centered.xll, 10);
  assert.equal(centered.yll, 20);
});

test("masked high-resolution coverage is strong evidence but not mislabeled as direct multibeam", () => {
  const common = {
    field: "bedrockElevationMeters",
    relation: "modern-spatial-anchor",
    latitude: 0,
    longitude: 0,
    resolutionMeters: 200,
    sourceQuality: 0.97,
    spatialSupportKm: 1
  };
  const selection = selectModernTerrainAnchor(0, 0, [
    { ...common, sourceId: "masked", value: -1000, maskedHighResolution: true, measurementClass: "high-resolution-mixed" },
    { ...common, sourceId: "direct", value: -1010, directMeasurement: true, measurementClass: "direct" }
  ]);
  const masked = selection.ranked.find((entry) => entry.sourceId === "masked");
  const direct = selection.ranked.find((entry) => entry.sourceId === "direct");
  assert.equal(masked.measurementQuality, 0.90);
  assert.equal(direct.measurementQuality, 1.0);
  assert.ok(direct.anchorScore > masked.anchorScore);
});

test("generated GMRT terrain patch cache has a stable empty-before-ingestion contract", () => {
  assert.equal(GMRT_TERRAIN_PATCH_META.sourceId, "gmrt-4.5.0");
  assert.equal(GMRT_TERRAIN_PATCH_META.tileDegrees, 0.25);
  assert.ok(Array.isArray(GMRT_TERRAIN_PATCHES));
});

test("terrain patch ingestion is uncapped by default, evidence-targeted, and never uses unmasked fill", () => {
  const source = fs.readFileSync(new URL("../scripts/ingest-gmrt-terrain-patches.mjs", import.meta.url), "utf8");
  assert.match(source, /Number\.POSITIVE_INFINITY/);
  assert.match(source, /NCEI_PALEO_EVIDENCE_RECORDS/);
  assert.match(source, /uniqueGmrtPatchTiles/);
  assert.match(source, /topo-mask/);
  assert.doesNotMatch(source, /layer[^\n]*["']topo["']/);
  assert.match(source, /data\/raw\/gmrt-terrain-patches/);
  assert.match(source, /gmrt-terrain-patches\.generated\.js/);
  assert.match(source, /GMRT_PATCH_TILE_DEGREES/);
});

test("package runs discovery, point anchors, then spatial patch ingestion", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["data:evidence:gmrt-patches"], "node scripts/ingest-gmrt-terrain-patches.mjs");
  assert.equal(pkg.scripts["data:evidence"], "npm run data:evidence:ncei && npm run data:evidence:gmrt && npm run data:evidence:gmrt-patches");
  assert.doesNotMatch(pkg.scripts["data:ingest"], /data:evidence/);
});
