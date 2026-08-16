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

function stateFor(lineages, overrides = {}) {
  return {
    seed: 777001,
    yearBP: 760000,
    temperatureAnomaly: -1,
    greenhouseForcing: 0,
    iceIndex: 0.18,
    productivityIndex: 1,
    animalBiomass: 2,
    animalPlantMatterBiomass: 1,
    animalLivePreyBiomass: 1,
    herbivoreBiomass: 1,
    carnivoreBiomass: 1,
    predationPressureIndex: 0,
    predationExposureIndex: 0,
    speciesLineages: lineages,
    ...overrides
  };
}

function advancePopulation(state, index = 0) {
  advanceEvolutionaryEcology(state, 25, () => 1);
  return state.speciesLineages[index].populationIndex;
}

test("carrion specialization creates niche separation beyond the trophic summary", () => {
  const focal = lineage({ id: 1, carrionAffinity: 0, populationIndex: 0.5 });
  const sameNiche = stateFor([
    structuredClone(focal),
    lineage({ id: 2, carrionAffinity: 0, populationIndex: 1 })
  ]);
  const separatedNiche = stateFor([
    structuredClone(focal),
    lineage({ id: 2, carrionAffinity: 1, populationIndex: 1 })
  ]);

  const crowdedPopulation = advancePopulation(sameNiche);
  const separatedPopulation = advancePopulation(separatedNiche);
  assert.ok(separatedPopulation > crowdedPopulation);
});

test("carrion-only feeding does not inherit fake hunting or prey-exposure selection", () => {
  const scavenger = lineage({
    plantMatterAffinity: 0,
    livePreyAffinity: 0,
    carrionAffinity: 1,
    trophicLevel: 0.5
  });
  const noPressure = stateFor([structuredClone(scavenger)]);
  const highPressure = stateFor([structuredClone(scavenger)], {
    predationPressureIndex: 3,
    predationExposureIndex: 3
  });

  assert.equal(advancePopulation(highPressure), advancePopulation(noPressure));
});

test("true live-prey dependence still receives hunting-side predation selection", () => {
  const hunter = lineage({
    plantMatterAffinity: 0,
    livePreyAffinity: 1,
    carrionAffinity: 0,
    trophicLevel: 1,
    mobility: 0.9,
    cognition: 0.9
  });
  const noPressure = stateFor([structuredClone(hunter)]);
  const highPressure = stateFor([structuredClone(hunter)], {
    predationPressureIndex: 3,
    predationExposureIndex: 3
  });

  assert.ok(advancePopulation(highPressure) > advancePopulation(noPressure));
});
