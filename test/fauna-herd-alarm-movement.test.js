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
      lineage({ id: 601, trophicLevel: 0.2, sociality, cognition }),
      lineage({ id: 602, trophicLevel: 0.85, bodyMassLog10Kg: 0.9, mobility: 1, sociality: 0.6, cognition: 1, dietBreadth: 0 })
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

test("alarmed herds spend a bounded share of existing movement increasing threat separation", () => {
  const socialState = stateForTraits(1, 1);
  let seed = null;
  let plan = null;
  for (let candidate = 1; candidate <= 64; candidate += 1) {
    const candidatePlan = planForSeed(socialState, candidate);
    if (candidatePlan.alarmedHerdCount > 0) {
      seed = candidate;
      plan = candidatePlan;
      break;
    }
  }

  assert.ok(seed != null, "expected a deterministic seed with at least one alarmed herd");
  const herdById = new Map(plan.herds.map((herd) => [herd.id, herd]));
  const packById = new Map(plan.packs.map((pack) => [pack.id, pack]));
  const alarmed = plan.herds.filter((herd) => herd.alarmThreatGroupId != null);

  assert.ok(alarmed.length > 0);
  assert.equal(plan.alarmedHerdCount, alarmed.length);
  assert.equal(plan.movedAlarmedHerdCount, alarmed.length);

  for (const herd of alarmed) {
    const threat = packById.get(herd.alarmThreatGroupId);
    assert.ok(threat);
    assert.ok(herd.alarmMoveDistanceKm > 0);
    assert.ok(herd.alarmMoveDistanceKm <= herd.movementDistanceKm + 1e-12);
    const expectedMove = herd.movementDistanceKm * (0.35 + herd.alarmResponseStrength * 0.65);
    assert.ok(Math.abs(herd.alarmMoveDistanceKm - expectedMove) < 1e-12);
    assert.ok(herd.alarmThreatDistanceKm >= herd.alarmThreatDistanceBeforeKm - 1e-12);
    assert.ok(Math.abs((herd.alarmThreatDistanceKm - herd.alarmThreatDistanceBeforeKm) - herd.alarmMoveDistanceKm) < 1e-10);
    assert.ok(Math.abs(Math.hypot(herd.x - threat.x, herd.z - threat.z) - herd.alarmThreatDistanceKm) < 1e-12);
  }

  const alarmedIndividuals = plan.individuals.filter((animal) => animal.role === "herbivore" && animal.alarmThreatGroupId != null);
  assert.ok(alarmedIndividuals.length > 0);
  for (const animal of alarmedIndividuals) {
    const herd = herdById.get(animal.groupId);
    assert.ok(herd?.alarmThreatGroupId);
    assert.ok(Math.hypot(animal.x - herd.x, animal.z - herd.z) <= herd.radiusKm + 0.005);
    assert.ok(Math.abs(animal.yaw - herd.heading) < 1e-12);
  }

  const quietPlan = planForSeed(stateForTraits(0, 0), seed);
  assert.equal(quietPlan.alarmedHerdCount, 0);
  assert.equal(quietPlan.movedAlarmedHerdCount, 0);

  assert.equal(plan.herds.reduce((sum, herd) => sum + herd.population, 0), plan.visiblePopulation);
  assert.equal(plan.packs.reduce((sum, pack) => sum + pack.population, 0), plan.visibleCarnivorePopulation);
  assert.equal(quietPlan.visiblePopulation, plan.visiblePopulation);
  assert.equal(quietPlan.visibleCarnivorePopulation, plan.visibleCarnivorePopulation);
});
