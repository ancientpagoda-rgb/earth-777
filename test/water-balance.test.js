import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import { MassConservingHydrology, MASS_CONSERVING_HYDROLOGY_POLICY } from "../src/sim/MassConservingHydrology.js";
import {
  closeAnnualWaterBalance,
  extraterrestrialRadiationMjM2Day,
  monthlyPotentialEvapotranspirationMm,
  WATER_BALANCE_POLICY
} from "../src/sim/WaterBalance.js";
import { routeRunoffParcel, RUNOFF_ROUTING_POLICY } from "../src/sim/RunoffRouting.js";

const compressed = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
const climate = new Krapp777ClimateLayer(gunzipSync(compressed));

function syntheticMonthlyClimate({ temperatureCelsius = 15, precipitationMmPerYear = 1200, cloudCoverPercent = 45 } = {}) {
  return Array.from({ length: 12 }, () => ({
    temperatureCelsius,
    precipitationMmPerYear,
    cloudCoverPercent
  }));
}

test("FAO solar geometry and Priestley-Taylor PET remain finite and seasonal", () => {
  const winterRa = extraterrestrialRadiationMjM2Day(45, 15);
  const summerRa = extraterrestrialRadiationMjM2Day(45, 196);
  assert.ok(winterRa >= 0);
  assert.ok(summerRa > winterRa);

  const winterPet = monthlyPotentialEvapotranspirationMm({
    temperatureCelsius: 5,
    cloudCoverPercent: 50,
    latitude: 45,
    elevationMeters: 200,
    monthIndex: 0
  });
  const summerPet = monthlyPotentialEvapotranspirationMm({
    temperatureCelsius: 20,
    cloudCoverPercent: 50,
    latitude: 45,
    elevationMeters: 200,
    monthIndex: 6
  });
  assert.ok(winterPet >= 0);
  assert.ok(summerPet > winterPet);
});

test("closed soil-water bucket conserves precipitation exactly within numerical tolerance", () => {
  const balance = closeAnnualWaterBalance(syntheticMonthlyClimate(), {
    latitude: 35,
    elevationMeters: 250,
    soilWaterCapacityMm: 150,
    spinupYears: 12
  });
  assert.equal(balance.policy, WATER_BALANCE_POLICY);
  assert.ok(Math.abs(balance.precipitationMmPerYear - 1200) < 0.01);
  assert.ok(balance.actualEvapotranspirationMmPerYear >= 0);
  assert.ok(balance.runoffMmPerYear >= 0);
  assert.ok(balance.meanSoilWaterStorageMm >= 0 && balance.meanSoilWaterStorageMm <= 150);
  assert.ok(Math.abs(balance.massBalanceResidualMm) < 1e-6);
  const reconstructed =
    balance.actualEvapotranspirationMmPerYear +
    balance.runoffMmPerYear +
    balance.storageChangeMm;
  assert.ok(Math.abs(balance.precipitationMmPerYear - reconstructed) < 0.01);
});

test("ETOPO runoff parcel routing conserves annual water volume and never climbs", () => {
  const route = routeRunoffParcel(46.5, 8.5, 250, {
    spacingDegrees: 1,
    seaLevelMeters: 0,
    maxSteps: 80
  });
  assert.equal(route.policy, RUNOFF_ROUTING_POLICY);
  assert.ok(route.path.length >= 1);
  assert.ok(route.annualVolumeM3 > 0);
  assert.equal(route.massConserved, true);
  for (let index = 1; index < route.path.length; index += 1) {
    assert.ok(route.path[index].elevationMeters < route.path[index - 1].elevationMeters + 0.11);
    assert.ok(Math.abs(route.path[index].annualVolumeM3 - route.path[0].annualVolumeM3) < 0.01);
  }
});

test("Krapp branch climate feeds a closed regional water budget", () => {
  const state = checkpointState();
  const hydrology = new MassConservingHydrology(new SpatialHydroClimate(climate));
  const sample = hydrology.sample(state, 0, 20, 0.65);
  assert.ok(sample);
  assert.equal(sample.policy, MASS_CONSERVING_HYDROLOGY_POLICY);
  assert.ok(Number.isFinite(sample.potentialEvapotranspirationMmPerYear));
  assert.ok(Number.isFinite(sample.actualEvapotranspirationMmPerYear));
  assert.ok(Number.isFinite(sample.runoffMmPerYear));
  assert.ok(Number.isFinite(sample.soilWaterStorageMm));
  assert.ok(Math.abs(sample.waterBalanceResidualMm) < 1e-6);
  assert.match(sample.epistemicStatus, /closed soil-water bucket/);

  const route = hydrology.routeRunoff(state, 0, 20, 0.65, { maxSteps: 60 });
  assert.ok(route);
  assert.equal(route.massConserved, true);
});
