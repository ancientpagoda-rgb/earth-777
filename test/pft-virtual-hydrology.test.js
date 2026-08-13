import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY,
  biome4ConductanceControlledAet,
  runBiome4VirtualPftHydrologyTrial
} from "../src/sim/Biome4VirtualPftHydrology.js";

const soil = Object.freeze({
  validSoil: true,
  status: "soil",
  source: "synthetic-biome4-soil",
  topWaterCapacityMm: 60,
  bottomWaterCapacityMm: 180,
  topPercolationCoefficient: 0.86,
  bottomPercolationCoefficient: 0.86
});

function dailyTrace({ pet = 2.0 } = {}) {
  return Array.from({ length: 365 }, (_, index) => ({
    dayOfYear: index + 1,
    precipitationMm: 99,
    potentialEvapotranspirationMm: pet,
    startTopStorageMm: index === 0 ? 30 : 0,
    startBottomStorageMm: index === 0 ? 90 : 0
  }));
}

function phenology(leafFraction = 1) {
  return Array.from({ length: 365 }, (_, index) => ({
    dayOfYear: index + 1,
    leafFraction
  }));
}

const monthlyTemperature = [12, 13, 15, 18, 21, 24, 26, 26, 23, 19, 15, 13];
const monthlyCloud = [55, 55, 52, 50, 48, 45, 43, 43, 46, 50, 53, 55];
const monthlyPrecipitation = [720, 720, 840, 960, 1080, 1200, 1080, 960, 840, 720, 720, 720];

function run(overrides = {}) {
  return runBiome4VirtualPftHydrologyTrial({
    pftId: 4,
    lai: 3,
    soilProfile: soil,
    baselineDailyWaterTrace: dailyTrace(),
    phenologyDaily: phenology(0.8),
    latitude: 30,
    monthlyTemperatureCelsius: monthlyTemperature,
    monthlyCloudCoverPercent: monthlyCloud,
    monthlyPrecipitationMmPerYear: monthlyPrecipitation,
    elevationMeters: 250,
    co2Ppm: 245,
    ...overrides
  });
}

test("parallel PFT water trial closes soil plus snow storage and never mutates shared hydrology", () => {
  const trial = run();
  assert.equal(trial.policy, BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY);
  assert.equal(trial.sharedHydrologyMutated, false);
  assert.equal(trial.daily.length, 365);
  assert.ok(trial.actualEvapotranspirationMmPerYear >= 0);
  assert.ok(trial.transpirationMmPerYear >= 0);
  assert.ok(trial.runoffMmPerYear >= 0);
  assert.ok(Math.abs(trial.massBalanceResidualMm) < 1e-6);
  const closure = trial.actualEvapotranspirationMmPerYear + trial.runoffMmPerYear +
    trial.storageChangeMm + trial.snowStorageChangeMm;
  assert.ok(Math.abs(trial.precipitationMmPerYear - closure) < 1e-4);
  assert.equal(trial.bottomPercolationParameterUsed, false);
});

test("candidate hydrology no longer depends on Earth generic PET values in the reference trace", () => {
  const lowPet = run({ baselineDailyWaterTrace: dailyTrace({ pet: 0.01 }) });
  const highPet = run({ baselineDailyWaterTrace: dailyTrace({ pet: 50 }) });
  assert.equal(lowPet.actualEvapotranspirationMmPerYear, highPet.actualEvapotranspirationMmPerYear);
  assert.equal(lowPet.runoffMmPerYear, highPet.runoffMmPerYear);
  assert.equal(lowPet.endStorageMm, highPet.endStorageMm);
});

test("BIOME4 conductance saturation raises AET demand before water-supply limitation", () => {
  const common = {
    equilibriumDemandMm: 4,
    fractionalVegetationCover: 0.8,
    maximumFractionalVegetationCover: 0.8,
    minimumCanopyConductance: 0.2,
    rootZoneWetness: 1,
    maximumDailyTranspirationMm: 20,
    temperatureCelsius: 20
  };
  const low = biome4ConductanceControlledAet({ ...common, optimumCanopyConductance: 0.2 });
  const high = biome4ConductanceControlledAet({ ...common, optimumCanopyConductance: 10 });
  assert.ok(high.potentialAetMm > low.potentialAetMm);
  assert.equal(low.supplyLimited, false);
  assert.equal(high.supplyLimited, false);
});

test("PFT canopy/root traits produce distinct conductance-driven water trajectories", () => {
  const tree = run({ pftId: 6, lai: 4, phenologyDaily: phenology(1) });
  const desert = run({ pftId: 10, lai: 1, phenologyDaily: phenology(1) });
  assert.notEqual(tree.fractionalVegetationCover, desert.fractionalVegetationCover);
  assert.notEqual(tree.actualEvapotranspirationMmPerYear, desert.actualEvapotranspirationMmPerYear);
  assert.notEqual(tree.endStorageMm, desert.endStorageMm);
  assert.ok(Math.abs(tree.massBalanceResidualMm) < 1e-6);
  assert.ok(Math.abs(desert.massBalanceResidualMm) < 1e-6);
});

test("leafless BIOME4 days retain the source 25 percent equilibrium loss instead of generic soil PET", () => {
  const green = run({ pftId: 8, lai: 2, phenologyDaily: phenology(1) });
  const dormant = run({ pftId: 8, lai: 2, phenologyDaily: phenology(0) });
  assert.ok(green.transpirationMmPerYear > 0);
  assert.equal(dormant.transpirationMmPerYear, 0);
  assert.ok(dormant.leaflessAetMmPerYear > 0);
  assert.equal(dormant.actualEvapotranspirationMmPerYear, dormant.leaflessAetMmPerYear);
  assert.equal(green.precipitationMmPerYear, dormant.precipitationMmPerYear);
  assert.ok(Math.abs(dormant.massBalanceResidualMm) < 1e-6);
});
