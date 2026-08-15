import test from "node:test";
import assert from "node:assert/strict";
import {
  approximateCellAreaKm2,
  buildObservedFaunaPlan,
  faunaFieldsForCells,
  faunaLocalSummariesForCells,
  faunaPopulationFieldAt
} from "../src/sim/FaunaPopulationHierarchy.js";

const state = Object.freeze({ herbivoreBiomass: 1.1, carnivoreBiomass: 0.7, productivityIndex: 1.0, elapsedYears: 0, seed: 777001 });
const vegetation = Object.freeze({ biomeCode: 17, npp: 950, lai: 2.8 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 430 });

function cell(scope, key, south, north, west, east) {
  return Object.freeze({
    scope,
    key,
    latitude: (south + north) * 0.5,
    longitude: (west + east) * 0.5,
    bounds: Object.freeze({ south, north, west, east })
  });
}

test("fauna population fields scale aggregate population with cell area without materializing animals", () => {
  const small = faunaPopulationFieldAt({ state, vegetationSample: vegetation, hydrologySample: hydrology, areaKm2: 10 });
  const large = faunaPopulationFieldAt({ state, vegetationSample: vegetation, hydrologySample: hydrology, areaKm2: 1000 });
  assert.ok(large.herbivorePopulation > small.herbivorePopulation * 90);
  assert.equal("individuals" in large, false);
  assert.equal("herds" in large, false);
});

test("cell area decreases toward the poles", () => {
  const equatorial = approximateCellAreaKm2(cell("local", "eq", -0.5, 0.5, 0, 1));
  const polar = approximateCellAreaKm2(cell("local", "polar", 79.5, 80.5, 0, 1));
  assert.ok(equatorial > polar * 4);
});

test("regional and local hierarchy keeps one bounded summary object per active cell", () => {
  const cells = [
    cell("regional", "a", 30, 40, -100, -90),
    cell("regional", "b", 30, 40, -90, -80),
    cell("regional", "c", 40, 50, -100, -90)
  ];
  const context = { state, vegetationSample: vegetation, hydrologySample: hydrology };
  const fields = faunaFieldsForCells(cells, context);
  const summaries = faunaLocalSummariesForCells(cells, context);
  assert.equal(fields.length, cells.length);
  assert.equal(summaries.length, cells.length);
  assert.ok(fields.reduce((sum, field) => sum + field.herbivorePopulation, 0) > 1000);
  assert.ok(summaries.every((summary) => Number.isFinite(summary.estimatedHerds)));
  assert.ok(summaries.every((summary) => Number.isFinite(summary.migrationBearingRadians)));
});

test("observed fauna materialization is deterministic", () => {
  const options = {
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    seed: 777001,
    focusXKm: 0,
    focusZKm: 0,
    windowRadiusKm: 3,
    individualRadiusKm: 0.6
  };
  const first = buildObservedFaunaPlan(options);
  const second = buildObservedFaunaPlan(options);
  assert.deepEqual(first.herds, second.herds);
  assert.deepEqual(first.packs, second.packs);
  assert.deepEqual(first.individuals, second.individuals);
  assert.equal(first.visiblePopulation, first.aggregateOnlyPopulation + first.materializedPopulation);
  assert.equal(first.visibleCarnivorePopulation, first.aggregateOnlyCarnivorePopulation + first.materializedCarnivores);
});

test("individuals are gated by observed distance, not by an entity-count cap", () => {
  const options = {
    state: { ...state, herbivoreBiomass: 4 },
    vegetationSample: { ...vegetation, npp: 1800 },
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    seed: 7,
    windowRadiusKm: 2.5
  };
  const near = buildObservedFaunaPlan({ ...options, individualRadiusKm: 2.5 });
  const narrow = buildObservedFaunaPlan({ ...options, individualRadiusKm: 0.2 });
  assert.equal(near.materializedPopulation, near.visiblePopulation);
  assert.ok(narrow.materializedPopulation < narrow.visiblePopulation);
  assert.ok(near.materializedPopulation > 100);
});
