import test from "node:test";
import assert from "node:assert/strict";
import { regionalState } from "../src/sim/regional-state.js";

function lineage(overrides = {}) {
  return {
    id: 1,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.5,
    plantMatterAffinity: 0.5,
    livePreyAffinity: 0.5,
    carrionAffinity: 0.2,
    ...overrides
  };
}

test("regional fauna carries the global unified lineage projection without creating a local writer", () => {
  const globalState = {
    elapsedYears: 100,
    temperatureAnomaly: -1.1,
    iceIndex: 0.2,
    precession: 20,
    eccentricity: 0.02,
    herbivoreBiomass: 1.2,
    carnivoreBiomass: 0.18,
    productivityIndex: 0.9,
    predationExposureIndex: 0.1,
    speciesLineages: [
      lineage({ id: 1, populationIndex: 2, plantMatterAffinity: 1, livePreyAffinity: 0, carrionAffinity: 0.1 }),
      lineage({ id: 2, populationIndex: 3, plantMatterAffinity: 0.4, livePreyAffinity: 0.6, carrionAffinity: 0.7 })
    ]
  };
  const before = structuredClone(globalState);
  const region = regionalState(globalState, 39, -95);
  const projection = region.fauna.lineagePopulationProjection;

  assert.equal(projection.authoritativeWriter, "EvolutionaryEcology.speciesLineages[].populationIndex");
  assert.equal(projection.totalPopulationIndex, 5);
  assert.ok(Math.abs(projection.plantFeedingPopulationIndex - 3.2) < 1e-12);
  assert.ok(Math.abs(projection.livePreyFeedingPopulationIndex - 1.8) < 1e-12);
  assert.ok(Math.abs(
    projection.plantFeedingPopulationIndex + projection.livePreyFeedingPopulationIndex - projection.totalPopulationIndex
  ) < 1e-12);
  assert.equal(projection.livingLineageCount, 2);
  assert.deepEqual(globalState, before);
});
