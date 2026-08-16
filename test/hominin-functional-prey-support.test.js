import test from "node:test";
import assert from "node:assert/strict";
import { advanceHomininLineages } from "../src/sim/HomininLineages.js";

function hominin(overrides = {}) {
  return {
    id: "H1",
    parentId: null,
    birthYearBP: 777000,
    extinctionYearBP: null,
    populationIndex: 0.5,
    brainIndex: 0.45,
    dexterity: 0.55,
    sociality: 0.5,
    mobility: 0.55,
    communication: 0.32,
    cumulativeCulture: 0.12,
    toolComplexity: 0.18,
    fireReliance: 0.08,
    ecologicalBreadth: 0.5,
    divergence: 0,
    ...overrides
  };
}

function baseState(lineage) {
  return {
    seed: 777001,
    yearBP: 760000,
    temperatureAnomaly: -1,
    greenhouseForcing: 0,
    iceIndex: 0.18,
    productivityIndex: 1,
    speciesRichness: 12,
    homininLineages: [lineage]
  };
}

function advancePopulation(state) {
  advanceHomininLineages(state, 25, () => 1);
  return state.homininLineages[0].populationIndex;
}

test("functional prey biomass overrides stale herbivore compatibility aliases", () => {
  const first = {
    ...baseState(hominin()),
    animalBiomass: 3,
    animalPlantMatterBiomass: 2.4,
    animalLivePreyBiomass: 0.6,
    herbivoreBiomass: 0.01
  };
  const second = {
    ...baseState(hominin()),
    animalBiomass: 3,
    animalPlantMatterBiomass: 2.4,
    animalLivePreyBiomass: 0.6,
    herbivoreBiomass: 9
  };

  assert.equal(advancePopulation(first), advancePopulation(second));
});

test("hominin subsistence responds to functional plant-matter animal biomass", () => {
  const low = {
    ...baseState(hominin()),
    animalBiomass: 3,
    animalPlantMatterBiomass: 0.2,
    animalLivePreyBiomass: 2.8,
    herbivoreBiomass: 7
  };
  const high = {
    ...baseState(hominin()),
    animalBiomass: 3,
    animalPlantMatterBiomass: 2.4,
    animalLivePreyBiomass: 0.6,
    herbivoreBiomass: 7
  };

  assert.ok(advancePopulation(high) > advancePopulation(low));
});

test("legacy raw states still use herbivore biomass when functional fauna fields are absent", () => {
  const low = {
    ...baseState(hominin()),
    herbivoreBiomass: 0.2
  };
  const high = {
    ...baseState(hominin()),
    herbivoreBiomass: 2.4
  };

  assert.ok(advancePopulation(high) > advancePopulation(low));
  assert.equal(low.animalPlantMatterBiomass, undefined);
  assert.equal(high.animalPlantMatterBiomass, undefined);
});
