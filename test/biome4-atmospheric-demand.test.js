import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME4_ATMOSPHERIC_DEMAND_POLICY,
  BIOME4_RADIATION_ANOMALY_MULTIPLIER,
  biome4AtmosphericEquilibriumDemand,
  biome4ThermodynamicLookup
} from "../src/sim/Biome4AtmosphericDemand.js";

const seasonalTemperature = [-2, 0, 4, 9, 14, 19, 22, 21, 16, 10, 4, 0];
const seasonalCloud = [65, 62, 58, 55, 50, 47, 45, 46, 50, 55, 60, 64];

test("BIOME4 thermodynamic table uses the source stepwise temperature lookup", () => {
  assert.deepEqual(biome4ThermodynamicLookup(-20), {
    psychrometricConstantPaPerK: 64.6,
    latentHeatMjKg: 2.513
  });
  assert.deepEqual(biome4ThermodynamicLookup(5), {
    psychrometricConstantPaPerK: 65.2,
    latentHeatMjKg: 2.489
  });
  assert.deepEqual(biome4ThermodynamicLookup(5.01), {
    psychrometricConstantPaPerK: 65.6,
    latentHeatMjKg: 2.477
  });
  assert.deepEqual(biome4ThermodynamicLookup(80), {
    psychrometricConstantPaPerK: 67.8,
    latentHeatMjKg: 2.394
  });
});

test("BIOME4 ppeett reproduction is deterministic, finite, and source-shaped", () => {
  const input = {
    latitude: 45,
    monthlyTemperatureCelsius: seasonalTemperature,
    monthlyCloudCoverPercent: seasonalCloud
  };
  const a = biome4AtmosphericEquilibriumDemand(input);
  const b = biome4AtmosphericEquilibriumDemand(input);
  assert.equal(a.policy, BIOME4_ATMOSPHERIC_DEMAND_POLICY);
  assert.equal(a.dailyEquilibriumDemandMm.length, 365);
  assert.equal(a.dailyEffectiveDaylengthHours.length, 365);
  assert.equal(a.monthlyIncomingSolarJm2Day.length, 12);
  assert.deepEqual(Array.from(a.dailyEquilibriumDemandMm), Array.from(b.dailyEquilibriumDemandMm));
  assert.ok(Array.from(a.dailyEquilibriumDemandMm).every(Number.isFinite));
  assert.ok(Array.from(a.dailyEffectiveDaylengthHours).every((value) => Number.isFinite(value) && value >= 0 && value <= 24));
  assert.ok(Array.from(a.monthlyIncomingSolarJm2Day).every((value) => Number.isFinite(value) && value >= 0));
  assert.ok(a.annualEquilibriumDemandMm > 0);
  assert.equal(a.radiationAnomalyMultiplier, BIOME4_RADIATION_ANOMALY_MULTIPLIER);
  assert.deepEqual(Array.from(a.radiationAnomalyMultiplier), Array(12).fill(1));
});

test("BIOME4 ppeett naturally reaches zero during polar night without an external VPD field", () => {
  const demand = biome4AtmosphericEquilibriumDemand({
    latitude: 80,
    monthlyTemperatureCelsius: [-25, -24, -18, -8, 0, 5, 8, 6, 0, -8, -18, -24],
    monthlyCloudCoverPercent: Array(12).fill(60)
  });
  const winter = Array.from(demand.dailyEffectiveDaylengthHours).slice(0, 30);
  assert.ok(winter.some((value) => value === 0));
  for (let index = 0; index < winter.length; index += 1) {
    if (winter[index] === 0) assert.equal(demand.dailyEquilibriumDemandMm[index], 0);
  }
});
