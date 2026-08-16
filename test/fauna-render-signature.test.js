import test from "node:test";
import assert from "node:assert/strict";
import { faunaStateSignature } from "../src/render/SurfaceFaunaManager.js";

test("current fauna render signature ignores stale legacy biomass aliases", () => {
  const common = {
    animalBiomass: 1.25,
    animalPlantMatterShare: 0.7,
    animalLivePreyShare: 0.3,
    animalPlantMatterBiomass: 0.875,
    animalLivePreyBiomass: 0.375
  };
  const lowLegacy = faunaStateSignature({ ...common, herbivoreBiomass: 0, carnivoreBiomass: 0 });
  const highLegacy = faunaStateSignature({ ...common, herbivoreBiomass: 8, carnivoreBiomass: 8 });
  assert.equal(lowLegacy, highLegacy);
  assert.equal(lowLegacy, "unified:1.250:0.700:0.300");
});

test("authoritative biomass and continuous feeding composition change the render signature", () => {
  const base = faunaStateSignature({ animalBiomass: 1, animalPlantMatterShare: 0.8, animalLivePreyShare: 0.2 });
  const biomassChanged = faunaStateSignature({ animalBiomass: 1.1, animalPlantMatterShare: 0.8, animalLivePreyShare: 0.2 });
  const feedingChanged = faunaStateSignature({ animalBiomass: 1, animalPlantMatterShare: 0.6, animalLivePreyShare: 0.4 });
  assert.notEqual(base, biomassChanged);
  assert.notEqual(base, feedingChanged);
});

test("legacy raw states retain legacy signature behavior", () => {
  assert.equal(faunaStateSignature({ herbivoreBiomass: 2, carnivoreBiomass: 0.5 }), "legacy:2.000:0.500");
  assert.notEqual(
    faunaStateSignature({ herbivoreBiomass: 2, carnivoreBiomass: 0.5 }),
    faunaStateSignature({ herbivoreBiomass: 3, carnivoreBiomass: 0.5 })
  );
});

test("missing explicit shares fall back to normalized functional biomass composition", () => {
  assert.equal(
    faunaStateSignature({ animalBiomass: 2, animalPlantMatterBiomass: 1.5, animalLivePreyBiomass: 0.5 }),
    "unified:2.000:0.750:0.250"
  );
});
