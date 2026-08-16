import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedFauna, faunaGroupBehaviorAt } from "../src/sim/FaunaRuntime.js";

function lineage(overrides = {}) {
  return {
    id: 1201,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.45,
    plantMatterAffinity: 0.55,
    livePreyAffinity: 0.45,
    carrionAffinity: 0.25,
    bodyMassLog10Kg: 1.1,
    mobility: 0.7,
    sociality: 0.55,
    cognition: 0.65,
    dietBreadth: 0.4,
    thermalOptimumK: -1,
    ...overrides
  };
}

test("explicit lineage physics does not depend on legacy herbivore/carnivore role", () => {
  const animal = lineage();
  const common = {
    id: "same-animal-group",
    elapsedYears: 12.5,
    field: {
      preyPressure: 0.62,
      predatorPressure: 0.35,
      predationExposure: 0.48,
      productivity: 0.58,
      waterAccess: 0.44
    },
    lineage: animal
  };
  const plantChannel = faunaGroupBehaviorAt({ ...common, role: "herbivore" });
  const preyChannel = faunaGroupBehaviorAt({ ...common, role: "carnivore" });

  const { role: plantRole, ...plantPhysics } = plantChannel;
  const { role: preyRole, ...preyPhysics } = preyChannel;
  assert.equal(plantRole, "herbivore");
  assert.equal(preyRole, "carnivore");
  assert.deepEqual(preyPhysics, plantPhysics);
  assert.ok(Math.abs(plantPhysics.plantFeedingShare - 0.55) < 1e-12);
  assert.ok(Math.abs(plantPhysics.livePreyFeedingShare - 0.45) < 1e-12);
});

const vegetation = Object.freeze({ biomeCode: 17, npp: 1200, lai: 3.1 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 470 });

test("same explicit omnivore has the same local suitability in both compatibility channels", () => {
  const animal = lineage({ plantMatterAffinity: 0.6, livePreyAffinity: 0.4 });
  const state = {
    seed: 777001,
    elapsedYears: 9,
    temperatureAnomaly: -1,
    productivityIndex: 1,
    herbivoreBiomass: 4,
    carnivoreBiomass: 2,
    predationExposureIndex: 0.3,
    speciesLineages: [animal]
  };
  const plan = buildObservedFauna({
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    seed: 73,
    windowRadiusKm: 5,
    individualRadiusKm: 0.05
  });

  assert.ok(plan.herds.length > 0);
  assert.ok(plan.packs.length > 0);
  const expected = plan.herds[0].localSuitability;
  assert.ok(plan.herds.every((group) => Math.abs(group.localSuitability - expected) < 1e-12));
  assert.ok(plan.packs.every((group) => Math.abs(group.localSuitability - expected) < 1e-12));
  assert.ok(plan.herds.every((group) => group.threatPerceptionRadiusKm != null));
  assert.ok(plan.packs.every((group) => group.threatPerceptionRadiusKm != null));
  assert.equal(plan.herds.reduce((sum, group) => sum + group.population, 0), plan.visiblePopulation);
  assert.equal(plan.packs.reduce((sum, group) => sum + group.population, 0), plan.visibleCarnivorePopulation);
});
