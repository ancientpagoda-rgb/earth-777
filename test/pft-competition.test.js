import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME4_BIOME_CLASSIFIER_POLICY,
  biome4BiomeClassifierDiagnostic
} from "../src/sim/Biome4BiomeClassifier.js";
import {
  BIOME4_MIXED_PFT_ID,
  BIOME4_PFT_COMPETITION_POLICY,
  biome4PftCompetitionDiagnostic
} from "../src/sim/Biome4PftCompetition.js";

function candidate(pftId, {
  npp = 0,
  lai = 0,
  fireDays = 0,
  greenDays = 300,
  meanTopWetnessPercent = 50,
  driestTopWetnessPercent = 20
} = {}) {
  const fireDryness = npp > 0 ? {
    fire: { scaledPotentialFireDays: fireDays },
    dryness: {
      meanTopLayerWetnessPercent: meanTopWetnessPercent,
      driestTopLayerWetnessPercent: driestTopWetnessPercent
    }
  } : null;
  return {
    pftId,
    laiNppOptimization: {
      optimumNpp: npp,
      optimumLai: lai,
      optimumEvaluation: npp > 0 ? { hydrology: { greenDays } } : null,
      fireDryness
    },
    fireDryness
  };
}

const temperateClimate = Object.freeze({
  absoluteMinimumCelsius: -8,
  coldestMonthCelsius: 4,
  gdd5: 3200,
  gdd0: 5000
});

function compete(candidates, climateIndices = temperateClimate, annualPrecipitationMm = 1800) {
  return biome4PftCompetitionDiagnostic({ candidates, climateIndices, annualPrecipitationMm });
}

function classify(competition, candidates) {
  return biome4BiomeClassifierDiagnostic({ competition, candidates });
}

test("ordinary productive woody PFT remains the diagnostic BIOME4 selection", () => {
  const result = compete([
    candidate(2, { npp: 2400, lai: 4.2 }),
    candidate(9, { npp: 900, lai: 2.1 })
  ]);
  assert.equal(result.policy, BIOME4_PFT_COMPETITION_POLICY);
  assert.equal(result.selectedPftId, 2);
  assert.equal(result.dominantWoodyPftId, 2);
  assert.equal(result.dominantGrassPftId, 9);
  assert.equal(result.classifierInvoked, false);
  assert.equal(result.appliedToVegetation, false);
});

test("PFT2 plus C4 grass enters source pseudo-PFT 14 when woody LAI is below 3.6", () => {
  const result = compete([
    candidate(2, { npp: 1500, lai: 3.2 }),
    candidate(9, { npp: 1000, lai: 2.4 })
  ]);
  assert.equal(result.selectedPftId, BIOME4_MIXED_PFT_ID);
  assert.equal(result.dominantDataPftId, 2);
  assert.equal(result.mixture?.woodyPftId, 2);
  assert.equal(result.mixture?.grassPftId, 9);
  assert.ok(result.mixture.treeFraction >= 0 && result.mixture.treeFraction <= 1);
  assert.ok(result.mixture.grassFraction >= 0 && result.mixture.grassFraction <= 1);
});

test("PFT10 is treated as non-grass and can lose to a higher-NPP non-PFT9 grass", () => {
  const result = compete([
    candidate(10, { npp: 600, lai: 2.2 }),
    candidate(8, { npp: 700, lai: 2.0 })
  ]);
  assert.equal(result.initialDominantWoodyPftId, 10);
  assert.equal(result.initialDominantGrassPftId, 8);
  assert.equal(result.selectedPftId, 8);
  assert.ok(result.trace.some((entry) => entry.rule === "PFT10 loses to non-PFT9 grass NPP"));
});

test("forced-present PFT12 dry switch is retained, then zero LAI nullifies the source selection", () => {
  const result = compete([
    candidate(11, { npp: 500, lai: 2.0, meanTopWetnessPercent: 20 }),
    candidate(12, { npp: 0, lai: 0 })
  ]);
  assert.ok(result.presentPftIds.includes(12));
  assert.ok(result.trace.some((entry) => entry.rule === "dry PFT11 to forced-present PFT12"));
  assert.ok(result.trace.some((entry) => entry.rule === "zero-dominant-LAI nullification"));
  assert.equal(result.selectedPftId, 0);
});

test("classifier maps barren and PFT11 GDD bands without applying a category", () => {
  const barren = classify({
    selectedPftId: 0,
    dominantWoodyPftId: 0,
    dominantGrassPftId: 0,
    subdominantWoodyPftId: 0,
    dominantDataPftId: 0,
    presentPftIds: [],
    climateInputs: { gdd0: 0, gdd5: 0, tcm: -20, tmin: -30 }
  }, []);
  assert.equal(barren.policy, BIOME4_BIOME_CLASSIFIER_POLICY);
  assert.equal(barren.biomeCode, 27);
  assert.equal(barren.appliedToVegetation, false);

  const tundraCandidate = [candidate(11, { npp: 400, lai: 2 })];
  for (const [gdd0, expected] of [[100, 25], [300, 24], [700, 23]]) {
    const result = classify({
      selectedPftId: 11,
      dominantWoodyPftId: 0,
      dominantGrassPftId: 11,
      subdominantWoodyPftId: 0,
      dominantDataPftId: 11,
      presentPftIds: [11, 12],
      climateInputs: { gdd0, gdd5: 200, tcm: -10, tmin: -20 }
    }, tundraCandidate);
    assert.equal(result.biomeCode, expected);
  }
});

test("classifier preserves the source low-NPP PFT8 OR-condition behavior", () => {
  const candidates = [candidate(8, { npp: 50, lai: 2 }), candidate(6, { npp: 40, lai: 2 })];
  const result = classify({
    selectedPftId: 8,
    dominantWoodyPftId: 6,
    dominantGrassPftId: 8,
    subdominantWoodyPftId: 6,
    dominantDataPftId: 8,
    presentPftIds: [6, 8],
    climateInputs: { gdd0: 1200, gdd5: 1000, tcm: -5, tmin: -12 }
  }, candidates);
  assert.equal(result.biomeCode, 21);
  assert.match(result.rule, /source OR-condition/);
});

test("classifier reproduces PFT2 tropical green-season classes", () => {
  for (const [greenDays, expected] of [[320, 1], [280, 2], [240, 3]]) {
    const candidates = [candidate(2, { npp: 2200, lai: 4.5, greenDays })];
    const result = classify({
      selectedPftId: 2,
      dominantWoodyPftId: 2,
      dominantGrassPftId: 0,
      subdominantWoodyPftId: 0,
      dominantDataPftId: 2,
      presentPftIds: [2],
      climateInputs: { gdd0: 7000, gdd5: 5500, tcm: 22, tmin: 12 }
    }, candidates);
    assert.equal(result.biomeCode, expected);
  }
});
