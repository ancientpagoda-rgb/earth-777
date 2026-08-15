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
