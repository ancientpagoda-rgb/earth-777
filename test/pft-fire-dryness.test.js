import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME4_FIRE_DRYNESS_POLICY,
  BIOME4_FIRE_WETNESS_THRESHOLDS,
  biome4DrynessDiagnostic,
  biome4FireBurnWeight,
  biome4FireDiagnostic,
  biome4FireDrynessDiagnostic
} from "../src/sim/Biome4FireDryness.js";

test("BIOME4 fire threshold table preserves all 13 source values", () => {
  assert.deepEqual(BIOME4_FIRE_WETNESS_THRESHOLDS, [
    0.25, 0.20, 0.40, 0.33, 0.40, 0.33, 0.33, 0.40, 0.40, 0.33, 0.33, 0.33, 0.33
  ]);
});

test("fire burn weight reproduces the source threshold transition and strict upper discontinuity", () => {
  const threshold = BIOME4_FIRE_WETNESS_THRESHOLDS[3];
  assert.equal(biome4FireBurnWeight(threshold - 1e-6, 4), 1);
  assert.equal(biome4FireBurnWeight(threshold, 4), 1);
  assert.ok(Math.abs(biome4FireBurnWeight(threshold + 0.05, 4) - Math.exp(-0.05)) < 1e-12);
  assert.equal(biome4FireBurnWeight(threshold + 0.050001, 4), 0);
});

test("fire days are scaled linearly by NPP below 1000 after the raw fire metric is calculated", () => {
  const dry = Array(365).fill(0);
  const high = biome4FireDiagnostic({ pftId: 6, lai: 4, npp: 1200, dailyRootZoneWetness: dry });
  const low = biome4FireDiagnostic({ pftId: 6, lai: 4, npp: 500, dailyRootZoneWetness: dry });
  assert.equal(high.rawPotentialFireDays, 365);
  assert.equal(high.scaledPotentialFireDays, 365);
  assert.equal(low.rawPotentialFireDays, 365);
  assert.equal(low.scaledPotentialFireDays, 182.5);
  assert.equal(low.nppFireScalingFactor, 0.5);
  assert.ok(low.sourceBurnMetric > 0);
  assert.equal(low.fireFractionBeforeNppScaling, 1);
});

test("non-positive NPP reports zero competition-relevant fire days", () => {
  const result = biome4FireDiagnostic({
    pftId: 4,
    lai: 2,
    npp: 0,
    dailyRootZoneWetness: Array(365).fill(0)
  });
  assert.equal(result.scaledPotentialFireDays, 0);
  assert.equal(result.rawPotentialFireDays, 0);
});

test("dryness diagnostic uses monthly top-layer wetness exactly like competition2", () => {
  const monthly = Array.from({ length: 12 }, (_, month) => [
    0.5,
    month === 6 ? 0.12 : 0.42,
    0.65
  ]);
  const dryness = biome4DrynessDiagnostic(monthly);
  assert.equal(dryness.driestMonthNumber, 7);
  assert.equal(dryness.driestTopLayerWetnessPercent, 12);
  assert.equal(dryness.meanBottomLayerWetnessPercent, 65);
  assert.ok(dryness.meanTopLayerWetnessPercent > 0);
});

test("combined diagnostic keeps fire root wetness separate from top-layer competition dryness", () => {
  const hydrology = {
    daily: Array.from({ length: 365 }, (_, day) => ({ rootZoneWetness: day < 100 ? 0.1 : 0.8 })),
    monthlyMeanRootWetness: Array.from({ length: 12 }, (_, month) => [0.6, month === 3 ? 0.2 : 0.7, 0.8])
  };
  const result = biome4FireDrynessDiagnostic({ pftId: 4, lai: 3, npp: 1400, hydrology });
  assert.equal(result.policy, BIOME4_FIRE_DRYNESS_POLICY);
  assert.ok(result.fire.scaledPotentialFireDays > 0);
  assert.equal(result.dryness.driestMonthNumber, 4);
  assert.equal(result.dryness.driestTopLayerWetnessPercent, 20);
  assert.equal(result.occupancyFeedbackEnabled, false);
  assert.equal(result.categoricalBiomeTransitionsEnabled, false);
});
