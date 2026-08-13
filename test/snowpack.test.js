import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import { MassConservingHydrology } from "../src/sim/MassConservingHydrology.js";
import {
  closeAnnualWaterBalance,
  snowfallFraction,
  temperatureIndexSnowmeltMm,
  WATER_BALANCE_POLICY
} from "../src/sim/WaterBalance.js";

const compressed = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
const climate = new Krapp777ClimateLayer(gunzipSync(compressed));

function uniformClimate({ temperatureCelsius, precipitationMmPerYear, cloudCoverPercent = 50 }) {
  return Array.from({ length: 12 }, () => ({
    temperatureCelsius,
    precipitationMmPerYear,
    cloudCoverPercent
  }));
}

function seasonalSnowClimate() {
  const temperatures = [-9, -7, -3, 2, 8, 13, 16, 14, 8, 2, -3, -8];
  return temperatures.map((temperatureCelsius) => ({
    temperatureCelsius,
    precipitationMmPerYear: 1200,
    cloudCoverPercent: 50
  }));
}

test("rain-snow phase partition is bounded and transparent", () => {
  assert.equal(snowfallFraction(-5), 1);
  assert.equal(snowfallFraction(-1), 1);
  assert.equal(snowfallFraction(0), 0.5);
  assert.equal(snowfallFraction(1), 0);
  assert.equal(snowfallFraction(8), 0);
});

test("temperature-index snowmelt is zero below freezing and capped by SWE", () => {
  assert.equal(temperatureIndexSnowmeltMm({
    temperatureCelsius: -2,
    snowWaterEquivalentMm: 100,
    monthIndex: 2
  }), 0);
  const melt = temperatureIndexSnowmeltMm({
    temperatureCelsius: 2,
    snowWaterEquivalentMm: 100,
    monthIndex: 2,
    meltFactorMmPerCDay: 3
  });
  assert.ok(melt > 0);
  assert.ok(melt <= 100);
});

test("warm climate closes without artificial snow", () => {
  const balance = closeAnnualWaterBalance(
    uniformClimate({ temperatureCelsius: 15, precipitationMmPerYear: 1200, cloudCoverPercent: 45 }),
    { latitude: 35, elevationMeters: 250, spinupYears: 12 }
  );
  assert.equal(balance.policy, WATER_BALANCE_POLICY);
  assert.equal(balance.snowfallMmPerYear, 0);
  assert.equal(balance.snowmeltMmPerYear, 0);
  assert.equal(balance.endSnowWaterEquivalentMm, 0);
  assert.ok(Math.abs(balance.massBalanceResidualMm) < 1e-6);
  assert.ok(Math.abs(
    balance.precipitationMmPerYear -
    balance.actualEvapotranspirationMmPerYear -
    balance.runoffMmPerYear -
    balance.storageChangeMm
  ) < 0.01);
});

test("seasonal snow delays cold precipitation and releases it as melt", () => {
  const balance = closeAnnualWaterBalance(seasonalSnowClimate(), {
    latitude: 55,
    elevationMeters: 600,
    spinupYears: 12
  });
  assert.ok(balance.snowfallMmPerYear > 0);
  assert.ok(balance.snowmeltMmPerYear > 0);
  assert.ok(balance.maximumSnowWaterEquivalentMm > 0);
  assert.ok(balance.months.some((month) => month.snowfallMm > 0 && month.snowmeltMm === 0));
  assert.ok(balance.months.some((month) => month.snowmeltMm > 0));
  assert.ok(Math.abs(balance.massBalanceResidualMm) < 1e-6);
});

test("perennially cold precipitation remains conserved as growing snow storage", () => {
  const balance = closeAnnualWaterBalance(
    uniformClimate({ temperatureCelsius: -10, precipitationMmPerYear: 600, cloudCoverPercent: 60 }),
    { latitude: 75, elevationMeters: 1000, spinupYears: 2 }
  );
  assert.ok(balance.snowfallMmPerYear > 599);
  assert.equal(balance.rainfallMmPerYear, 0);
  assert.equal(balance.snowmeltMmPerYear, 0);
  assert.ok(balance.endSnowWaterEquivalentMm > balance.startSnowWaterEquivalentMm);
  assert.ok(balance.snowWaterEquivalentChangeMm > 599);
  assert.equal(balance.runoffMmPerYear, 0);
  assert.ok(Math.abs(balance.massBalanceResidualMm) < 1e-6);
});

test("real 777 ka hydrology exposes snow fields while retaining exact water closure", () => {
  const state = checkpointState();
  const hydrology = new MassConservingHydrology(new SpatialHydroClimate(climate));
  const sample = hydrology.sample(state, 55, 20, 0.65);
  assert.ok(sample);
  assert.ok(Number.isFinite(sample.rainfallMmPerYear));
  assert.ok(Number.isFinite(sample.snowfallMmPerYear));
  assert.ok(Number.isFinite(sample.snowmeltMmPerYear));
  assert.ok(Number.isFinite(sample.snowWaterEquivalentMm));
  assert.ok(Number.isFinite(sample.maximumSnowWaterEquivalentMm));
  assert.ok(Math.abs(sample.waterBalanceResidualMm) < 1e-6);
  assert.match(sample.epistemicStatus, /soil \+ snow water bucket/);
});
