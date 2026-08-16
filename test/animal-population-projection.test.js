import test from "node:test";
import assert from "node:assert/strict";
import { projectAnimalPopulation } from "../src/sim/AnimalPopulationProjection.js";

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

test("plant and live-prey projections exactly partition the living lineage population", () => {
  const state = {
    speciesLineages: [
      lineage({ id: 1, populationIndex: 2, plantMatterAffinity: 1, livePreyAffinity: 0, carrionAffinity: 0.1 }),
      lineage({ id: 2, populationIndex: 3, plantMatterAffinity: 0.25, livePreyAffinity: 0.75, carrionAffinity: 0.9 }),
      lineage({ id: 3, populationIndex: 4, plantMatterAffinity: 0, livePreyAffinity: 1, carrionAffinity: 0.4 }),
      lineage({ id: 4, populationIndex: 100, extinctionYearBP: 700000, plantMatterAffinity: 1, livePreyAffinity: 0 })
    ]
  };

  const projection = projectAnimalPopulation(state);
  assert.equal(projection.totalPopulationIndex, 9);
  assert.equal(projection.plantFeedingPopulationIndex, 2.75);
  assert.equal(projection.livePreyFeedingPopulationIndex, 6.25);
  assert.ok(Math.abs(
    projection.plantFeedingPopulationIndex + projection.livePreyFeedingPopulationIndex - projection.totalPopulationIndex
  ) < 1e-12);
  assert.ok(Math.abs(projection.plantFeedingFraction + projection.livePreyFeedingFraction - 1) < 1e-12);
  assert.equal(projection.livingLineageCount, 3);
});

test("carrion is an overlapping foraging propensity rather than a third population bucket", () => {
  const state = {
    speciesLineages: [
      lineage({ id: 11, populationIndex: 2, plantMatterAffinity: 0.7, livePreyAffinity: 0.3, carrionAffinity: 1 }),
      lineage({ id: 12, populationIndex: 2, plantMatterAffinity: 0.2, livePreyAffinity: 0.8, carrionAffinity: 0 })
    ]
  };

  const projection = projectAnimalPopulation(state);
  assert.equal(projection.totalPopulationIndex, 4);
  assert.equal(projection.carrionForagingPopulationIndex, 2);
  assert.equal(projection.carrionForagingFraction, 0.5);
  assert.ok(Math.abs(
    projection.plantFeedingPopulationIndex + projection.livePreyFeedingPopulationIndex - projection.totalPopulationIndex
  ) < 1e-12);
  assert.notEqual(
    projection.plantFeedingPopulationIndex + projection.livePreyFeedingPopulationIndex + projection.carrionForagingPopulationIndex,
    projection.totalPopulationIndex
  );
});

test("zero primary affinities still partition through the compatibility trophic summary", () => {
  const projection = projectAnimalPopulation({
    speciesLineages: [lineage({ populationIndex: 2, plantMatterAffinity: 0, livePreyAffinity: 0, trophicLevel: 0.8 })]
  });

  assert.ok(Math.abs(projection.plantFeedingPopulationIndex - 0.4) < 1e-12);
  assert.ok(Math.abs(projection.livePreyFeedingPopulationIndex - 1.6) < 1e-12);
  assert.ok(Math.abs(projection.plantFeedingPopulationIndex + projection.livePreyFeedingPopulationIndex - 2) < 1e-12);
});
