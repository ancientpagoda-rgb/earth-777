import assert from "node:assert/strict";
import test from "node:test";

import { runBiome4VirtualPftHydrologyTrial, BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY } from "../src/sim/Biome4VirtualPftHydrology.js";

const soil = Object.freeze({
  validSoil: true,
  status: "soil",
  source: "synthetic-biome4-soil",
  topWaterCapacityMm: 60,
  bottomWaterCapacityMm: 180,
  topPercolationCoefficient: 0.86,
  bottomPercolationCoefficient: 0.86
});

function dailyTrace({ precipitation = 2.4, pet = 2.0 } = {}) {
  return Array.from({ length: 365 }, (_, index) => ({
    dayOfYear: index + 1,
    precipitationMm: precipitation,
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

test("parallel PFT water trial closes its own annual water budget and never mutates shared hydrology", () => {
  const trial = runBiome4VirtualPftHydrologyTrial({
    pftId: 4,
    lai: 3,
    soilProfile: soil,
    baselineDailyWaterTrace: dailyTrace(),
    phenologyDaily: phenology(0.8)
  });
  assert.equal(trial.policy, BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY);
  assert.equal(trial.sharedHydrologyMutated, false);
  assert.equal(trial.daily.length, 365);
  assert.ok(trial.transpirationMmPerYear >= 0);
  assert.ok(trial.soilEvaporationMmPerYear >= 0);
  assert.ok(trial.runoffMmPerYear >= 0);
  assert.ok(Math.abs(trial.massBalanceResidualMm) < 1e-6);
  const closure = trial.soilEvaporationMmPerYear + trial.transpirationMmPerYear + trial.runoffMmPerYear + trial.storageChangeMm;
  assert.ok(Math.abs(trial.precipitationMmPerYear - closure) < 1e-4);
});

test("PFT canopy/root traits produce distinct parallel water trajectories under identical forcing", () => {
  const forcing = dailyTrace({ precipitation: 1.8, pet: 3.0 });
  const leaves = phenology(1);
  const tree = runBiome4VirtualPftHydrologyTrial({
    pftId: 6,
    lai: 4,
    soilProfile: soil,
    baselineDailyWaterTrace: forcing,
    phenologyDaily: leaves
  });
  const desert = runBiome4VirtualPftHydrologyTrial({
    pftId: 10,
    lai: 1,
    soilProfile: soil,
    baselineDailyWaterTrace: forcing,
    phenologyDaily: leaves
  });
  assert.notEqual(tree.fractionalVegetationCover, desert.fractionalVegetationCover);
  assert.notEqual(tree.transpirationMmPerYear, desert.transpirationMmPerYear);
  assert.notEqual(tree.endStorageMm, desert.endStorageMm);
  assert.ok(Math.abs(tree.massBalanceResidualMm) < 1e-6);
  assert.ok(Math.abs(desert.massBalanceResidualMm) < 1e-6);
});

test("phenology gates virtual transpiration without deleting precipitation from the budget", () => {
  const forcing = dailyTrace({ precipitation: 1.5, pet: 2.5 });
  const green = runBiome4VirtualPftHydrologyTrial({
    pftId: 8,
    lai: 2,
    soilProfile: soil,
    baselineDailyWaterTrace: forcing,
    phenologyDaily: phenology(1)
  });
  const dormant = runBiome4VirtualPftHydrologyTrial({
    pftId: 8,
    lai: 2,
    soilProfile: soil,
    baselineDailyWaterTrace: forcing,
    phenologyDaily: phenology(0)
  });
  assert.ok(green.transpirationMmPerYear > dormant.transpirationMmPerYear);
  assert.equal(dormant.transpirationMmPerYear, 0);
  assert.equal(green.precipitationMmPerYear, dormant.precipitationMmPerYear);
  assert.ok(Math.abs(dormant.massBalanceResidualMm) < 1e-6);
});
