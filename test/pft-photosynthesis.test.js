import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME4_C4_OXYGEN_ORDER_DISCREPANCY,
  BIOME4_EXTINCTION_COEFFICIENT,
  BIOME4_MAX_C3_CI_CA_RATIO,
  BIOME4_PFT_PHOTOSYNTHESIS_POLICY,
  biome4C3Photosynthesis,
  biome4C4Photosynthesis,
  biome4FvcFromLai,
  biome4InitialPhotosyntheticPathway,
  biome4OptimumCanopyConductance
} from "../src/sim/Biome4PftPhotosynthesis.js";

const productive = Object.freeze({
  incomingSolarJm2Day: 20_000_000,
  effectiveDaylengthHours: 12,
  temperatureCelsius: 20,
  pressurePa: 101_325,
  co2Ppm: 245
});

test("BIOME4 LAI-to-FVC follows the PFT-specific Beer-Lambert coefficient exactly", () => {
  assert.equal(BIOME4_EXTINCTION_COEFFICIENT.length, 13);
  const lai = 3;
  const expected = 1 - Math.exp(-0.6 * lai);
  assert.ok(Math.abs(biome4FvcFromLai(4, lai) - expected) < 1e-12);
  assert.equal(biome4FvcFromLai(4, 0), 0);
});

test("BIOME4 initial pathway matches the executable growth branch", () => {
  assert.equal(biome4InitialPhotosyntheticPathway(8), "c3");
  assert.equal(biome4InitialPhotosyntheticPathway(9), "c4");
  assert.equal(biome4InitialPhotosyntheticPathway(10), "c4");
  assert.equal(biome4InitialPhotosyntheticPathway(11), "c3");
});

test("C3 photosynthesis is deterministic, finite, and inactive below the PFT minimum temperature", () => {
  const fpar = biome4FvcFromLai(4, 3);
  const active = biome4C3Photosynthesis({
    pftId: 4,
    ciCaRatio: BIOME4_MAX_C3_CI_CA_RATIO[3],
    fpar,
    ...productive
  });
  const repeat = biome4C3Photosynthesis({
    pftId: 4,
    ciCaRatio: BIOME4_MAX_C3_CI_CA_RATIO[3],
    fpar,
    ...productive
  });
  assert.deepEqual(active, repeat);
  assert.equal(active.policy, BIOME4_PFT_PHOTOSYNTHESIS_POLICY);
  assert.ok(active.temperatureStress > 0);
  assert.ok(active.vmax > 0);
  assert.ok(active.grossPhotosynthesis > 0);
  assert.ok(active.gasExchangeAday > 0);

  const cold = biome4C3Photosynthesis({
    pftId: 4,
    ciCaRatio: BIOME4_MAX_C3_CI_CA_RATIO[3],
    fpar,
    ...productive,
    temperatureCelsius: 4
  });
  assert.equal(cold.temperatureStress, 0);
  assert.equal(cold.vmax, 0);
  assert.equal(cold.grossPhotosynthesis, 0);
  assert.equal(cold.gasExchangeAday, 0);
});

test("zero absorbed solar radiation produces zero C3 and C4 activity", () => {
  const c3 = biome4C3Photosynthesis({
    pftId: 4,
    ciCaRatio: 0.8,
    fpar: 0.8,
    ...productive,
    incomingSolarJm2Day: 0
  });
  const c4 = biome4C4Photosynthesis({
    pftId: 9,
    ciCaRatio: 0.4,
    fpar: 0.8,
    ...productive,
    incomingSolarJm2Day: 0,
    temperatureCelsius: 30
  });
  assert.equal(c3.vmax, 0);
  assert.equal(c3.grossPhotosynthesis, 0);
  assert.equal(c4.vmax, 0);
  assert.equal(c4.grossPhotosynthesis, 0);
});

test("leaf longevity enters the source leaf-cost term as the fourth root of months over twelve", () => {
  const shortLived = biome4C3Photosynthesis({
    pftId: 4,
    ciCaRatio: 0.8,
    fpar: 0.8,
    ...productive
  });
  const longLived = biome4C3Photosynthesis({
    pftId: 5,
    ciCaRatio: 0.8,
    fpar: 0.8,
    ...productive
  });
  assert.ok(Math.abs(shortLived.leafCost - (7 / 12) ** 0.25) < 1e-6);
  assert.ok(Math.abs(longLived.leafCost - (30 / 12) ** 0.25) < 1e-6);
  assert.ok(longLived.leafCost > shortLived.leafCost);
});

test("C4 photosynthesis exposes the source O2-order repair and applies low-Ci/Ca damage", () => {
  const normal = biome4C4Photosynthesis({
    pftId: 9,
    ciCaRatio: 0.4,
    fpar: 0.8,
    ...productive,
    temperatureCelsius: 30
  });
  const damaged = biome4C4Photosynthesis({
    pftId: 9,
    ciCaRatio: 0.2,
    fpar: 0.8,
    ...productive,
    temperatureCelsius: 30
  });
  assert.equal(normal.c4DamageFactor, 1);
  assert.equal(damaged.c4DamageFactor, 0.5);
  assert.ok(damaged.grossPhotosynthesis < normal.grossPhotosynthesis);
  assert.equal(normal.sourceRepair, BIOME4_C4_OXYGEN_ORDER_DISCREPANCY);
  assert.match(normal.epistemicStatus, /deterministic repair/);
});

test("PFT10 uses the source-specific lower C4 quantum/tune response than tropical grass under equal forcing", () => {
  const pft9 = biome4C4Photosynthesis({
    pftId: 9,
    ciCaRatio: 0.4,
    fpar: 0.8,
    ...productive,
    temperatureCelsius: 30
  });
  const pft10 = biome4C4Photosynthesis({
    pftId: 10,
    ciCaRatio: 0.4,
    fpar: 0.8,
    ...productive,
    temperatureCelsius: 30
  });
  assert.ok(pft10.vmax < pft9.vmax);
  assert.ok(pft10.grossPhotosynthesis < pft9.grossPhotosynthesis);
});

test("optimum non-water-stressed canopy conductance is finite, nonnegative, and rises above gmin under productive forcing", () => {
  const trial = biome4OptimumCanopyConductance({
    pftId: 4,
    lai: 3,
    ...productive
  });
  assert.equal(trial.pathway, "c3");
  assert.equal(trial.ciCaRatio, BIOME4_MAX_C3_CI_CA_RATIO[3]);
  assert.ok(Number.isFinite(trial.optimumConductance));
  assert.ok(trial.optimumConductance > trial.minimumCanopyConductance);

  const inactive = biome4OptimumCanopyConductance({
    pftId: 4,
    lai: 3,
    ...productive,
    temperatureCelsius: -20
  });
  assert.equal(inactive.optimumConductance, 0);
});
