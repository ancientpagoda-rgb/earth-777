import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedFauna } from "../src/sim/FaunaRuntime.js";

const vegetation = Object.freeze({ biomeCode: 17, npp: 1500, lai: 3.6 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 520 });

function lineage(overrides = {}) {
  return {
    id: 1,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.2,
    bodyMassLog10Kg: 1,
    mobility: 0.7,
    sociality: 1,
    cognition: 1,
    dietBreadth: 0.5,
    thermalOptimumK: -1,
    ...overrides
  };
}

function stateForTraits(sociality, cognition) {
  return {
    seed: 777001,
    elapsedYears: 12.5,
    temperatureAnomaly: -1,
    productivityIndex: 1,
    herbivoreBiomass: 5,
    carnivoreBiomass: 2,
    speciesLineages: [
      lineage({ id: 501, trophicLevel: 0.2, sociality, cognition }),
      lineage({ id: 502, trophicLevel: 0.85, bodyMassLog10Kg: 0.9, mobility: 1, sociality: 0.6, cognition: 1, dietBreadth: 0 })
    ]
  };
}

function planForSeed(state, seed) {
  return buildObservedFauna({
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    seed,
    windowRadiusKm: 2.5,
    individualRadiusKm: 2.5
  });
}

test("nearby social herds inherit alarms from directly threatened same-lineage herds", () => {
  const socialState = stateForTraits(1, 1);
  let seed = null;
  let socialPlan = null;
  for (let candidate = 1; candidate <= 64; candidate += 1) {
    const plan = planForSeed(socialState, candidate);
    if (plan.alarmedHerdCount > 0) {
      seed = candidate;
      socialPlan = plan;
      break;
    }
  }

  assert.ok(seed != null, "expected at least one deterministic seed with a nearby alarm recipient");
  assert.ok(socialPlan.alarmedHerdCount > 0);

  const herdById = new Map(socialPlan.herds.map((herd) => [herd.id, herd]));
  const packById = new Map(socialPlan.packs.map((pack) => [pack.id, pack]));
  const alarmed = socialPlan.herds.filter((herd) => herd.alarmThreatGroupId != null);

  for (const herd of alarmed) {
    const source = herdById.get(herd.alarmSourceGroupId);
    const threat = packById.get(herd.alarmThreatGroupId);
    assert.ok(source?.threatGroupId);
    assert.ok(threat);
    assert.equal(source.lineageId, herd.lineageId);
    assert.equal(source.threatGroupId, threat.id);
    assert.equal(threat.targetGroupId, source.id);
    assert.equal(herd.behavior, "flee");
    assert.equal(herd.threatGroupId, undefined);
    assert.ok(herd.alarmDistanceKm <= herd.alarmRadiusKm + 1e-12);
    assert.ok(herd.alarmResponseStrength > 0.35);
  }

  const alarmedIndividuals = socialPlan.individuals.filter((animal) => animal.role === "herbivore" && animal.alarmThreatGroupId != null);
  assert.ok(alarmedIndividuals.length > 0);
  for (const animal of alarmedIndividuals) {
    const herd = herdById.get(animal.groupId);
    assert.equal(animal.behavior, "flee");
    assert.equal(animal.alarmSourceGroupId, herd.alarmSourceGroupId);
    assert.equal(animal.alarmThreatGroupId, herd.alarmThreatGroupId);
    assert.ok(Math.abs(animal.yaw - herd.heading) < 1e-12);
  }

  const quietPlan = planForSeed(stateForTraits(0, 0), seed);
  assert.equal(quietPlan.alarmedHerdCount, 0);

  assert.equal(socialPlan.herds.reduce((sum, herd) => sum + herd.population, 0), socialPlan.visiblePopulation);
  assert.equal(socialPlan.packs.reduce((sum, pack) => sum + pack.population, 0), socialPlan.visibleCarnivorePopulation);
  assert.equal(quietPlan.visiblePopulation, socialPlan.visiblePopulation);
  assert.equal(quietPlan.visibleCarnivorePopulation, socialPlan.visibleCarnivorePopulation);
});
