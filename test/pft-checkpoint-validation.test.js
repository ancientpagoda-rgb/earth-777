import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Biome4PftDriverLayer } from "../src/data/biome4-pft-drivers.js";
import { Biome4SoilLayer } from "../src/data/biome4-soil.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { Krapp777VegetationLayer } from "../src/data/krapp-777-vegetation.js";
import { validateBiome4CheckpointCell, summarizeBiome4CheckpointValidation } from "../src/sim/Biome4CheckpointValidation.js";
import { MassConservingHydrology } from "../src/sim/MassConservingHydrology.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import { SpatialVegetation } from "../src/sim/SpatialVegetation.js";

const load = (path) => gunzipSync(readFileSync(new URL(path, import.meta.url)));
const climate = new Krapp777ClimateLayer(load("../public/data/krapp-777-climate.bin.gz"));
const vegetation = new Krapp777VegetationLayer(load("../public/data/krapp-777-vegetation.bin.gz"));
const soil = new Biome4SoilLayer(load("../public/data/biome4-soil.bin.gz"));
const drivers = new Biome4PftDriverLayer(load("../public/data/biome4-pft-drivers.bin.gz"));
const spatial = new SpatialVegetation(vegetation, new MassConservingHydrology(new SpatialHydroClimate(climate), soil), drivers);
const checkpoint = checkpointState();

// Fixed broad-latitude probes exercise distinct published climate/biome regimes;
// coordinates are not selected for agreement.
const PROBES = Object.freeze([
  [39, -95], [50, 10], [-20, 25], [-15, -60], [20, 100], [60, -120], [-35, 140]
]);

// One deterministic valid-soil cell for each published BIOME4 category found
// by a fixed 2° global scan. BIOME4 category 16 has no valid-soil candidate in
// this checkpoint asset, so it is explicitly absent rather than substituted.
const STRATIFIED_PROBES = Object.freeze([
  [1, 32, -92], [2, 22, 88], [3, 28, 76], [4, 52, 14], [5, 54, -10], [6, 50, 2],
  [7, 54, 12], [8, 58, 26], [9, 58, 30], [10, 70, 28], [11, 72, 78], [12, 22, -80],
  [13, 36, 10], [14, 56, -4], [15, 46, -120], [17, 26, -104], [19, 30, -104], [20, 72, 146],
  [21, 48, 92], [22, 74, -124], [23, 80, 94], [24, 80, 92], [25, 76, 62], [26, 80, -96],
  [27, 76, -100], [28, 80, -94]
]);

test("published BIOME4 checkpoint categories validate the independent classifier without feedback", () => {
  const results = PROBES.map(([latitude, longitude]) => validateBiome4CheckpointCell({
    annualVegetation: spatial.sample(checkpoint, latitude, longitude, 0.9),
    pftDiagnostics: spatial.pftDiagnostics(checkpoint, latitude, longitude, 0.9)
  }));
  const summary = summarizeBiome4CheckpointValidation(results);

  assert.equal(summary.resolvedProbes, PROBES.length);
  assert.equal(summary.matches, 6);
  assert.equal(summary.mismatches, 1);
  assert.equal(summary.matchFraction, 6 / 7);
  assert.equal(summary.calibrationFeedbackEnabled, false);
  for (const result of results) {
    assert.equal(result.appliedToVegetation, false);
    assert.equal(result.calibrationFeedbackEnabled, false);
  }
});

test("incomplete evidence remains unresolved rather than being coerced into an agreement", () => {
  const result = validateBiome4CheckpointCell({ annualVegetation: { biomeCode: 4 }, pftDiagnostics: { status: "resolved" } });
  assert.equal(result.status, "unresolved");
  assert.equal(result.calibrationFeedbackEnabled, false);
});

test("stratified checkpoint validation retains per-category mismatches without fitting them away", () => {
  const results = STRATIFIED_PROBES.map(([publishedBiomeCode, latitude, longitude]) => {
    const annualVegetation = spatial.sample(checkpoint, latitude, longitude, 0.9);
    assert.equal(annualVegetation?.biomeCode, publishedBiomeCode);
    return validateBiome4CheckpointCell({ annualVegetation, pftDiagnostics: spatial.pftDiagnostics(checkpoint, latitude, longitude, 0.9) });
  });
  const summary = summarizeBiome4CheckpointValidation(results);
  assert.equal(summary.resolvedProbes, 26);
  assert.equal(summary.matches, 14);
  assert.equal(summary.mismatches, 12);
  assert.equal(summary.matchFraction, 14 / 26);
  assert.ok(summary.confusion.some((entry) => entry.publishedBiomeCode === 9 && entry.predictedBiomeCode === 8));
  assert.ok(summary.confusion.some((entry) => entry.publishedBiomeCode === 1 && entry.predictedBiomeCode === 6));
  assert.equal(summary.calibrationFeedbackEnabled, false);
});
