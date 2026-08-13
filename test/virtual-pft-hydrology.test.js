import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME4_PERCOLATION_CONSERVATION_REPAIR,
  BIOME4_TOP_PERCOLATION_DISCREPANCY,
  BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY,
  runBiome4VirtualPftCandidateTrial,
  runBiome4VirtualPftHydrologyTrial
} from "../src/sim/Biome4VirtualPftHydrology.js";

const climate = Object.freeze({
  latitude: 42,
  monthlyTemperatureCelsius: Object.freeze([-4, -2, 3, 9, 15, 20, 23, 21, 16, 10, 4, -1]),
  monthlyCloudCoverPercent: Object.freeze([60, 58, 55, 50, 47, 43, 40, 42, 46, 51, 56, 60]),
  monthlyPrecipitationMm: Object.freeze([55, 50, 58, 62, 70, 75, 68, 64, 60, 57, 54, 52]),
  pressurePa: 98_000,
  co2Ppm: 245
});

function soil(overrides = {}) {
  return Object.freeze({
    validSoil: true,
    status: "soil",
    source: "synthetic BIOME4 soil",
    topWaterCapacityMm: 80,
    bottomWaterCapacityMm: 180,
    topPercolationCoefficient: 0.86,
    bottomPercolationCoefficient: 2.8,
    ...overrides
  });
}

function trial(overrides = {}) {
  return runBiome4VirtualPftHydrologyTrial({
    pftId: 4,
    lai: 3,
    soilProfile: soil(),
    ...climate,
    ...overrides
  });
}

test("fixed-LAI virtual PFT trial is deterministic, isolated, and closes the final-year soil budget", () => {
  const first = trial();
  const second = trial();
  assert.deepEqual(first, second);
  assert.equal(first.policy, BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY);
  assert.equal(first.landscapeHydrologyFeedback, false);
  assert.equal(first.daily.length, 365);
  assert.equal(first.monthly.length, 12);
  assert.ok(Math.abs(first.waterBalanceResidualMm) < 1e-5);
  assert.ok(Math.abs(first.snowMassBalanceResidualMm) < 1e-6);
  assert.ok(Math.abs(
    first.liquidInputMm - first.actualEvapotranspirationMm - first.totalRunoffMm - first.soilStorageChangeMm
  ) < 1e-4);
});

test("virtual trial never mutates caller climate or soil objects", () => {
  const profile = soil();
  const beforeSoil = JSON.stringify(profile);
  const beforeTemperature = JSON.stringify(climate.monthlyTemperatureCelsius);
  runBiome4VirtualPftHydrologyTrial({
    pftId: 4,
    lai: 2,
    soilProfile: profile,
    ...climate
  });
  assert.equal(JSON.stringify(profile), beforeSoil);
  assert.equal(JSON.stringify(climate.monthlyTemperatureCelsius), beforeTemperature);
});

test("source uses the top percolation coefficient for the virtual daily transfer and reports the unused second coefficient", () => {
  const lowBottom = trial({ soilProfile: soil({ bottomPercolationCoefficient: 0.001 }) });
  const highBottom = trial({ soilProfile: soil({ bottomPercolationCoefficient: 999 }) });
  assert.deepEqual(lowBottom.daily, highBottom.daily);
  assert.equal(lowBottom.operationalPercolationCoefficient, 0.86);
  assert.equal(lowBottom.secondLayerPercolationCoefficientUsed, false);
  assert.equal(lowBottom.percolationDiscrepancy, BIOME4_TOP_PERCOLATION_DISCREPANCY);
});

test("conservative transfer repair prevents extreme source k values from creating water", () => {
  const extreme = trial({
    soilProfile: soil({ topPercolationCoefficient: 999, bottomPercolationCoefficient: 999 })
  });
  assert.equal(extreme.conservationRepair, BIOME4_PERCOLATION_CONSERVATION_REPAIR);
  assert.ok(extreme.uncappedSourcePercolationExcessMm > 0);
  assert.ok(Math.abs(extreme.waterBalanceResidualMm) < 1e-5);
  assert.ok(extreme.daily.every((day) => day.startTopWetness >= 0 && day.startTopWetness <= 1));
  assert.ok(extreme.daily.every((day) => day.endBottomWetness >= 0 && day.endBottomWetness <= 1));
});

test("changing BIOME4 soil capacity and percolation materially changes the same PFT trial", () => {
  const shallowFast = trial({
    soilProfile: soil({
      topWaterCapacityMm: 25,
      bottomWaterCapacityMm: 50,
      topPercolationCoefficient: 5
    })
  });
  const deepSlow = trial({
    soilProfile: soil({
      topWaterCapacityMm: 160,
      bottomWaterCapacityMm: 450,
      topPercolationCoefficient: 0.05
    })
  });
  assert.notEqual(shallowFast.totalRunoffMm, deepSlow.totalRunoffMm);
  assert.notEqual(shallowFast.endSoilStorageMm, deepSlow.endSoilStorageMm);
  assert.ok(Math.abs(shallowFast.waterBalanceResidualMm) < 1e-5);
  assert.ok(Math.abs(deepSlow.waterBalanceResidualMm) < 1e-5);
});

test("leafless fixed-LAI zero trial uses source 25 percent PET when water supply can satisfy demand", () => {
  const bare = runBiome4VirtualPftHydrologyTrial({
    pftId: 4,
    lai: 0,
    soilProfile: soil({ topWaterCapacityMm: 300, bottomWaterCapacityMm: 500, topPercolationCoefficient: 0.05 }),
    ...climate,
    monthlyPrecipitationMm: Array(12).fill(150)
  });
  const unconstrained = bare.daily.filter((day) =>
    day.temperatureCelsius > -10 && day.potentialEvapotranspirationMm > 0 && day.optimalDemandMm <= day.supplyMm
  );
  assert.ok(unconstrained.length > 0);
  for (const day of unconstrained.slice(0, 20)) {
    assert.ok(Math.abs(day.actualEvapotranspirationMm - 0.25 * day.potentialEvapotranspirationMm) < 2e-6);
    assert.equal(day.fvc, 0);
  }
});

test("dry candidate trial triggers source water limitation without affecting landscape feedback flag", () => {
  const dry = trial({
    monthlyPrecipitationMm: Array(12).fill(2),
    soilProfile: soil({ topWaterCapacityMm: 30, bottomWaterCapacityMm: 40, topPercolationCoefficient: 0.01 })
  });
  assert.ok(dry.daily.some((day) => day.optimalDemandMm > day.supplyMm));
  assert.equal(dry.landscapeHydrologyFeedback, false);
  assert.ok(Math.abs(dry.waterBalanceResidualMm) < 1e-5);
});

test("PFT10 preserves separate C3 and C4 virtual hydrology alternatives until NPP selection exists", () => {
  const candidate = runBiome4VirtualPftCandidateTrial({
    pftId: 10,
    lai: 2,
    soilProfile: soil(),
    ...climate,
    monthlyTemperatureCelsius: Array(12).fill(25)
  });
  assert.equal(candidate.pathwaySelection, "unresolved-until-NPP");
  assert.equal(candidate.alternatives.c3.pathway, "c3");
  assert.equal(candidate.alternatives.c4.pathway, "c4");
  assert.equal(candidate.alternatives.c3.landscapeHydrologyFeedback, false);
  assert.equal(candidate.alternatives.c4.landscapeHydrologyFeedback, false);
  assert.notDeepEqual(candidate.alternatives.c3.monthlyCanopyConductance, candidate.alternatives.c4.monthlyCanopyConductance);
});

test("virtual PFT hydrology requires explicit pressure rather than hiding a pressure assumption", () => {
  assert.throws(() => runBiome4VirtualPftHydrologyTrial({
    pftId: 4,
    lai: 3,
    soilProfile: soil(),
    latitude: climate.latitude,
    monthlyTemperatureCelsius: climate.monthlyTemperatureCelsius,
    monthlyCloudCoverPercent: climate.monthlyCloudCoverPercent,
    monthlyPrecipitationMm: climate.monthlyPrecipitationMm
  }), /pressurePa/);
});
