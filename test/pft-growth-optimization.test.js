import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME4_PFT_GROWTH_POLICY,
  BIOME4_PFT_LAI_OPTIMIZATION_POLICY,
  biome4FindNppSearch,
  biome4PftGrowthAtLai,
  optimizeBiome4PftLaiNpp
} from "../src/sim/Biome4PftGrowth.js";

const soil = Object.freeze({
  validSoil: true,
  status: "soil",
  source: "synthetic-biome4-soil",
  topWaterCapacityMm: 75,
  bottomWaterCapacityMm: 260,
  topPercolationCoefficient: 0.8,
  bottomPercolationCoefficient: 4
});

const climate = Object.freeze({
  latitude: 42,
  monthlyTemperatureCelsius: Object.freeze([-1, 1, 6, 11, 16, 21, 24, 23, 18, 12, 6, 1]),
  monthlyCloudCoverPercent: Object.freeze([62, 60, 58, 54, 50, 47, 45, 46, 50, 55, 59, 62]),
  monthlyPrecipitationMmPerYear: Object.freeze([720, 720, 840, 960, 960, 840, 720, 720, 840, 960, 840, 720]),
  elevationMeters: 250,
  co2Ppm: 245
});

test("findnpp reproduces the exact eight-round two-point source search", () => {
  const search = biome4FindNppSearch((lai) => ({ operationalObjectiveNpp: 100 - (lai - 3.25) ** 2 }));
  assert.equal(search.policy, BIOME4_PFT_LAI_OPTIMIZATION_POLICY);
  assert.equal(search.evaluationCount, 16);
  assert.equal(search.evaluations[0].lai, 2.01);
  assert.equal(search.evaluations[1].lai, 6.01);
  assert.ok(Math.abs(search.optimumLai - 3.25) < 0.1);
  assert.ok(search.optimumNpp > 99.99);
});

test("findnpp retains source >= tie semantics", () => {
  const search = biome4FindNppSearch(() => 5);
  assert.equal(search.evaluationCount, 16);
  assert.equal(search.optimumNpp, 5);
  assert.equal(search.optimumLai, search.evaluations.at(-1).lai);
});

test("fixed-LAI growth is deterministic, finite, and closes the second-year water budget", () => {
  const input = { pftId: 4, lai: 3, soilProfile: soil, ...climate };
  const a = biome4PftGrowthAtLai(input);
  const b = biome4PftGrowthAtLai(input);
  assert.equal(a.policy, BIOME4_PFT_GROWTH_POLICY);
  assert.equal(a.operationalObjectiveNpp, b.operationalObjectiveNpp);
  assert.deepEqual(a.monthlyNpp, b.monthlyNpp);
  assert.equal(a.monthlyNpp.length, 12);
  assert.equal(a.hydrology.monthlyMeanFvc.length, 12);
  assert.equal(a.hydrology.monthlyMeanCanopyConductance.length, 12);
  assert.ok(Number.isFinite(a.operationalObjectiveNpp));
  assert.ok(Number.isFinite(a.annualAllocationNpp));
  assert.ok(Math.abs(a.hydrology.waterBalanceResidualMm) < 1e-6);
  assert.ok(a.hydrology.greenDays >= 0 && a.hydrology.greenDays <= 365);
  assert.equal(a.nppObjectiveDiscrepancy.earth777Policy.includes("operational monthly-sum objective"), true);
});

test("woody raingreen growth uses deterministic source-state repair and remains reproducible", () => {
  const input = {
    pftId: 2,
    lai: 2.5,
    soilProfile: soil,
    ...climate,
    latitude: 8,
    monthlyTemperatureCelsius: Array(12).fill(25),
    monthlyPrecipitationMmPerYear: [240, 240, 240, 480, 960, 1440, 1440, 960, 480, 240, 240, 240]
  };
  const a = biome4PftGrowthAtLai(input);
  const b = biome4PftGrowthAtLai(input);
  assert.equal(a.operationalObjectiveNpp, b.operationalObjectiveNpp);
  assert.equal(a.sourceRepairs.woodyRaingreenFirstDayFvc.includes("leafless"), true);
  assert.ok(Math.abs(a.hydrology.waterBalanceResidualMm) < 1e-6);
});

test("PFT 10 evaluates complete C4 and C3 candidate pathways before applying the source month rule", () => {
  const result = biome4PftGrowthAtLai({
    pftId: 10,
    lai: 1.2,
    soilProfile: soil,
    ...climate,
    latitude: 28,
    monthlyTemperatureCelsius: [14, 16, 19, 23, 27, 30, 32, 31, 27, 22, 18, 15]
  });
  assert.equal(result.c3.pathway, "c3");
  assert.equal(result.c4.pathway, "c4");
  assert.equal(result.c3.carbon.monthlyNpp.length, 12);
  assert.equal(result.c4.carbon.monthlyNpp.length, 12);
  assert.equal(result.monthlyNpp.length, 12);
  assert.ok(result.c4AdvantageMonths >= 0 && result.c4AdvantageMonths <= 12);
  assert.equal(result.mixedC3C4MonthsEnabled, result.c4AdvantageMonths >= 3);
  assert.ok(Math.abs(result.c3.hydrology.waterBalanceResidualMm) < 1e-6);
  assert.ok(Math.abs(result.c4.hydrology.waterBalanceResidualMm) < 1e-6);
});

test("full candidate LAI optimizer performs sixteen source-operational growth evaluations without enabling category mutation", () => {
  const optimized = optimizeBiome4PftLaiNpp({ pftId: 6, soilProfile: soil, ...climate });
  assert.equal(optimized.policy, BIOME4_PFT_LAI_OPTIMIZATION_POLICY);
  assert.equal(optimized.evaluationCount, 16);
  assert.equal(optimized.checkpointCategoryMutationEnabled, false);
  assert.ok(optimized.optimumLai >= 0);
  assert.ok(optimized.optimumNpp >= 0);
  if (optimized.optimumEvaluation) {
    assert.equal(optimized.optimumEvaluation.lai, optimized.optimumLai);
    assert.ok(Math.abs(optimized.optimumEvaluation.hydrology.waterBalanceResidualMm) < 1e-6);
  }
});
