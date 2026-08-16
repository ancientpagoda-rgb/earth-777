import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedFauna, faunaGroupBehaviorAt } from "../src/sim/FaunaRuntime.js";

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
    mobility: 1,
    sociality: 0.5,
    cognition: 1,
    dietBreadth: 0,
    thermalOptimumK: -1,
    ...overrides
  };
}

test("live-prey affinity scales continuous pursuit while carrion does not", () => {
  const common = {
    role: "carnivore",
    id: "same-pack",
    elapsedYears: 12.5,
    field: { preyPressure: 1 }
  };
  const low = faunaGroupBehaviorAt({ ...common, lineage: lineage({ livePreyAffinity: 0.05, plantMatterAffinity: 0.95, carrionAffinity: 0 }) });
  const scavenging = faunaGroupBehaviorAt({ ...common, lineage: lineage({ livePreyAffinity: 0.05, plantMatterAffinity: 0.95, carrionAffinity: 1 }) });
  const high = faunaGroupBehaviorAt({ ...common, lineage: lineage({ livePreyAffinity: 0.95, plantMatterAffinity: 0.05, carrionAffinity: 0 }) });

  assert.ok(low.preyPursuitDrive < 0.38);
  assert.ok(high.preyPursuitDrive > low.preyPursuitDrive * 10);
  assert.equal(scavenging.preyPursuitDrive, low.preyPursuitDrive);
});

const vegetation = Object.freeze({ biomeCode: 17, npp: 1500, lai: 3.5 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 520 });

function planFor(hunterLivePreyAffinity, seed) {
  const state = {
    seed: 777001,
    elapsedYears: 12.5,
    temperatureAnomaly: -1,
    productivityIndex: 1,
    herbivoreBiomass: 5,
    carnivoreBiomass: 3,
    speciesLineages: [
      lineage({ id: 901, plantMatterAffinity: 0.95, livePreyAffinity: 0.05, mobility: 0.7, cognition: 0.6, dietBreadth: 0.5 }),
      lineage({ id: 902, plantMatterAffinity: 1 - hunterLivePreyAffinity, livePreyAffinity: hunterLivePreyAffinity, mobility: 1, cognition: 1, dietBreadth: 0 })
    ]
  };
  return buildObservedFauna({
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    seed,
    windowRadiusKm: 3.5,
    individualRadiusKm: 0.05
  });
}

test("target acquisition follows pursuit drive rather than hunt/stalk labels", () => {
  let seed = null;
  let high = null;
  for (let candidate = 1; candidate <= 64; candidate += 1) {
    const plan = planFor(0.95, candidate);
    if (plan.predatorTargetCount > 0) {
      seed = candidate;
      high = plan;
      break;
    }
  }
  assert.ok(seed != null, "expected a deterministic layout with a high-pursuit target");

  const low = planFor(0.05, seed);
  assert.equal(low.predatorTargetCount, 0);
  assert.ok(high.predatorTargetCount > 0);
  assert.ok(high.packs.filter((pack) => pack.targetGroupId != null).every((pack) => pack.preyPursuitDrive > 0.38));
  assert.equal(high.packs.reduce((sum, pack) => sum + pack.population, 0), high.visibleCarnivorePopulation);
  assert.equal(low.packs.reduce((sum, pack) => sum + pack.population, 0), low.visibleCarnivorePopulation);
});
