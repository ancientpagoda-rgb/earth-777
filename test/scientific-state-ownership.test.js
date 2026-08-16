import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceCarbonCycle,
  initializeBiogeochemistry
} from "../src/sim/EarthBiogeochemistry.js";
import {
  advanceOceanCirculation,
  initializeOceanCirculation
} from "../src/sim/SpatialOceanCirculation.js";
import { advanceEvolutionaryEcology } from "../src/sim/EvolutionaryEcology.js";
import { FreeEarthEngine } from "../src/sim/free-earth.js";

function carbonState() {
  const state = initializeBiogeochemistry({
    co2: 320,
    methane: 631,
    nitrousOxide: 270,
    temperatureAnomaly: 0.6,
    oceanTemperatureAnomaly: 0.8,
    iceIndex: 0.12,
    productivityIndex: 1.1,
    geologicActivityIndex: 1,
    oceanSurfaceCarbonPgC: 1_080,
    oceanDeepCarbonPgC: 36_920
  });
  initializeOceanCirculation(state);
  return state;
}

test("biogeochemistry does not write the deep-ocean carbon reservoir", () => {
  const state = carbonState();
  const deepBefore = state.oceanDeepCarbonPgC;
  advanceCarbonCycle(state, 25);
  assert.equal(state.oceanDeepCarbonPgC, deepBefore);
});

test("ocean circulation exclusively performs and reports surface-deep carbon exchange", () => {
  const state = carbonState();
  advanceCarbonCycle(state, 25);
  const oceanCarbonBefore = state.oceanSurfaceCarbonPgC + state.oceanDeepCarbonPgC;
  const deepBefore = state.oceanDeepCarbonPgC;

  advanceOceanCirculation(state, 25);

  const oceanCarbonAfter = state.oceanSurfaceCarbonPgC + state.oceanDeepCarbonPgC;
  assert.ok(Math.abs(oceanCarbonAfter - oceanCarbonBefore) < 1e-9);
  assert.notEqual(state.oceanDeepCarbonPgC, deepBefore);
  assert.equal(
    state.carbonFluxes.surfaceToDeepPgCPerYear,
    state.oceanCirculationCarbonFluxPgCPerYear
  );
});

test("evolutionary lineages read aggregate animal biomass without rewriting it", () => {
  const state = {
    seed: 777001,
    yearBP: 760_000,
    temperatureAnomaly: -0.8,
    greenhouseForcing: 0.2,
    iceIndex: 0.22,
    productivityIndex: 1.15,
    herbivoreBiomass: 1.37,
    carnivoreBiomass: 0.42
  };
  const herbivoreBefore = state.herbivoreBiomass;
  const carnivoreBefore = state.carnivoreBiomass;

  advanceEvolutionaryEcology(state, 250, () => 0.5);

  assert.equal(state.herbivoreBiomass, herbivoreBefore);
  assert.equal(state.carnivoreBiomass, carnivoreBefore);
  assert.ok(Array.isArray(state.speciesLineages));
  assert.ok(Number.isInteger(state.speciesRichness));
});

test("aggregate predation pressure selects lineage traits without becoming a second biomass writer", () => {
  const state = {
    seed: 777001,
    yearBP: 760_000,
    temperatureAnomaly: -0.8,
    greenhouseForcing: 0,
    iceIndex: 0.18,
    productivityIndex: 1.15,
    herbivoreBiomass: 1.37,
    carnivoreBiomass: 0.42,
    predationPressureIndex: 3,
    predationExposureIndex: 2,
    speciesLineages: [
      { id: 1, extinctionYearBP: null, populationIndex: 0.8, trophicLevel: 0.2, bodyMassLog10Kg: 1, thermalOptimumK: -0.8, mobility: 0.5, sociality: 0, cognition: 0, dietBreadth: 0.5, divergence: 0 },
      { id: 2, extinctionYearBP: null, populationIndex: 0.8, trophicLevel: 0.2, bodyMassLog10Kg: 1, thermalOptimumK: -0.8, mobility: 0.5, sociality: 1, cognition: 1, dietBreadth: 0.5, divergence: 0 }
    ]
  };
  const herbivoreBefore = state.herbivoreBiomass;
  const carnivoreBefore = state.carnivoreBiomass;
  const pressureBefore = state.predationPressureIndex;
  const exposureBefore = state.predationExposureIndex;

  advanceEvolutionaryEcology(state, 25, () => 1);

  assert.ok(state.speciesLineages[1].populationIndex > state.speciesLineages[0].populationIndex);
  assert.equal(state.herbivoreBiomass, herbivoreBefore);
  assert.equal(state.carnivoreBiomass, carnivoreBefore);
  assert.equal(state.predationPressureIndex, pressureBefore);
  assert.equal(state.predationExposureIndex, exposureBefore);
});

test("decaying aggregate predation exposure prolongs defensive lineage selection", () => {
  const configure = (predationExposureIndex) => ({
    seed: 777001,
    yearBP: 760_000,
    temperatureAnomaly: -0.8,
    greenhouseForcing: 0,
    iceIndex: 0.18,
    productivityIndex: 1.15,
    herbivoreBiomass: 1.37,
    carnivoreBiomass: 0.42,
    predationPressureIndex: 0.05,
    predationExposureIndex,
    speciesLineages: [
      { id: 1, extinctionYearBP: null, populationIndex: 0.8, trophicLevel: 0.2, bodyMassLog10Kg: 1, thermalOptimumK: -0.8, mobility: 0.5, sociality: 0, cognition: 0, dietBreadth: 0.5, divergence: 0 },
      { id: 2, extinctionYearBP: null, populationIndex: 0.8, trophicLevel: 0.2, bodyMassLog10Kg: 1, thermalOptimumK: -0.8, mobility: 0.5, sociality: 1, cognition: 1, dietBreadth: 0.5, divergence: 0 }
    ]
  });
  const currentOnly = configure(0.05);
  const lingeringExposure = configure(3);

  advanceEvolutionaryEcology(currentOnly, 25, () => 1);
  advanceEvolutionaryEcology(lingeringExposure, 25, () => 1);

  const currentAdvantage = currentOnly.speciesLineages[1].populationIndex - currentOnly.speciesLineages[0].populationIndex;
  const exposureAdvantage = lingeringExposure.speciesLineages[1].populationIndex - lingeringExposure.speciesLineages[0].populationIndex;
  assert.ok(exposureAdvantage > currentAdvantage);
  assert.equal(lingeringExposure.predationExposureIndex, 3);
});

test("Free Earth keeps advanced hominin spatial systems parked", () => {
  const state = new FreeEarthEngine(777001).advance(1_000);
  assert.ok(Array.isArray(state.homininLineages));
  assert.ok(Number.isFinite(state.homininPopulationIndex));
  for (const key of ["homininDemes", "homininSites", "homininWaterRoutes", "homininConflictEdges"]) {
    assert.equal(state[key], undefined);
  }
});
