import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import {
  Krapp777VegetationLayer,
  KRAPP_777_VEGETATION_META
} from "../src/data/krapp-777-vegetation.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import { MassConservingHydrology } from "../src/sim/MassConservingHydrology.js";
import { SpatialVegetation, SPATIAL_VEGETATION_POLICY } from "../src/sim/SpatialVegetation.js";

const vegetationCompressed = readFileSync(new URL("../public/data/krapp-777-vegetation.bin.gz", import.meta.url));
const vegetationRaw = gunzipSync(vegetationCompressed);
const vegetation = new Krapp777VegetationLayer(vegetationRaw);
const climateRaw = gunzipSync(readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url)));
const climate = new Krapp777ClimateLayer(climateRaw);

function firstFiniteVegetationCell() {
  const field = KRAPP_777_VEGETATION_META.fields.annualNpp;
  const view = new DataView(vegetationRaw.buffer, vegetationRaw.byteOffset, vegetationRaw.byteLength);
  for (let cell = 0; cell < KRAPP_777_VEGETATION_META.rows * KRAPP_777_VEGETATION_META.cols; cell += 1) {
    const encoded = view.getUint16(field.byteOffset + cell * 2, true);
    if (encoded === field.missingValue) continue;
    const row = Math.floor(cell / KRAPP_777_VEGETATION_META.cols);
    const col = cell % KRAPP_777_VEGETATION_META.cols;
    return {
      latitude: KRAPP_777_VEGETATION_META.northLatitude - row * KRAPP_777_VEGETATION_META.spacingDegrees,
      longitude: KRAPP_777_VEGETATION_META.westLongitude + col * KRAPP_777_VEGETATION_META.spacingDegrees
    };
  }
  throw new Error("No finite BIOME4 vegetation cell found");
}

const landCell = firstFiniteVegetationCell();

test("published BIOME4 vegetation asset has the expected deterministic layout", () => {
  assert.equal(vegetationRaw.byteLength, KRAPP_777_VEGETATION_META.uncompressedBytes);
  assert.equal(KRAPP_777_VEGETATION_META.rows, 360);
  assert.equal(KRAPP_777_VEGETATION_META.cols, 720);
  assert.equal(KRAPP_777_VEGETATION_META.spacingDegrees, 0.5);
  assert.equal(KRAPP_777_VEGETATION_META.assetSha256, "3f93f2e502c664c495a3ca5066907618824a9ec190ef295fb1bbc44efbc9a53b");
});

test("BIOME4 checkpoint exposes categorical biome, annual NPP, and LAI without inventing units", () => {
  const annual = vegetation.annualAt(landCell.latitude, landCell.longitude);
  assert.ok(annual);
  assert.ok(Number.isInteger(annual.biomeCode));
  assert.ok(annual.biomeCode >= 1 && annual.biomeCode <= 28);
  assert.equal(typeof annual.biomeLabel, "string");
  assert.ok(Number.isFinite(annual.npp) && annual.npp >= 0);
  assert.ok(Number.isFinite(annual.lai) && annual.lai >= 0);
  assert.match(annual.epistemicStatus, /published BIOME4 model output/);
});

test("signed monthly BIOME4 NPP is preserved instead of clipped", () => {
  const field = KRAPP_777_VEGETATION_META.fields.monthlyNpp;
  const view = new DataView(vegetationRaw.buffer, vegetationRaw.byteOffset, vegetationRaw.byteLength);
  let foundNegative = false;
  for (let month = 0; month < 12 && !foundNegative; month += 1) {
    const base = field.byteOffset + month * field.monthByteLength;
    for (let cell = 0; cell < KRAPP_777_VEGETATION_META.rows * KRAPP_777_VEGETATION_META.cols; cell += 1) {
      const encoded = view.getInt16(base + cell * 2, true);
      if (encoded !== field.missingValue && encoded < 0) {
        foundNegative = true;
        break;
      }
    }
  }
  assert.equal(foundNegative, true);
});

test("spatial vegetation is exactly the published checkpoint at elapsed year zero", () => {
  const hydrology = new MassConservingHydrology(new SpatialHydroClimate(climate));
  const spatial = new SpatialVegetation(vegetation, hydrology);
  const state = checkpointState();
  const published = vegetation.annualAt(landCell.latitude, landCell.longitude);
  const modeled = spatial.sample(state, landCell.latitude, landCell.longitude, 0.9);
  assert.ok(modeled);
  assert.equal(modeled.policy, SPATIAL_VEGETATION_POLICY);
  assert.equal(modeled.productivityFactor, 1);
  assert.equal(modeled.transitionPressure, 0);
  assert.equal(modeled.biomeCode, published.biomeCode);
  assert.equal(modeled.npp, Number(published.npp.toFixed(2)));
  assert.equal(modeled.lai, Number(published.lai.toFixed(3)));
  assert.ok(Array.isArray(modeled.climateEligiblePftIds));
  assert.ok(Array.isArray(modeled.climateUnresolvedPftIds));
  assert.ok(modeled.pftClimateIndices);
  assert.equal(modeled.checkpointCategoryRetained, true);
});

test("post-checkpoint vegetation changes continuously while retaining the published category as a lightweight reference", () => {
  const hydrology = new MassConservingHydrology(new SpatialHydroClimate(climate));
  const spatial = new SpatialVegetation(vegetation, hydrology);
  const checkpoint = checkpointState();
  const baseline = spatial.sample(checkpoint, landCell.latitude, landCell.longitude, 0.65);
  const branch = {
    ...checkpoint,
    elapsedYears: 10_000,
    yearBP: 767_000,
    temperatureAnomaly: checkpoint.temperatureAnomaly + 1.4,
    iceIndex: Math.max(0.03, checkpoint.iceIndex - 0.08),
    co2: checkpoint.co2 + 35
  };
  const evolved = spatial.sample(branch, landCell.latitude, landCell.longitude, 0.65);
  assert.ok(evolved);
  assert.equal(evolved.biomeCode, baseline.biomeCode);
  assert.equal(evolved.checkpointCategoryRetained, true);
  assert.ok(Number.isFinite(evolved.productivityFactor));
  assert.ok(evolved.productivityFactor > 0);
  assert.ok(evolved.transitionPressure >= 0 && evolved.transitionPressure <= 1);
  assert.match(evolved.epistemicStatus, /optimized PFT competition and lagged succession/);
  assert.ok(Array.isArray(evolved.climateEligiblePftIds));
  assert.equal(evolved.biomeCode, baseline.biomeCode);
});