import test from "node:test";
import assert from "node:assert/strict";
import { collapseObservedFaunaPlan, faunaBehaviorAt, herdMotionAt } from "../src/sim/FaunaBehaviorDynamics.js";
import { buildObservedFaunaPlan } from "../src/sim/FaunaPopulationHierarchy.js";

const vegetation = { biomeCode: 17, npp: 1100, lai: 3 };
const hydrology = { surfaceRunoffMmPerYear: 500 };
const state = { herbivoreBiomass: 1.2, carnivoreBiomass: 0.8, productivityIndex: 1, elapsedYears: 12.25, seed: 777001 };

test("behavior is deterministic at the same simulated time", () => {
  const a = faunaBehaviorAt({ id: "animal-7", role: "herbivore", elapsedYears: 12.25, productivity: 0.8, waterAccess: 0.7, predatorPressure: 0.2 });
  const b = faunaBehaviorAt({ id: "animal-7", role: "herbivore", elapsedYears: 12.25, productivity: 0.8, waterAccess: 0.7, predatorPressure: 0.2 });
  assert.deepEqual(a, b);
});

test("herds move as simulated time advances", () => {
  const a = herdMotionAt({ id: "herd-x", baseX: 1, baseZ: 2, elapsedYears: 2, productivity: 0.8, waterAccess: 0.7, predatorPressure: 0.1 });
  const b = herdMotionAt({ id: "herd-x", baseX: 1, baseZ: 2, elapsedYears: 2.2, productivity: 0.8, waterAccess: 0.7, predatorPressure: 0.1 });
  assert.notDeepEqual([a.x, a.z], [b.x, b.z]);
});

test("predators can enter hunt behavior under strong prey pressure", () => {
  const behaviors = new Set();
  for (let i = 0; i < 20; i += 1) {
    behaviors.add(faunaBehaviorAt({
      id: `pred-${i}`,
      role: "carnivore",
      elapsedYears: 4.2,
      preyPressure: 1,
      waterAccess: 0.8,
      aggregatePrior: { meanEnergy: 0.2, meanStress: 0.2 }
    }).behavior);
  }
  assert.ok(behaviors.has("hunt"));
});

test("observed plan includes predator packs and behavior states", () => {
  const plan = buildObservedFaunaPlan({ state, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 777001, windowRadiusKm: 4, individualRadiusKm: 4 });
  assert.ok(plan.packs.length > 0);
  assert.equal(plan.materializedCarnivores, plan.visibleCarnivorePopulation);
  assert.ok(plan.individuals.every((actor) => actor.behaviorState?.behavior));
});

test("collapsed observed behavior becomes a compact aggregate prior", () => {
  const plan = buildObservedFaunaPlan({ state, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 777001, windowRadiusKm: 2.5, individualRadiusKm: 1 });
  const collapsed = collapseObservedFaunaPlan(plan);
  assert.ok(collapsed.representedPopulation > 0);
  assert.ok(collapsed.meanEnergy >= 0 && collapsed.meanEnergy <= 1);
  assert.ok(collapsed.meanStress >= 0 && collapsed.meanStress <= 1);
  assert.ok(Object.keys(collapsed.behaviorCounts).length > 0);
});
