import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME4_RADIATION_ANOMALY_ASSUMPTION,
  BIOME4_VIRTUAL_CLIMATE_POLICY,
  biome4MonthlyPhotosyntheticForcing,
  biome4PetLookup,
  biome4RadiationPetDay,
  biome4VirtualDailyClimate
} from "../src/sim/Biome4VirtualClimateForcing.js";

const seasonalTemperature = [-8, -6, 0, 7, 14, 20, 23, 21, 15, 8, 1, -5];
const seasonalCloud = [65, 62, 58, 55, 50, 45, 42, 44, 48, 54, 60, 64];
const monthlyPrecipitation = [55, 48, 52, 60, 72, 80, 75, 68, 62, 58, 55, 52];

test("BIOME4 PET lookup is stepwise by the first source threshold not interpolated", () => {
  assert.deepEqual(biome4PetLookup(-20), { thresholdCelsius: -5, gamma: 64.6, lambda: 2.513 });
  assert.deepEqual(biome4PetLookup(-5), { thresholdCelsius: -5, gamma: 64.6, lambda: 2.513 });
  assert.deepEqual(biome4PetLookup(-4.999), { thresholdCelsius: 0, gamma: 64.9, lambda: 2.501 });
  assert.deepEqual(biome4PetLookup(20), { thresholdCelsius: 20, gamma: 66.1, lambda: 2.454 });
  assert.deepEqual(biome4PetLookup(20.001), { thresholdCelsius: 25, gamma: 66.5, lambda: 2.442 });
  assert.deepEqual(biome4PetLookup(90), { thresholdCelsius: 45, gamma: 67.8, lambda: 2.394 });
});

test("source radiation/PET forcing stays finite and seasonal at midlatitudes", () => {
  const winter = biome4RadiationPetDay({
    latitude: 45,
    dayOfYear: 15,
    temperatureCelsius: 0,
    cloudCoverPercent: 50
  });
  const summer = biome4RadiationPetDay({
    latitude: 45,
    dayOfYear: 197,
    temperatureCelsius: 20,
    cloudCoverPercent: 50
  });
  assert.equal(winter.policy, BIOME4_VIRTUAL_CLIMATE_POLICY);
  for (const sample of [winter, summer]) {
    assert.ok(sample.effectiveDaylengthHours >= 0 && sample.effectiveDaylengthHours <= 24);
    assert.ok(sample.potentialEvapotranspirationMm >= 0);
    assert.ok(sample.incomingSolarJm2Day >= 0);
    assert.ok(Number.isFinite(sample.positiveNetRadiationIntegral));
  }
  assert.ok(summer.effectiveDaylengthHours > winter.effectiveDaylengthHours);
  assert.ok(summer.incomingSolarJm2Day > winter.incomingSolarJm2Day);
  assert.ok(summer.potentialEvapotranspirationMm > winter.potentialEvapotranspirationMm);
});

test("monthly photosynthetic forcing uses all 12 source midmonth samples", () => {
  const forcing = biome4MonthlyPhotosyntheticForcing({
    latitude: 35,
    monthlyTemperatureCelsius: seasonalTemperature,
    monthlyCloudCoverPercent: seasonalCloud
  });
  assert.equal(forcing.length, 12);
  assert.deepEqual(forcing.map((entry) => entry.dayOfYear), [16, 44, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350]);
  assert.ok(forcing.every((entry) => entry.incomingSolarJm2Day >= 0));
  assert.ok(forcing.every((entry) => entry.radiationAnomaly === 1));
});

test("two-year snow forcing conserves precipitation into liquid soil input plus snow storage change", () => {
  const forcing = biome4VirtualDailyClimate({
    latitude: 50,
    monthlyTemperatureCelsius: seasonalTemperature,
    monthlyCloudCoverPercent: seasonalCloud,
    monthlyPrecipitationMm: monthlyPrecipitation
  });
  assert.equal(forcing.days.length, 365);
  assert.ok(forcing.days.some((day) => day.snowfallMm > 0));
  assert.ok(forcing.days.some((day) => day.snowmeltMm > 0));
  assert.ok(Math.abs(forcing.snowMassBalanceResidualMm) < 1e-6);
  assert.ok(Math.abs(
    forcing.precipitationInputMm - forcing.liquidToSoilMm - forcing.snowStorageChangeMm
  ) < 1e-5);
  assert.equal(forcing.radiationAnomalyAssumption, BIOME4_RADIATION_ANOMALY_ASSUMPTION);
});

test("cold precipitation enters snowpack and melt never exceeds the available pack", () => {
  const cold = biome4VirtualDailyClimate({
    latitude: 60,
    monthlyTemperatureCelsius: Array(12).fill(-10),
    monthlyCloudCoverPercent: Array(12).fill(50),
    monthlyPrecipitationMm: Array(12).fill(30),
    snowSpinupYears: 1
  });
  assert.ok(cold.days.every((day) => day.snowmeltMm === 0));
  assert.ok(cold.days.every((day) => Math.abs(day.snowfallMm - day.totalPrecipitationMm) < 1e-6));
  assert.ok(cold.finalSnowpackMm > 0);

  const mixed = biome4VirtualDailyClimate({
    latitude: 60,
    monthlyTemperatureCelsius: seasonalTemperature,
    monthlyCloudCoverPercent: seasonalCloud,
    monthlyPrecipitationMm: monthlyPrecipitation
  });
  let previousPack = mixed.finalYearStartSnowpackMm;
  for (const day of mixed.days) {
    assert.ok(day.snowmeltMm <= previousPack + day.snowfallMm + 1e-5);
    previousPack = day.snowpackMm;
  }
});

test("source calendar month index changes on actual non-leap month boundaries", () => {
  const forcing = biome4VirtualDailyClimate({
    latitude: 0,
    monthlyTemperatureCelsius: Array(12).fill(20),
    monthlyCloudCoverPercent: Array(12).fill(50),
    monthlyPrecipitationMm: Array.from({ length: 12 }, (_, month) => 30 + month)
  });
  assert.equal(forcing.days[0].monthIndex, 0);
  assert.equal(forcing.days[30].monthIndex, 0);
  assert.equal(forcing.days[31].monthIndex, 1);
  assert.equal(forcing.days[58].monthIndex, 2);
  assert.equal(forcing.days[364].monthIndex, 11);
});
