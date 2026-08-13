import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME4_PFTS,
  BIOME4_PFT_ELIGIBILITY_POLICY,
  biome4DailyTemperatureInterpolation,
  deriveBiome4ClimateIndices,
  evaluateBiome4PftClimateEligibility
} from "../src/sim/Biome4PftEligibility.js";

const warm = Array(12).fill(25);
const tundra = [-20, -18, -10, 0, 5, 10, 12, 10, 5, 0, -10, -18];

function byId(result, id) {
  return result.evaluations.find((entry) => entry.id === id);
}

test("BIOME4 climate eligibility exposes all 13 factual PFT parameter records", () => {
  assert.equal(BIOME4_PFTS.length, 13);
  assert.equal(BIOME4_PFTS[0].disabledInBiome4Version, true);
  assert.equal(BIOME4_PFTS[1].parameters.phenology, "raingreen");
  assert.equal(BIOME4_PFTS[3].parameters.topSoilRootFraction, 0.65);
  assert.equal(BIOME4_PFTS[7].parameters.leafOutGdd0, 100);
  assert.equal(BIOME4_PFTS[8].parameters.c4Capable, true);
  assert.equal(BIOME4_PFTS[10].parameters.topSoilRootFraction, 0.93);
});

test("BIOME4 monthly-to-daily interpolation preserves source mid-month anchors and wrap", () => {
  const monthly = [0, 10, 20, 30, 40, 50, 60, 50, 40, 30, 20, 10];
  const daily = biome4DailyTemperatureInterpolation(monthly);
  assert.equal(daily.length, 365);
  assert.equal(daily[15], 0);   // day 16 = January midpoint
  assert.equal(daily[43], 10);  // day 44 = February midpoint
  assert.equal(daily[74], 20);  // day 75 = March midpoint
  assert.equal(daily[349], 10); // day 350 = December midpoint
  assert.ok(daily[364] > 0 && daily[364] < 10); // day 365 lies between Dec and Jan
  assert.ok(daily[0] > 0 && daily[0] < daily[364]);
});

test("GDD0 and GDD5 are deterministic daily sums from the BIOME4 interpolation", () => {
  const indices = deriveBiome4ClimateIndices(Array(12).fill(10));
  assert.equal(indices.coldestMonthCelsius, 10);
  assert.equal(indices.warmestMonthCelsius, 10);
  assert.equal(indices.absoluteMinimumCelsius, 5);
  assert.equal(indices.gdd0, 3650);
  assert.equal(indices.gdd5, 1825);
  assert.match(indices.absoluteMinimumSource, /coldest-month minus 5/);
});

test("absolute minimum uses a supplied value only when it is no warmer than the coldest month", () => {
  const supplied = deriveBiome4ClimateIndices(warm, { absoluteMinimumTemperatureCelsius: 3 });
  assert.equal(supplied.absoluteMinimumCelsius, 3);
  assert.equal(supplied.absoluteMinimumSource, "supplied");

  const rejected = deriveBiome4ClimateIndices(warm, { absoluteMinimumTemperatureCelsius: 30 });
  assert.equal(rejected.absoluteMinimumCelsius, 20);
  assert.match(rejected.absoluteMinimumSource, /fallback/);
});

test("BIOME4 constraint lower bounds are inclusive and upper bounds are exclusive", () => {
  const lowerBoundary = evaluateBiome4PftClimateEligibility(Array(12).fill(15), {
    absoluteMinimumTemperatureCelsius: -8
  });
  assert.equal(byId(lowerBoundary, 3).status, "eligible");

  const upperBoundary = evaluateBiome4PftClimateEligibility(Array(12).fill(15), {
    absoluteMinimumTemperatureCelsius: 5
  });
  assert.equal(byId(upperBoundary, 3).status, "ineligible");
  assert.ok(byId(upperBoundary, 3).failedConstraints.some((entry) => entry.key === "absoluteMinimumCelsius"));
});

test("warm tropical climate yields tropical climate candidates while BIOME4 PFT 1 stays disabled", () => {
  const result = evaluateBiome4PftClimateEligibility(warm);
  assert.equal(result.policy, BIOME4_PFT_ELIGIBILITY_POLICY);
  assert.equal(byId(result, 1).climateStatus, "eligible");
  assert.equal(byId(result, 1).status, "disabled");
  assert.equal(byId(result, 2).status, "eligible");
  assert.equal(byId(result, 9).status, "eligible");
  assert.ok(!result.eligiblePftIds.includes(1));
});

test("tundra shrub remains unresolved without snow depth instead of silently passing", () => {
  const result = evaluateBiome4PftClimateEligibility(tundra);
  assert.equal(byId(result, 11).status, "unresolved");
  assert.ok(byId(result, 11).unresolvedConstraints.some((entry) => entry.key === "maximumSnowDepthModelUnits"));
  assert.equal(byId(result, 12).status, "eligible");
  assert.equal(byId(result, 13).status, "eligible");
});

test("supplying the BIOME4-native snow-depth diagnostic resolves tundra shrub eligibility", () => {
  const pass = evaluateBiome4PftClimateEligibility(tundra, { maximumSnowDepthModelUnits: 15 });
  assert.equal(byId(pass, 11).status, "eligible");

  const fail = evaluateBiome4PftClimateEligibility(tundra, { maximumSnowDepthModelUnits: 14.999 });
  assert.equal(byId(fail, 11).status, "ineligible");
});
