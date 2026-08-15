import test from "node:test";
import assert from "node:assert/strict";
import {
  approximateCellAreaKm2,
  buildObservedFauna,
  faunaForCells,
  faunaGroupBehaviorAt,
  faunaPopulationAt
} from "../src/sim/FaunaRuntime.js";

const state = Object.freeze({ seed: 777001, elapsedYears: 12.5, herbivoreBiomass: 1.1, carnivoreBiomass: 0.7, productivityIndex: 1.0 });
const vegetation = Object.freeze({ biomeCode: 17, npp: 950, lai: 2.8 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 430 });

function cell(scope, key, south, north, west, east) {
  return Object.freeze({ scope, key, latitude: (south + north) * 0.5, longitude: (west + east) * 0.5, bounds: Object.freeze({ south, north, west, east }) });
}

test("cell area shrinks toward the poles", () => {
  const equatorial = approximateCellAreaKm2(cell("local", "eq", -0.5, 0.5, 0, 1));
  const polar = approximateCellAreaKm2(cell("local", "polar", 79.5, 80.5, 0, 1));
  assert.ok(equatorial > polar * 4);
});

test("far fauna stays aggregate and scales with area", () => {
  const small = faunaPopulationAt({ state, vegetationSample: vegetation, hydrologySample: hydrology, areaKm2: 10 });
  const large = faunaPopulationAt({ state, vegetationSample: vegetation, hydrologySample: hydrology, areaKm2: 1000 });
  assert.ok(large.herbivorePopulation > small.herbivorePopulation * 90);
  assert.equal("individuals" in large, false);
  assert.equal("herds" in large, false);
});

test("regional and local cells use the same compact summary function", () => {
  const cells = [cell("regional", "r", 30, 40, -100, -90), cell("local", "l", 38, 39, -96, -95)];
  const summaries = faunaForCells(cells, { state, vegetationSample: vegetation, hydrologySample: hydrology });
  assert.equal(summaries.length, 2);
  assert.ok(summaries.every((summary) => Number.isFinite(summary.estimatedHerds)));
  assert.ok(summaries.every((summary) => Number.isFinite(summary.estimatedPacks)));
});

test("group behavior is deterministic and moves with simulated time", () => {
  const field = faunaPopulationAt({ state, vegetationSample: vegetation, hydrologySample: hydrology, areaKm2: 10 });
  const a = faunaGroupBehaviorAt({ role: "herbivore", id: "herd-a", elapsedYears: 4, field });
  const b = faunaGroupBehaviorAt({ role: "herbivore", id: "herd-a", elapsedYears: 4, field });
  const later = faunaGroupBehaviorAt({ role: "herbivore", id: "herd-a", elapsedYears: 4.5, field });
  assert.deepEqual(a, b);
  assert.notEqual(a.heading, later.heading);
  assert.ok(["graze", "drink", "travel", "flee", "rest"].includes(a.behavior));
});

test("observed fauna is deterministic for seed, place, and time", () => {
  const options = { state, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 777001, windowRadiusKm: 3, individualRadiusKm: 0.6 };
  const first = buildObservedFauna(options);
  const second = buildObservedFauna(options);
  assert.deepEqual(first.herds, second.herds);
  assert.deepEqual(first.packs, second.packs);
  assert.deepEqual(first.individuals, second.individuals);
});

test("observed groups inherit identity from living evolutionary lineages", () => {
  const lineageState = {
    ...state,
    speciesLineages: [
      { id: 101, extinctionYearBP: null, populationIndex: 1, trophicLevel: 0.2, bodyMassLog10Kg: 2.0 },
      { id: 202, extinctionYearBP: null, populationIndex: 0.7, trophicLevel: 0.8, bodyMassLog10Kg: 0.7 }
    ]
  };
  const plan = buildObservedFauna({ state: lineageState, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 777001, windowRadiusKm: 3, individualRadiusKm: 3 });

  assert.ok(plan.herds.length > 0);
  assert.ok(plan.packs.length > 0);
  assert.ok(plan.herds.every((group) => group.lineageId === 101));
  assert.ok(plan.packs.every((group) => group.lineageId === 202));
  assert.ok(plan.individuals.every((animal) => animal.lineageId === (animal.role === "carnivore" ? 202 : 101)));
  assert.deepEqual(new Set(plan.lineageIds), new Set([101, 202]));
});

test("group populations conserve the observed aggregate populations", () => {
  const plan = buildObservedFauna({ state, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 9, windowRadiusKm: 3, individualRadiusKm: 0.3 });
  assert.equal(plan.herds.reduce((sum, herd) => sum + herd.population, 0), plan.visiblePopulation);
  assert.equal(plan.packs.reduce((sum, pack) => sum + pack.population, 0), plan.visibleCarnivorePopulation);
});

test("individual detail is controlled by distance rather than a count cap", () => {
  const richState = { ...state, herbivoreBiomass: 4 };
  const richVegetation = { ...vegetation, npp: 1800 };
  const wide = buildObservedFauna({ state: richState, vegetationSample: richVegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 7, windowRadiusKm: 2.5, individualRadiusKm: 2.5 });
  const narrow = buildObservedFauna({ state: richState, vegetationSample: richVegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 7, windowRadiusKm: 2.5, individualRadiusKm: 0.2 });
  assert.equal(wide.materializedHerbivores, wide.visiblePopulation);
  assert.ok(wide.materializedHerbivores > 100);
  assert.ok(narrow.materializedHerbivores < narrow.visiblePopulation);
});
