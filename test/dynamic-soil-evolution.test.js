import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evolveSoilProfile, DYNAMIC_SOIL_POLICY } from "../src/sim/DynamicSoilEvolution.js";

const baseline = Object.freeze({
  validSoil: true,
  status: "soil",
  topWaterCapacityMm: 85,
  bottomWaterCapacityMm: 165,
  totalWaterCapacityMm: 250,
  topPercolationCoefficient: 4.5,
  bottomPercolationCoefficient: 1.8,
  source: "synthetic-biome4-soil"
});

const checkpointState = Object.freeze({ elapsedYears: 0, productivityIndex: 1 });
const evolvedState = Object.freeze({ elapsedYears: 80_000, productivityIndex: 1.1 });

test("pedogenesis is exactly checkpoint-neutral", () => {
  const soil = evolveSoilProfile(checkpointState, baseline, {
    temperatureCelsius: 14,
    precipitationMmPerYear: 900
  }, {
    erosionRateMmPerYear: 0.2,
    depositionRateMmPerYear: 0.1
  });
  assert.equal(soil.policy, DYNAMIC_SOIL_POLICY);
  assert.equal(soil.evolved, false);
  assert.equal(soil.topWaterCapacityMm, baseline.topWaterCapacityMm);
  assert.equal(soil.bottomWaterCapacityMm, baseline.bottomWaterCapacityMm);
  assert.equal(soil.topPercolationCoefficient, baseline.topPercolationCoefficient);
  assert.equal(soil.bottomPercolationCoefficient, baseline.bottomPercolationCoefficient);
  assert.equal(soil.capacityMultiplier, 1);
});

test("warm wet low-erosion weathering can deepen soil and increase water capacity", () => {
  const soil = evolveSoilProfile(evolvedState, baseline, {
    temperatureCelsius: 20,
    precipitationMmPerYear: 1600
  }, {
    erosionRateMmPerYear: 0.002,
    depositionRateMmPerYear: 0.012
  });
  assert.equal(soil.evolved, true);
  assert.ok(soil.soilProductionMmPerYear > 0);
  assert.ok(soil.netSoilFormationMmPerYear > 0);
  assert.ok(soil.soilDepthMeters > soil.baselineDepthMeters);
  assert.ok(soil.totalWaterCapacityMm > soil.baselineTotalWaterCapacityMm);
  assert.ok(soil.capacityMultiplier > 1);
  assert.ok(soil.fertilityIndex > 0);
});

test("sustained erosion strips soil and lowers storage relative to a depositional twin", () => {
  const climate = { temperatureCelsius: 11, precipitationMmPerYear: 780 };
  const eroding = evolveSoilProfile(evolvedState, baseline, climate, {
    erosionRateMmPerYear: 0.16,
    depositionRateMmPerYear: 0.002
  });
  const depositing = evolveSoilProfile(evolvedState, baseline, climate, {
    erosionRateMmPerYear: 0.01,
    depositionRateMmPerYear: 0.13
  });
  assert.ok(eroding.netSoilFormationMmPerYear < 0);
  assert.ok(eroding.soilDepthMeters < baseline.totalWaterCapacityMm / 180);
  assert.ok(eroding.totalWaterCapacityMm < depositing.totalWaterCapacityMm);
  assert.ok(eroding.capacityMultiplier < depositing.capacityMultiplier);
  assert.ok(eroding.fertilityIndex < depositing.fertilityIndex);
});

test("dynamic soil does not fabricate BIOME4 soil where source coverage says no soil", () => {
  const unavailable = Object.freeze({ validSoil: false, status: "ice", source: "synthetic" });
  const result = evolveSoilProfile(evolvedState, unavailable, {
    temperatureCelsius: 3,
    precipitationMmPerYear: 600
  }, {
    erosionRateMmPerYear: 0,
    depositionRateMmPerYear: 0.2
  });
  assert.equal(result.validSoil, false);
  assert.equal(result.evolved, false);
  assert.equal(result.capacityMultiplier, 1);
});

test("pedogenesis is deterministic and contains no named geographic outcome rules", () => {
  const args = [evolvedState, baseline, { temperatureCelsius: 17, precipitationMmPerYear: 1100 }, { erosionRateMmPerYear: 0.04, depositionRateMmPerYear: 0.03 }];
  assert.deepEqual(evolveSoilProfile(...args), evolveSoilProfile(...args));
  const source = readFileSync(new URL("../src/sim/DynamicSoilEvolution.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Amazon|Sahara|Nile|Ganges|Mississippi|Africa|Asia|America/i);
  assert.match(source, /fixed two-pass network solve/);
});