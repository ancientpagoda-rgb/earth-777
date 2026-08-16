import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedFauna } from "../src/sim/FaunaRuntime.js";

const vegetation = Object.freeze({ biomeCode: 17, npp: 1500, lai: 3.5 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 520 });

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
    mobility: 0.7,
    sociality: 0.5,
    cognition: 0.6,
    dietBreadth: 0.3,
    thermalOptimumK: -1,
    ...overrides
  };
}

function planFor(seed) {
  const state = {
    seed: 777001,
    elapsedYears: 12.5,
    temperatureAnomaly: -1,
    productivityIndex: 1,
    herbivoreBiomass: 5,
    carnivoreBiomass: 0.5,
    speciesLineages: [
      lineage({ id: 1001, plantMatterAffinity: 0.98, livePreyAffinity: 0.02, mobility: 0.65, sociality: 0.45, cognition: 0.55 }),
      lineage({ id: 1002, plantMatterAffinity: 0.02, livePreyAffinity: 0.98, mobility: 1, sociality: 0.5, cognition: 1, dietBreadth: 0 })
    ]
  };
  return buildObservedFauna({
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    seed,
    windowRadiusKm: 6,
    individualRadiusKm: 0.05
  });
}

test("actual perceived predators feed continuous herd locomotion before flee is only a label", () => {
  let plan = null;
  let raised = null;
  for (let seed = 1; seed <= 128; seed += 1) {
    const candidate = planFor(seed);
    const herd = candidate.herds.find((item) => item.threatGroupId != null
      && item.responseLocomotionDrive != null
      && item.responseLocomotionDrive > item.locomotionDrive + 1e-12);
    if (herd) {
      plan = candidate;
      raised = herd;
      break;
    }
  }

  assert.ok(plan, "expected a deterministic encounter where direct threat raises locomotion drive");
  assert.ok(raised);
  const threat = plan.packs.find((pack) => pack.id === raised.threatGroupId);
  assert.ok(threat);

  const proximityDrive = Math.max(0, Math.min(1, 1 - raised.threatDistanceBeforeKm / raised.threatPerceptionRadiusKm));
  const pursuitDrive = Math.max(0, Math.min(1, threat.preyPursuitDrive ?? 0));
  const multipleThreatDrive = Math.max(0, Math.min(1, raised.threatenedByCount / 3));
  const expectedDirectDrive = Math.max(0, Math.min(1, proximityDrive * 0.65 + pursuitDrive * 0.25 + multipleThreatDrive * 0.10));
  const expectedResponseDrive = Math.max(raised.locomotionDrive, expectedDirectDrive);
  const mobilityScale = 0.70 + raised.mobility * 0.70;
  const expectedResponseDistance = (0.025 + expectedResponseDrive * 0.135) * mobilityScale;

  assert.ok(Math.abs(raised.directThreatDrive - expectedDirectDrive) < 1e-12);
  assert.ok(Math.abs(raised.responseLocomotionDrive - expectedResponseDrive) < 1e-12);
  assert.ok(Math.abs(raised.fleeDistanceKm - Math.max(raised.movementDistanceKm, expectedResponseDistance)) < 1e-12);
  assert.ok(raised.fleeDistanceKm > raised.movementDistanceKm);
  assert.equal(raised.behavior, "flee");
  assert.ok(raised.threatDistanceKm > raised.threatDistanceBeforeKm);

  assert.equal(plan.herds.reduce((sum, herd) => sum + herd.population, 0), plan.visiblePopulation);
  assert.equal(plan.packs.reduce((sum, pack) => sum + pack.population, 0), plan.visibleCarnivorePopulation);
});
