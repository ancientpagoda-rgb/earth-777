import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Biome4SoilLayer, BIOME4_SOIL_META } from "../src/data/biome4-soil.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import { MassConservingHydrology } from "../src/sim/MassConservingHydrology.js";
import {
  BIOME4_TWO_LAYER_WATER_POLICY,
  closeAnnualWaterBalance
} from "../src/sim/WaterBalance.js";

const soilCompressed = readFileSync(new URL("../public/data/biome4-soil.bin.gz", import.meta.url));
const soilRaw = gunzipSync(soilCompressed);
const soil = new Biome4SoilLayer(soilRaw);
const climateRaw = gunzipSync(readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url)));
const climate = new Krapp777ClimateLayer(climateRaw);

function coordinateForCell(index) {
  const row = Math.floor(index / BIOME4_SOIL_META.cols);
  const col = index % BIOME4_SOIL_META.cols;
  return {
    latitude: BIOME4_SOIL_META.northLatitude - row * BIOME4_SOIL_META.spacingDegrees,
    longitude: BIOME4_SOIL_META.westLongitude + col * BIOME4_SOIL_META.spacingDegrees
  };
}

function firstCellWithStatus(code) {
  const offset = BIOME4_SOIL_META.status.byteOffset;
  for (let index = 0; index < BIOME4_SOIL_META.rows * BIOME4_SOIL_META.cols; index += 1) {
    if (soilRaw[offset + index] === code) return { index, ...coordinateForCell(index) };
  }
  return null;
}

function firstExtremeSoilCell() {
  const statusOffset = BIOME4_SOIL_META.status.byteOffset;
  const field = BIOME4_SOIL_META.fields.whcTop;
  const view = new DataView(soilRaw.buffer, soilRaw.byteOffset, soilRaw.byteLength);
  for (let index = 0; index < BIOME4_SOIL_META.rows * BIOME4_SOIL_META.cols; index += 1) {
    if (soilRaw[statusOffset + index] !== 0) continue;
    const value = view.getFloat32(field.byteOffset + index * 4, true);
    if (value >= 999) return { index, value, ...coordinateForCell(index) };
  }
  return null;
}

function firstRuntimeSoilLocation(spatialClimate, state, spatialDetail = 0.65) {
  // Choose after CWF grid materialization, because the runtime soil query is
  // made at the materialized climate-cell location rather than the arbitrary
  // pointer coordinate supplied by the caller.
  for (let latitude = -60; latitude <= 70; latitude += 5) {
    for (let longitude = -175; longitude <= 175; longitude += 5) {
      const materialized = spatialClimate.sample(state, latitude, longitude, spatialDetail);
      if (!materialized) continue;
      const profile = soil.profileAt(materialized.latitude, materialized.longitude);
      if (profile.validSoil) return materialized;
    }
  }
  throw new Error("Could not find a climate-forced CWF grid cell with valid BIOME4 soil");
}

function syntheticMonthlyClimate({ precipitationMmPerYear = 1200, temperatureCelsius = 16, cloudCoverPercent = 45 } = {}) {
  return Array.from({ length: 12 }, () => ({
    precipitationMmPerYear,
    temperatureCelsius,
    cloudCoverPercent
  }));
}

test("official BIOME4 soil asset is deterministic, global, and source-float preserving", () => {
  assert.equal(BIOME4_SOIL_META.rows, 360);
  assert.equal(BIOME4_SOIL_META.cols, 720);
  assert.equal(BIOME4_SOIL_META.spacingDegrees, 0.5);
  assert.equal(BIOME4_SOIL_META.uncompressedBytes, 4_406_400);
  assert.equal(BIOME4_SOIL_META.compressedBytes, 138_298);
  assert.equal(
    BIOME4_SOIL_META.assetSha256,
    "9fe94404851f8ff73b90c38eedd775e160061b65b7e8b5783c3d7872731133de"
  );
  assert.equal(soilRaw.byteLength, BIOME4_SOIL_META.uncompressedBytes);
  assert.match(BIOME4_SOIL_META.license, /GPL-2\.0/);
});

test("BIOME4 soil status flags remain categorical while valid soil exposes both source layers", () => {
  const valid = firstCellWithStatus(0);
  const ice = firstCellWithStatus(2);
  assert.ok(valid);
  assert.ok(ice);

  const profile = soil.profileAt(valid.latitude, valid.longitude);
  assert.equal(profile.validSoil, true);
  assert.equal(profile.status, "soil");
  assert.ok(Number.isFinite(profile.topWaterCapacityMm) && profile.topWaterCapacityMm >= 0);
  assert.ok(Number.isFinite(profile.bottomWaterCapacityMm) && profile.bottomWaterCapacityMm >= 0);
  assert.ok(Number.isFinite(profile.topPercolationCoefficient) && profile.topPercolationCoefficient >= 0);
  assert.ok(Number.isFinite(profile.bottomPercolationCoefficient) && profile.bottomPercolationCoefficient >= 0);

  const iceProfile = soil.profileAt(ice.latitude, ice.longitude);
  assert.equal(iceProfile.validSoil, false);
  assert.equal(iceProfile.status, "land-ice");
  assert.equal("topWaterCapacityMm" in iceProfile, false);
});

test("large BIOME4 numeric soil inputs are preserved rather than mistaken for sentinels", () => {
  const extreme = firstExtremeSoilCell();
  assert.ok(extreme, "expected at least one valid BIOME4 soil cell with WHC >= 999");
  const profile = soil.profileAt(extreme.latitude, extreme.longitude);
  assert.equal(profile.validSoil, true);
  assert.ok(profile.topWaterCapacityMm >= 999);
});

test("two-layer BIOME4 soil water budget closes precipitation exactly", () => {
  const profile = {
    validSoil: true,
    status: "soil",
    source: "test-biome4-soil",
    topWaterCapacityMm: 60,
    bottomWaterCapacityMm: 180,
    topPercolationCoefficient: 0.86,
    bottomPercolationCoefficient: 0.86
  };
  const balance = closeAnnualWaterBalance(syntheticMonthlyClimate(), {
    latitude: 35,
    elevationMeters: 250,
    soilProfile: profile,
    spinupYears: 12
  });
  assert.equal(balance.soilPolicy, BIOME4_TWO_LAYER_WATER_POLICY);
  assert.equal(balance.soilWaterCapacityMm, 240);
  assert.ok(balance.surfaceRunoffMmPerYear >= 0);
  assert.ok(balance.deepDrainageMmPerYear >= 0);
  assert.ok(Math.abs(balance.massBalanceResidualMm) < 1e-6);
  const reconstructed =
    balance.actualEvapotranspirationMmPerYear +
    balance.surfaceRunoffMmPerYear +
    balance.deepDrainageMmPerYear +
    balance.storageChangeMm;
  assert.ok(Math.abs(balance.precipitationMmPerYear - reconstructed) < 0.01);
});

test("soil capacity and percolation materially affect the same climate forcing", () => {
  const climateSeries = syntheticMonthlyClimate({ precipitationMmPerYear: 850 });
  const shallow = closeAnnualWaterBalance(climateSeries, {
    latitude: 30,
    soilProfile: {
      validSoil: true,
      topWaterCapacityMm: 25,
      bottomWaterCapacityMm: 50,
      topPercolationCoefficient: 2,
      bottomPercolationCoefficient: 2
    }
  });
  const deep = closeAnnualWaterBalance(climateSeries, {
    latitude: 30,
    soilProfile: {
      validSoil: true,
      topWaterCapacityMm: 150,
      bottomWaterCapacityMm: 450,
      topPercolationCoefficient: 0.1,
      bottomPercolationCoefficient: 0.1
    }
  });
  assert.notEqual(shallow.meanSoilWaterStorageMm, deep.meanSoilWaterStorageMm);
  assert.notEqual(shallow.runoffMmPerYear, deep.runoffMmPerYear);
  assert.ok(Math.abs(shallow.massBalanceResidualMm) < 1e-6);
  assert.ok(Math.abs(deep.massBalanceResidualMm) < 1e-6);
});

test("MassConservingHydrology applies BIOME4 soil without breaking river-network closure", () => {
  const state = checkpointState();
  const spatialClimate = new SpatialHydroClimate(climate);
  const hydrology = new MassConservingHydrology(spatialClimate, soil);
  const runtimeLocation = firstRuntimeSoilLocation(spatialClimate, state, 0.65);
  const local = hydrology.sample(state, runtimeLocation.latitude, runtimeLocation.longitude, 0.65);
  assert.ok(local);
  assert.equal(local.soilProfileApplied, true);
  assert.equal(local.soilSource, BIOME4_SOIL_META.id);
  assert.equal(local.soilPolicy, BIOME4_TWO_LAYER_WATER_POLICY);
  assert.ok(Math.abs(local.waterBalanceResidualMm) < 1e-6);
  assert.ok(Array.isArray(local.waterBalanceMonths));
  assert.equal(local.waterBalanceMonths.length, 12);

  const network = hydrology.network(state, 0.1);
  assert.equal(network.accumulation.massConserved, true);
  assert.ok(network.accumulation.relativeClosureError < 1e-6);
  assert.match(network.epistemicStatus, /BIOME4 static spatial soil/);
});

test("hydrology keeps the transparent fallback when no soil layer is supplied", () => {
  const state = checkpointState();
  const hydrology = new MassConservingHydrology(new SpatialHydroClimate(climate));
  const sample = hydrology.sample(state, 0, 20, 0.65);
  assert.ok(sample);
  assert.equal(sample.soilProfileApplied, false);
  assert.equal(sample.soilPolicy, "uniform-single-layer-fallback");
  assert.ok(Math.abs(sample.waterBalanceResidualMm) < 1e-6);
});
