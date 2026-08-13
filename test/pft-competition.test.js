import assert from "node:assert/strict";
import test from "node:test";

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
