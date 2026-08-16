import test from "node:test";
import assert from "node:assert/strict";
import { advanceEvolutionaryEcology } from "../src/sim/EvolutionaryEcology.js";

function lineage(overrides = {}) {
  return {
    id: 1,
    parentId: null,
    birthYearBP: 777000,
    extinctionYearBP: null,
    populationIndex: 0.5,
    trophicLevel: 0.5,
    plantMatterAffinity: 0.5,
    livePreyAffinity: 0.5,
    carrionAffinity: 0,
    bodyMassLog10Kg: 1,
    thermalOptimumK: -1,
    mobility: 0.5,
    sociality: 0.5,
    cognition: 0.5,
    dietBreadth: 0.5,
    divergence: 0,
    ...overrides
  };
}

function baseState(animal) {
  return {
    seed: 777001,
    yearBP: 760000,
    temperatureAnomaly: -1,
    greenhouseForcing: 0,
    iceIndex: 0.18,
    productivityIndex: 1,
    predationPressureIndex: 0,
    predationExposureIndex: 0,
    speciesLineages: [animal]
  };
}

function advancePopulation(state) {
  advanceEvolutionaryEcology(state, 25, () => 1);
  return state.speciesLineages[0].populationIndex;
}

test("functional plant-matter biomass overrides stale legacy prey aliases", () => {
  const animal = lineage({ plantMatterAffinity: 0, livePreyAffinity: 1, carrionAffinity: 0, trophicLevel: 1 });
  const first = {
    ...baseState(structuredClone(animal)),
    animalBiomass: 3,
    animalPlantMatterBiomass: 2.4,
    animalLivePreyBiomass: 0.6,
    herbivoreBiomass: 0.01,
    carnivoreBiomass: 9
  };
  const second = {
    ...baseState(structuredClone(animal)),
    animalBiomass: 3,
    animalPlantMatterBiomass: 2.4,
    animalLivePreyBiomass: 0.6,
    herbivoreBiomass: 8,
    carnivoreBiomass: 0.01
  };

  assert.equal(advancePopulation(first), advancePopulation(second));
});

test("carrion resource support follows total animal biomass rather than the legacy carnivore projection", () => {
  const carrionForager = lineage({
    plantMatterAffinity: 0,
    livePreyAffinity: 0,
    carrionAffinity: 1,
    trophicLevel: 0.5
  });
  const low = {
    ...baseState(structuredClone(carrionForager)),
    animalBiomass: 0.4,
    animalPlantMatterBiomass: 0.2,
    animalLivePreyBiomass: 0.2,
    herbivoreBiomass: 0.2,
    carnivoreBiomass: 7
  };
  const high = {
    ...baseState(structuredClone(carrionForager)),
    animalBiomass: 4,
    animalPlantMatterBiomass: 2,
    animalLivePreyBiomass: 2,
    herbivoreBiomass: 2,
    carnivoreBiomass: 7
  };

  assert.ok(advancePopulation(high) > advancePopulation(low));
});

test("legacy raw states still provide deterministic resource support when unified fauna fields are absent", () => {
  const animal = lineage({ plantMatterAffinity: 0, livePreyAffinity: 1, carrionAffinity: 0.5, trophicLevel: 1 });
  const state = {
    ...baseState(animal),
    herbivoreBiomass: 2,
    carnivoreBiomass: 0.5
  };

  const population = advancePopulation(state);
  assert.ok(Number.isFinite(population));
  assert.ok(population > 0);
  assert.equal(state.animalBiomass, undefined);
  assert.equal(state.animalPlantMatterBiomass, undefined);
});
