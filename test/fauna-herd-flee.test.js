import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedFauna } from "../src/sim/FaunaRuntime.js";

const vegetation = Object.freeze({ biomeCode: 17, npp: 950, lai: 2.8 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 430 });

function lineage(overrides = {}) {
  return {
    id: 1,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.2,
    bodyMassLog10Kg: 1,
    mobility: 0.5,
    sociality: 0.5,
    cognition: 0.5,
    dietBreadth: 0.5,
    thermalOptimumK: -1,
    ...overrides
  };
}

test("targeted herds turn continuous threat demand into fleeing without changing population", () => {
  const state = {
    seed: 777001,
    elapsedYears: 12.5,
    temperatureAnomaly: -1,
    productivityIndex: 1,
    herbivoreBiomass: 4,
    carnivoreBiomass: 2,
    speciesLineages: [
      lineage({ id: 401, trophicLevel: 0.2, bodyMassLog10Kg: 1.4, sociality: 0.4 }),
      lineage({ id: 402, trophicLevel: 0.85, bodyMassLog10Kg: 0.9, mobility: 1, cognition: 1, dietBreadth: 0, sociality: 0.6 })
    ]
  };

  const plan = buildObservedFauna({
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    seed: 123,
    windowRadiusKm: 4,
    individualRadiusKm: 4
  });

  const herdById = new Map(plan.herds.map((herd) => [herd.id, herd]));
  const threatened = plan.herds.filter((herd) => herd.threatGroupId != null);
  const targeted = plan.packs.filter((pack) => pack.targetGroupId != null);

  assert.ok(threatened.length > 0);
  assert.ok(targeted.length > 0);

  for (const herd of threatened) {
    assert.ok(herd.fleeDistanceKm > 0);
    assert.ok(herd.fleeDistanceKm >= herd.movementDistanceKm - 1e-12);
    assert.ok(herd.responseLocomotionDrive >= herd.locomotionDrive - 1e-12);
    const expectedThreatResponseKm = (0.025 + herd.responseLocomotionDrive * 0.135) * (0.70 + herd.mobility * 0.70);
    assert.ok(Math.abs(herd.fleeDistanceKm - Math.max(herd.movementDistanceKm, expectedThreatResponseKm)) < 1e-12);
    assert.ok(herd.threatDistanceKm >= herd.threatDistanceBeforeKm - 1e-12);
    assert.ok(Math.abs((herd.threatDistanceKm - herd.threatDistanceBeforeKm) - herd.fleeDistanceKm) < 1e-10);
  }

  for (const pack of targeted) {
    const target = herdById.get(pack.targetGroupId);
    assert.ok(target);
    const finalDistance = Math.hypot(target.x - pack.x, target.z - pack.z);
    assert.ok(Math.abs(pack.targetDistanceAfterHerdResponseKm - finalDistance) < 1e-12);
    assert.ok(pack.targetDistanceAfterHerdResponseKm >= pack.targetDistanceKm - 1e-12);
  }

  const threatenedIndividuals = plan.individuals.filter((animal) => animal.role === "herbivore" && animal.threatGroupId != null);
  assert.ok(threatenedIndividuals.length > 0);
  for (const animal of threatenedIndividuals) {
    const herd = herdById.get(animal.groupId);
    assert.ok(herd);
    assert.ok(Math.hypot(animal.x - herd.x, animal.z - herd.z) <= herd.radiusKm + 0.005);
  }

  assert.equal(plan.herds.reduce((sum, herd) => sum + herd.population, 0), plan.visiblePopulation);
  assert.equal(plan.packs.reduce((sum, pack) => sum + pack.population, 0), plan.visibleCarnivorePopulation);
});
