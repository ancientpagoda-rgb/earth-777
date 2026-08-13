import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME4_PFT_WATER_PHENOLOGY_POLICY,
  biome4EffectiveDaylengthHours,
  biome4RootZoneWaterState,
  biome4SummergreenPhenologyFraction,
  evaluateBiome4PftWaterPhenology
} from "../src/sim/Biome4PftWaterPhenology.js";
import { closeAnnualWaterBalance, BIOME4_TWO_LAYER_WATER_POLICY } from "../src/sim/WaterBalance.js";

const seasonalTemperature = [-6, -4, 1, 7, 13, 18, 21, 19, 13, 7, 1, -4];
const cloud = Array(12).fill(50);

function constantWaterTrace(topWetness, bottomWetness) {
  return Array.from({ length: 365 }, (_, index) => ({
    dayOfYear: index + 1,
    startTopWetness: topWetness,
    startBottomWetness: bottomWetness
  }));
}

function syntheticMonthlyClimate() {
  return Array.from({ length: 12 }, (_, month) => ({
    temperatureCelsius: seasonalTemperature[month],
    precipitationMmPerYear: 900,
    cloudCoverPercent: 50
  }));
}

test("BIOME4 root-zone wetness and extraction shares follow the source equations", () => {
  const state = biome4RootZoneWaterState(4, 0.8, 0.2);
  assert.equal(state.rootTopFraction, 0.65);
  assert.ok(Math.abs(state.effectiveRootZoneWetness - 0.59) < 1e-6);
  assert.ok(Math.abs(state.topExtractionShare + state.bottomExtractionShare - 1) < 1e-6);
  assert.ok(Math.abs(state.topExtractionShare - (0.65 * 0.8 / 0.59)) < 1e-6);
  assert.ok(Math.abs(state.waterSupplyCapacityMmPerDay - 5.9) < 1e-6);
});

test("BIOME4 effective photoperiod is finite, bounded, and seasonal", () => {
  const winter = biome4EffectiveDaylengthHours({
    latitude: 45,
    dayOfYear: 15,
    temperatureCelsius: 0,
    cloudCoverPercent: 50
  });
  const summer = biome4EffectiveDaylengthHours({
    latitude: 45,
    dayOfYear: 197,
    temperatureCelsius: 20,
    cloudCoverPercent: 50
  });
  assert.ok(winter >= 0 && winter <= 24);
  assert.ok(summer >= 0 && summer <= 24);
  assert.ok(summer > winter);
});

test("summergreen source semantics preserve PFT7 zero-degree onset and tree canopy ramp", () => {
  const daylength = Float64Array.from({ length: 365 }, (_, index) =>
    biome4EffectiveDaylengthHours({
      latitude: 50,
      dayOfYear: index + 1,
      temperatureCelsius: 5,
      cloudCoverPercent: 50
    })
  );
  const temperate = biome4SummergreenPhenologyFraction(4, seasonalTemperature, daylength);
  const boreal = biome4SummergreenPhenologyFraction(7, seasonalTemperature, daylength);
  assert.equal(temperate.ramp, 200);
  assert.equal(temperate.onsetTemperatureCelsius, 5);
  assert.equal(boreal.ramp, 200);
  assert.equal(boreal.onsetTemperatureCelsius, 0);
  assert.ok(Array.from(temperate.fraction).some((value) => value === 0));
  assert.ok(Array.from(temperate.fraction).some((value) => value === 1));
});

test("raingreen diagnostic reproduces BIOME4 parameter-4 operational switching and exposes parameter-5 discrepancy", () => {
  const result = evaluateBiome4PftWaterPhenology(2, {
    latitude: 10,
    monthlyTemperatureCelsius: Array(12).fill(25),
    monthlyCloudCoverPercent: cloud,
    dailyWaterTrace: constantWaterTrace(0.55, 0.55)
  });
  assert.equal(result.policy, BIOME4_PFT_WATER_PHENOLOGY_POLICY);
  assert.equal(result.declaredLeafDropWetness, 0.5);
  assert.equal(result.declaredLeafOnWetness, 0.6);
  assert.equal(result.sourceOperationalLeafOnWetness, 0.5);
  assert.equal(result.raingreenThresholdDiscrepancy, true);
  assert.equal(result.greenDays, 365);
  assert.equal(result.meanLeafFraction, 1);
});

test("dry root-zone water suppresses raingreen grass without inventing a new leaf-on rule", () => {
  const result = evaluateBiome4PftWaterPhenology(8, {
    latitude: 40,
    monthlyTemperatureCelsius: seasonalTemperature,
    monthlyCloudCoverPercent: cloud,
    dailyWaterTrace: constantWaterTrace(0.1, 0.1)
  });
  assert.equal(result.declaredLeafDropWetness, 0.2);
  assert.equal(result.declaredLeafOnWetness, 0.3);
  assert.equal(result.sourceOperationalLeafOnWetness, 0.2);
  assert.equal(result.raingreenThresholdDiscrepancy, true);
  assert.equal(result.greenDays, 0);
  assert.equal(result.meanLeafFraction, 0);
});

test("PFT water/phenology refuses to fabricate daily water from monthly storage", () => {
  const result = evaluateBiome4PftWaterPhenology(4, {
    latitude: 45,
    monthlyTemperatureCelsius: seasonalTemperature,
    monthlyCloudCoverPercent: cloud,
    dailyWaterTrace: null
  });
  assert.equal(result.status, "unresolved-water-trace");
  assert.match(result.epistemicStatus, /no monthly-storage interpolation/);
});

test("conserved two-layer water balance exposes 365 daily states only when requested", () => {
  const soilProfile = {
    validSoil: true,
    source: "synthetic-test-soil",
    status: "soil",
    topWaterCapacityMm: 60,
    bottomWaterCapacityMm: 180,
    topPercolationCoefficient: 0.86,
    bottomPercolationCoefficient: 0.86
  };
  const compact = closeAnnualWaterBalance(syntheticMonthlyClimate(), {
    latitude: 45,
    soilProfile,
    spinupYears: 3
  });
  const traced = closeAnnualWaterBalance(syntheticMonthlyClimate(), {
    latitude: 45,
    soilProfile,
    spinupYears: 3,
    includeDailyTrace: true
  });
  assert.equal(traced.soilPolicy, BIOME4_TWO_LAYER_WATER_POLICY);
  assert.equal(compact.daily, null);
  assert.equal(traced.daily.length, 365);
  assert.equal(traced.daily[0].dayOfYear, 1);
  assert.equal(traced.daily[364].dayOfYear, 365);
  assert.ok(traced.daily.every((day) => day.startTopWetness >= 0 && day.startTopWetness <= 1));
  assert.ok(traced.daily.every((day) => day.startBottomWetness >= 0 && day.startBottomWetness <= 1));
  assert.ok(Math.abs(traced.massBalanceResidualMm) < 1e-6);
  assert.equal(traced.precipitationMmPerYear, compact.precipitationMmPerYear);
});
