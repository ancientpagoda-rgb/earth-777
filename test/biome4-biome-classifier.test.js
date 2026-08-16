import assert from "node:assert/strict";
import test from "node:test";

import { biome4BiomeClassifierDiagnostic } from "../src/sim/Biome4BiomeClassifier.js";

function candidate(pftId, npp, lai, greenDays = 300) {
  return { pftId, laiNppOptimization: { optimumNpp: npp, optimumLai: lai, optimumEvaluation: { hydrology: { greenDays } } } };
}

function competition(overrides = {}) {
  return {
    selectedPftId: 9,
    dominantWoodyPftId: 2,
    dominantGrassPftId: 9,
    subdominantWoodyPftId: 0,
    dominantDataPftId: 9,
    presentPftIds: [2, 9, 12],
    climateInputs: { gdd0: 2500, gdd5: 1800, tcm: 16, tmin: 4 },
    ...overrides
  };
}

test("BIOME4 classifier maps PFT9 to its source tropical-grassland category", () => {
  const result = biome4BiomeClassifierDiagnostic({ competition: competition(), candidates: [candidate(2, 1100, 2.5), candidate(9, 1200, 2.1)] });
  assert.equal(result.biomeCode, 19);
  assert.equal(result.biomeLabel, "Tropical grassland");
  assert.equal(result.appliedToVegetation, false);
});

test("BIOME4 classifier preserves the source PFT8 low-NPP OR-condition", () => {
  const result = biome4BiomeClassifierDiagnostic({
    competition: competition({ selectedPftId: 8, dominantGrassPftId: 8, dominantDataPftId: 8, subdominantWoodyPftId: 6 }),
    candidates: [candidate(8, 80, 1.5)]
  });
  assert.equal(result.biomeCode, 21);
  assert.match(result.rule, /source OR-condition/);
});

test("BIOME4 classifier keeps land ice outside PFT outcome assignment", () => {
  const result = biome4BiomeClassifierDiagnostic({ competition: competition({ selectedPftId: 0, dominantDataPftId: 0 }), candidates: [] });
  assert.equal(result.biomeCode, 27);
  assert.equal(result.sourceQuirks.landIceUpstream.includes("upstream"), true);
});
