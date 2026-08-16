import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceEvolutionaryEcology,
  feedingProfileForLineage,
  initializeEvolutionaryEcology
} from "../src/sim/EvolutionaryEcology.js";

function lineage(overrides = {}) {
  return {
    id: 1,
    parentId: null,
    birthYearBP: 777000,
    extinctionYearBP: null,
    populationIndex: 0.5,
    trophicLevel: 0.7,
    bodyMassLog10Kg: 1,
    thermalOptimumK: -1,
    mobility: 0.6,
    sociality: 0.5,
    cognition: 0.4,
    dietBreadth: 0.4,
    divergence: 0,
    ...overrides
  };
}

function stateFor(lineageValue, overrides = {}) {
  return {
    seed: 777001,
    yearBP: 776999,
    temperatureAnomaly: -1,
    greenhouseForcing: 0,
    iceIndex: 0.18,
    productivityIndex: 1,
    herbivoreBiomass: 1,
    carnivoreBiomass: 1,
    predationPressureIndex: 0,
    predationExposureIndex: 0,
    speciesLineages: [lineageValue],
    ...overrides
  };
}

test("legacy trophic checkpoints backfill equivalent continuous feeding affinities", () => {
  const state = stateFor(lineage());
  initializeEvolutionaryEcology(state, state.seed);
  const stored = state.speciesLineages[0];

  assert.ok(Math.abs(stored.plantMatterAffinity - 0.3) < 1e-12);
  assert.ok(Math.abs(stored.livePreyAffinity - 0.7) < 1e-12);
  assert.ok(Math.abs(stored.carrionAffinity - 0.28) < 1e-12);
  assert.ok(Math.abs(stored.trophicLevel - 0.7) < 1e-12);
});

test("trophic level becomes a derived compatibility summary of explicit feeding affinities", () => {
  const state = stateFor(lineage({
    trophicLevel: 0.9,
    plantMatterAffinity: 0.8,
    livePreyAffinity: 0.2,
    carrionAffinity: 0.6
  }));
  initializeEvolutionaryEcology(state, state.seed);
  const stored = state.speciesLineages[0];
  const profile = feedingProfileForLineage(stored);

  assert.equal(profile.plantMatterAffinity, 0.8);
  assert.equal(profile.livePreyAffinity, 0.2);
  assert.equal(profile.carrionAffinity, 0.6);
  assert.ok(Math.abs(stored.trophicLevel - 0.2) < 1e-12);
});

test("carrion affinity changes resource support independently of plant and live-prey affinity", () => {
  const lowCarrion = stateFor(lineage({
    plantMatterAffinity: 0.5,
    livePreyAffinity: 0.5,
    carrionAffinity: 0
  }), { carnivoreBiomass: 4 });
  const highCarrion = stateFor(lineage({
    plantMatterAffinity: 0.5,
    livePreyAffinity: 0.5,
    carrionAffinity: 1
  }), { carnivoreBiomass: 4 });

  advanceEvolutionaryEcology(lowCarrion, 10, () => 1);
  advanceEvolutionaryEcology(highCarrion, 10, () => 1);

  assert.ok(highCarrion.speciesLineages[0].populationIndex > lowCarrion.speciesLineages[0].populationIndex);
  assert.equal(highCarrion.speciesLineages[0].trophicLevel, lowCarrion.speciesLineages[0].trophicLevel);
});

test("legacy and explicitly equivalent feeding profiles evolve identically", () => {
  const legacy = stateFor(lineage());
  const explicit = stateFor(lineage({
    plantMatterAffinity: 0.3,
    livePreyAffinity: 0.7,
    carrionAffinity: 0.28
  }));

  advanceEvolutionaryEcology(legacy, 10, () => 1);
  advanceEvolutionaryEcology(explicit, 10, () => 1);

  assert.ok(Math.abs(legacy.speciesLineages[0].populationIndex - explicit.speciesLineages[0].populationIndex) < 1e-12);
});
