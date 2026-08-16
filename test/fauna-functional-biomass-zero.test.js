import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedFauna, faunaPopulationAt } from "../src/sim/FaunaRuntime.js";

const vegetation = Object.freeze({ biomeCode: 17, npp: 1300, lai: 3.2 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 480 });

function plantLineage() {
  return {
    id: 1301,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0,
    plantMatterAffinity: 1,
    livePreyAffinity: 0,
    carrionAffinity: 0,
    bodyMassLog10Kg: 1,
    mobility: 0.6,
    sociality: 0.7,
    cognition: 0.4,
    dietBreadth: 0.4,
    thermalOptimumK: -1
  };
}

function unifiedState(legacyOverrides = {}) {
  return {
    seed: 777001,
    elapsedYears: 12,
    temperatureAnomaly: -1,
    productivityIndex: 1,
    animalBiomass: 1,
    animalPlantMatterShare: 1,
    animalLivePreyShare: 0,
    animalPlantMatterBiomass: 1,
    animalLivePreyBiomass: 0,
    predationExposureIndex: 0,
    speciesLineages: [plantLineage()],
    // Deliberately stale compatibility aliases. Current functional state must
    // not read these when the unified fields are present.
    herbivoreBiomass: 0.01,
    carnivoreBiomass: 8,
    ...legacyOverrides
  };
}

function fieldFor(state) {
  return faunaPopulationAt({
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    areaKm2: 10,
    key: "functional-zero-test"
  });
}

test("zero live-prey biomass produces zero live-prey observed population", () => {
  const state = unifiedState();
  const field = fieldFor(state);

  assert.equal(field.unifiedAnimalBiomass, true);
  assert.equal(field.plantMatterBiomass, 1);
  assert.equal(field.livePreyBiomass, 0);
  assert.equal(field.predatorPressure, 0);
  assert.equal(field.carnivoreDensityAnimalsPerKm2, 0);
  assert.equal(field.carnivorePopulation, 0);

  const plan = buildObservedFauna({
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    faunaField: field,
    latitude: 39,
    longitude: -95,
    seed: 19,
    windowRadiusKm: 3,
    individualRadiusKm: 0.05
  });
  assert.equal(plan.visibleCarnivorePopulation, 0);
  assert.equal(plan.packs.length, 0);
  assert.ok(plan.visiblePopulation > 0);
});

test("stale herbivore/carnivore aliases cannot alter unified fauna fields", () => {
  const lowLegacy = fieldFor(unifiedState({ herbivoreBiomass: 0, carnivoreBiomass: 0 }));
  const highLegacy = fieldFor(unifiedState({ herbivoreBiomass: 8, carnivoreBiomass: 8 }));
  assert.deepEqual(highLegacy, lowLegacy);
});

test("legacy-only states retain the compatibility biomass floors", () => {
  const legacy = fieldFor({
    productivityIndex: 1,
    herbivoreBiomass: 0,
    carnivoreBiomass: 0,
    predationExposureIndex: 0
  });
  assert.equal(legacy.unifiedAnimalBiomass, false);
  assert.ok(legacy.plantMatterBiomass > 0);
  assert.ok(legacy.livePreyBiomass > 0);
});
