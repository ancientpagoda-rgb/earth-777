import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedFauna, deriveEncounterEcologyProposal } from "../src/sim/FaunaRuntime.js";

const vegetation = Object.freeze({ biomeCode: 17, npp: 1400, lai: 3.2 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 500 });

function lineage(overrides = {}) {
  return {
    id: 1,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.2,
    bodyMassLog10Kg: 1,
    mobility: 0.6,
    sociality: 0.5,
    cognition: 0.5,
    dietBreadth: 0.5,
    thermalOptimumK: -1,
    ...overrides
  };
}

test("predator encounter outcomes are geometric diagnostics and conserve population", () => {
  const state = {
    seed: 777001,
    elapsedYears: 12.5,
    temperatureAnomaly: -1,
    productivityIndex: 1,
    herbivoreBiomass: 4,
    carnivoreBiomass: 2,
    speciesLineages: [
      lineage({ id: 701, trophicLevel: 0.2, bodyMassLog10Kg: 1.3, sociality: 0.5 }),
      lineage({ id: 702, trophicLevel: 0.85, bodyMassLog10Kg: 0.9, mobility: 1, cognition: 1, dietBreadth: 0, sociality: 0.6 })
    ]
  };

  let plan = null;
  for (let seed = 1; seed <= 64; seed += 1) {
    const candidate = buildObservedFauna({
      state,
      vegetationSample: vegetation,
      hydrologySample: hydrology,
      latitude: 39,
      longitude: -95,
      seed,
      windowRadiusKm: 3.5,
      individualRadiusKm: 3.5
    });
    if (candidate.predatorTargetCount > 0) {
      plan = candidate;
      break;
    }
  }

  assert.ok(plan, "expected a deterministic layout with at least one targeted herd");
  const herdById = new Map(plan.herds.map((herd) => [herd.id, herd]));
  const targeted = plan.packs.filter((pack) => pack.targetGroupId != null);

  assert.ok(targeted.length > 0);
  assert.equal(plan.predatorTargetCount, targeted.length);
  assert.equal(plan.predatorContactCount, targeted.filter((pack) => pack.encounterContact).length);
  assert.equal(plan.predatorGainCount, targeted.filter((pack) => pack.netClosingDistanceKm > 0).length);

  for (const pack of targeted) {
    const target = herdById.get(pack.targetGroupId);
    assert.ok(target);
    const finalDistance = Math.hypot(target.x - pack.x, target.z - pack.z);
    const clearance = target.radiusKm + pack.radiusKm;
    const expectedClosing = pack.targetDistanceBeforeKm - finalDistance;
    const expectedMargin = clearance - finalDistance;

    assert.ok(Math.abs(pack.targetDistanceAfterHerdResponseKm - finalDistance) < 1e-12);
    assert.ok(Math.abs(pack.encounterClearanceKm - clearance) < 1e-12);
    assert.ok(Math.abs(pack.netClosingDistanceKm - expectedClosing) < 1e-12);
    assert.ok(Math.abs(pack.encounterContactMarginKm - expectedMargin) < 1e-12);
    assert.equal(pack.encounterContact, finalDistance <= clearance + 1e-12);
  }

  assert.equal(plan.herds.reduce((sum, herd) => sum + herd.population, 0), plan.visiblePopulation);
  assert.equal(plan.packs.reduce((sum, pack) => sum + pack.population, 0), plan.visibleCarnivorePopulation);
});

test("geometric contacts produce bounded non-authoritative ecology proposals", () => {
  // Contact is a final-geometry boundary.  It must not depend on finding a
  // lucky generated layout, especially now that direct threat can raise a
  // herd's continuous locomotion demand enough to escape a pack.
  const herds = [{ id: "herd-1", lineageId: 701, population: 12 }];
  const packs = [{
    id: "pack-1",
    targetGroupId: "herd-1",
    population: 3,
    mobility: 0.9,
    cognition: 0.8,
    encounterContact: true,
    encounterClearanceKm: 0.12,
    encounterContactMarginKm: 0.06
  }];
  const proposal = deriveEncounterEcologyProposal({
    packs,
    herds,
    visiblePopulation: 12,
    visibleCarnivorePopulation: 3
  });
  assert.equal(proposal.authoritative, false);
  assert.equal(proposal.contactCount, 1);
  assert.equal(proposal.contactedHerdCount, 1);
  assert.ok(proposal.observedHerbivoreExposureIndex > 0);
  assert.ok(proposal.observedHerbivoreExposureIndex <= 1);
  assert.ok(proposal.observedCarnivoreEngagementIndex > 0);
  assert.ok(proposal.observedCarnivoreEngagementIndex <= 1);
  assert.ok(proposal.contactedHerds.every((herd) => herd.pressureIndex > 0 && herd.pressureIndex <= 1));
  const noContact = deriveEncounterEcologyProposal({
    packs: packs.map((pack) => ({ ...pack, encounterContact: false })),
    herds,
    visiblePopulation: 12,
    visibleCarnivorePopulation: 3
  });
  assert.equal(noContact.contactCount, 0);
  assert.equal(noContact.observedHerbivoreExposureIndex, 0);
  assert.equal(noContact.observedCarnivoreEngagementIndex, 0);
});
