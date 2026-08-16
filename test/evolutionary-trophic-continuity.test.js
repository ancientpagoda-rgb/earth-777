import test from "node:test";
import assert from "node:assert/strict";
import { advanceEvolutionaryEcology } from "../src/sim/EvolutionaryEcology.js";

function stateAt(trophicLevel) {
  return {
    seed: 777001,
    yearBP: 776999,
    temperatureAnomaly: -1,
    greenhouseForcing: 0,
    iceIndex: 0.18,
    productivityIndex: 1,
    herbivoreBiomass: 1,
    carnivoreBiomass: 1,
    predationPressureIndex: 1,
    predationExposureIndex: 1,
    speciesLineages: [{
      id: 1,
      parentId: null,
      birthYearBP: 777000,
      extinctionYearBP: null,
      populationIndex: 0.5,
      trophicLevel,
      bodyMassLog10Kg: 1,
      thermalOptimumK: -1,
      mobility: 0.6,
      sociality: 0.5,
      cognition: 0.4,
      dietBreadth: 0.5,
      divergence: 0
    }]
  };
}

function populationAfterOneYear(trophicLevel) {
  const state = stateAt(trophicLevel);
  advanceEvolutionaryEcology(state, 1, () => 1);
  return state.speciesLineages[0].populationIndex;
}

test("predation selection varies continuously across the former trophic role boundary", () => {
  const below = populationAfterOneYear(0.549);
  const at = populationAfterOneYear(0.55);
  const above = populationAfterOneYear(0.551);

  assert.ok(below < at);
  assert.ok(at < above);
  assert.ok(Math.abs(at - below) < 1e-4);
  assert.ok(Math.abs(above - at) < 1e-4);

  const leftSlope = at - below;
  const rightSlope = above - at;
  assert.ok(Math.abs(leftSlope - rightSlope) < 1e-6);
});

test("feeding-spectrum endpoints still receive different pressure without categorical roles", () => {
  const plantWeighted = populationAfterOneYear(0);
  const animalWeighted = populationAfterOneYear(1);

  assert.ok(animalWeighted > plantWeighted);
});
