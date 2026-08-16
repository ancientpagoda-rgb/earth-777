import test from "node:test";
import assert from "node:assert/strict";
import { FreeEarthEngine } from "../src/sim/free-earth.js";
import {
  aggregateFeedingShares,
  syncAggregateFaunaProjections
} from "../src/sim/AggregateFaunaEcology.js";

function lineage(overrides = {}) {
  return {
    id: 1,
    parentId: null,
    birthYearBP: 777000,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.4,
    plantMatterAffinity: 0.6,
    livePreyAffinity: 0.4,
    carrionAffinity: 0.2,
    bodyMassLog10Kg: 1,
    thermalOptimumK: -1,
    mobility: 0.5,
    sociality: 0.5,
    cognition: 0.5,
    dietBreadth: 0.5,
    divergence: 0,
    ...overrides
  };
}

function assertPartition(state) {
  assert.ok(Number.isFinite(state.animalBiomass));
  assert.ok(state.animalBiomass > 0);
  assert.ok(Math.abs(state.animalPlantMatterBiomass + state.animalLivePreyBiomass - state.animalBiomass) < 1e-12);
  assert.ok(Math.abs(state.herbivoreBiomass - state.animalPlantMatterBiomass) < 1e-12);
  assert.ok(Math.abs(state.carnivoreBiomass - state.animalLivePreyBiomass) < 1e-12);
  assert.ok(Math.abs(state.animalPlantMatterShare + state.animalLivePreyShare - 1) < 1e-12);
}

test("Free Earth initializes and advances one aggregate animal biomass pool", () => {
  const engine = new FreeEarthEngine(777001);
  assertPartition(engine.state);
  assert.equal(engine.state.animalBiomass, 1);

  engine.advance(250);
  assertPartition(engine.state);
  assert.ok(Number.isFinite(engine.state.animalCarryingCapacityIndex));
  assert.ok(Number.isFinite(engine.state.predationPressureIndex));
});

test("an omnivorous lineage partitions one biomass pool instead of appearing in two population pools", () => {
  const engine = new FreeEarthEngine(777002);
  engine.state.speciesLineages = [lineage({ plantMatterAffinity: 0.6, livePreyAffinity: 0.4 })];
  syncAggregateFaunaProjections(engine.state);

  const shares = aggregateFeedingShares(engine.state);
  assert.ok(Math.abs(shares.plantMatterShare - 0.6) < 1e-12);
  assert.ok(Math.abs(shares.livePreyShare - 0.4) < 1e-12);
  assert.ok(Math.abs(engine.state.herbivoreBiomass - engine.state.animalBiomass * 0.6) < 1e-12);
  assert.ok(Math.abs(engine.state.carnivoreBiomass - engine.state.animalBiomass * 0.4) < 1e-12);
  assertPartition(engine.state);
});

test("legacy biomass writes are ingested once and immediately become complementary projections", () => {
  const engine = new FreeEarthEngine(777003);
  engine.state.herbivoreBiomass = 4;
  engine.state.carnivoreBiomass = 2;

  syncAggregateFaunaProjections(engine.state, { acceptLegacyInput: true });

  assert.equal(engine.state.animalBiomass, 6);
  assert.ok(Math.abs(engine.state.animalPlantMatterShare - 2 / 3) < 1e-12);
  assert.ok(Math.abs(engine.state.animalLivePreyShare - 1 / 3) < 1e-12);
  assert.equal(engine.state.herbivoreBiomass, 4);
  assert.equal(engine.state.carnivoreBiomass, 2);
  assertPartition(engine.state);

  engine.state.speciesLineages = [lineage({ plantMatterAffinity: 0.2, livePreyAffinity: 0.8 })];
  syncAggregateFaunaProjections(engine.state);
  assert.equal(engine.state.animalBiomass, 6);
  assert.ok(Math.abs(engine.state.herbivoreBiomass - 1.2) < 1e-12);
  assert.ok(Math.abs(engine.state.carnivoreBiomass - 4.8) < 1e-12);
  assertPartition(engine.state);
});

test("adaptive runtime executes unified fauna rather than two feeding categories", () => {
  const engine = new FreeEarthEngine(777004, { fidelityBudget: 1.5 });
  engine.advance(250);
  const diagnostics = engine.fidelityDiagnostics();
  const ids = new Set(diagnostics.targets.map((target) => target.id));

  assert.ok(ids.has("fauna"));
  assert.ok(!ids.has("herbivores"));
  assert.ok(!ids.has("carnivores"));
  assert.ok((diagnostics.executedSubsteps.fauna ?? 0) > 0);
  assert.equal(diagnostics.executedSubsteps.herbivores, undefined);
  assert.equal(diagnostics.executedSubsteps.carnivores, undefined);
});
