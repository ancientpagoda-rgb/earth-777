import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedFauna } from "../src/sim/FaunaRuntime.js";

const vegetation = Object.freeze({ biomeCode: 17, npp: 1300, lai: 3.2 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 480 });

function lineage(overrides = {}) {
  return {
    id: 1101,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.4,
    plantMatterAffinity: 0.6,
    livePreyAffinity: 0.4,
    carrionAffinity: 0.2,
    bodyMassLog10Kg: 1.2,
    mobility: 0.7,
    sociality: 0.8,
    cognition: 0.6,
    dietBreadth: 0.5,
    thermalOptimumK: -1,
    ...overrides
  };
}

test("legacy herd and pack labels do not choose group geometry for explicit lineages", () => {
  const animal = lineage();
  const state = {
    seed: 777001,
    elapsedYears: 10,
    temperatureAnomaly: -1,
    productivityIndex: 1,
    herbivoreBiomass: 4,
    carnivoreBiomass: 2,
    speciesLineages: [animal]
  };
  const plan = buildObservedFauna({
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    seed: 44,
    windowRadiusKm: 5,
    individualRadiusKm: 0.05
  });

  assert.ok(plan.herds.length > 0);
  assert.ok(plan.packs.length > 0);

  const predationAffinity = animal.livePreyAffinity;
  const massNorm = Math.max(0, Math.min(1, (animal.bodyMassLog10Kg + 0.5) / 4));
  const socialCoefficient = 0.78 - predationAffinity * 0.16;
  const socialScale = 0.72 + animal.sociality * socialCoefficient;
  const plantMassScale = 1.14 - massNorm * 0.28;
  const preyMassScale = 1.08 - massNorm * 0.22;
  const expectedGroupSizeScale = socialScale * (plantMassScale * (1 - predationAffinity) + preyMassScale * predationAffinity);
  const radiusBaseKm = 0.018 - predationAffinity * 0.006;
  const radiusPerSqrtAnimalKm = 0.0065 - predationAffinity * 0.002;
  const radiusMaxKm = 0.16 - predationAffinity * 0.08;

  for (const group of [...plan.herds, ...plan.packs]) {
    assert.equal(group.lineageId, animal.id);
    assert.ok(Math.abs(group.predationAffinity - predationAffinity) < 1e-12);
    assert.ok(Math.abs(group.groupSizeScale - expectedGroupSizeScale) < 1e-12);
    const unclampedRadius = radiusBaseKm + Math.sqrt(Math.max(1, group.population)) * radiusPerSqrtAnimalKm;
    const expectedRadius = Math.min(radiusMaxKm, Math.max(radiusBaseKm, unclampedRadius)) * group.spacingScale;
    assert.ok(Math.abs(group.radiusKm - expectedRadius) < 1e-12);
  }

  const herdScale = plan.herds[0].groupSizeScale;
  const packScale = plan.packs[0].groupSizeScale;
  assert.ok(Math.abs(herdScale - packScale) < 1e-12);
  assert.equal(plan.herds.reduce((sum, group) => sum + group.population, 0), plan.visiblePopulation);
  assert.equal(plan.packs.reduce((sum, group) => sum + group.population, 0), plan.visibleCarnivorePopulation);
});
