import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedFauna } from "../src/sim/FaunaRuntime.js";

const vegetation = Object.freeze({ biomeCode: 17, npp: 1200, lai: 3.1 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 470 });

function lineage(overrides = {}) {
  return {
    id: 1,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.5,
    plantMatterAffinity: 0.5,
    livePreyAffinity: 0.5,
    carrionAffinity: 0.2,
    bodyMassLog10Kg: 1,
    mobility: 0.5,
    sociality: 0.5,
    cognition: 0.5,
    dietBreadth: 0.5,
    thermalOptimumK: -1,
    ...overrides
  };
}

function planFor(state, seed = 777001, radius = 5) {
  return buildObservedFauna({
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    seed,
    windowRadiusKm: radius,
    individualRadiusKm: 0.05
  });
}

test("one explicit omnivorous lineage can participate in both legacy observation channels", () => {
  const state = {
    seed: 777001,
    elapsedYears: 12.5,
    temperatureAnomaly: -1,
    productivityIndex: 1,
    herbivoreBiomass: 4,
    carnivoreBiomass: 2,
    speciesLineages: [lineage({ id: 801, plantMatterAffinity: 0.6, livePreyAffinity: 0.4, trophicLevel: 0.9 })]
  };
  const plan = planFor(state);

  assert.ok(plan.herds.length > 0);
  assert.ok(plan.packs.length > 0);
  assert.ok(plan.herds.every((group) => group.lineageId === 801 && Math.abs(group.channelAffinity - 0.6) < 1e-12));
  assert.ok(plan.packs.every((group) => group.lineageId === 801 && Math.abs(group.channelAffinity - 0.4) < 1e-12));
  assert.ok(plan.herds.every((group) => Math.abs(group.trophicLevel - 0.4) < 1e-12));
  assert.ok(plan.packs.every((group) => Math.abs(group.trophicLevel - 0.4) < 1e-12));
  assert.equal(plan.herds.reduce((sum, group) => sum + group.population, 0), plan.visiblePopulation);
  assert.equal(plan.packs.reduce((sum, group) => sum + group.population, 0), plan.visibleCarnivorePopulation);
});

test("explicit feeding affinities outweigh stale predator/herbivore labels in local representation", () => {
  const state = {
    seed: 777001,
    elapsedYears: 12.5,
    temperatureAnomaly: -1,
    productivityIndex: 1,
    herbivoreBiomass: 5,
    carnivoreBiomass: 3,
    speciesLineages: [
      lineage({ id: 811, trophicLevel: 0.9, plantMatterAffinity: 0.95, livePreyAffinity: 0.05 }),
      lineage({ id: 812, trophicLevel: 0.1, plantMatterAffinity: 0.05, livePreyAffinity: 0.95 })
    ]
  };
  const plan = planFor(state, 91, 8);
  const herdPopulation = new Map();
  const packPopulation = new Map();
  for (const group of plan.herds) herdPopulation.set(group.lineageId, (herdPopulation.get(group.lineageId) ?? 0) + group.population);
  for (const group of plan.packs) packPopulation.set(group.lineageId, (packPopulation.get(group.lineageId) ?? 0) + group.population);

  assert.ok((herdPopulation.get(811) ?? 0) > (herdPopulation.get(812) ?? 0));
  assert.ok((packPopulation.get(812) ?? 0) > (packPopulation.get(811) ?? 0));
  assert.equal([...herdPopulation.values()].reduce((sum, value) => sum + value, 0), plan.visiblePopulation);
  assert.equal([...packPopulation.values()].reduce((sum, value) => sum + value, 0), plan.visibleCarnivorePopulation);
});
