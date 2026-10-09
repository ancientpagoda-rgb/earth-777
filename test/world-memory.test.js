import test from "node:test";
import assert from "node:assert/strict";
import { FreeEarthEngine } from "../src/sim/free-earth.js";
import { WORLD_MEMORY_POLICY, WorldMemory } from "../src/sim/WorldMemory.js";

test("world memory keeps recent detail and compacts older samples into bounded tiers", () => {
  const engine = new FreeEarthEngine(777001);
  const state = engine.advance(777_000);
  const memory = state.worldMemory;

  assert.equal(memory.policy, WORLD_MEMORY_POLICY);
  assert.ok(memory.tiers.hot.length <= memory.diagnostics.limits.maxHotSamples);
  assert.ok(memory.tiers.warm.length <= memory.diagnostics.limits.maxWarmBins);
  assert.ok(memory.tiers.cold.length <= memory.diagnostics.limits.maxColdBins);
  assert.ok(memory.diagnostics.totalSamples > memory.tiers.hot.length);
  assert.ok(memory.tiers.warm.length > 0 || memory.tiers.cold.length > 0);
  assert.ok(memory.tiers.hot.at(-1).elapsedYears === 777_000);
});

test("world memory is deterministic for the same engine seed and policy", () => {
  const first = new FreeEarthEngine(12345).advance(20_000).worldMemory;
  const second = new FreeEarthEngine(12345).advance(20_000).worldMemory;

  assert.deepEqual(first, second);
});

test("world memory retains event highlights while counting compacted older events", () => {
  const memory = new WorldMemory({
    hotWindowYears: 10,
    maxHotSamples: 2,
    warmBinYears: 10,
    maxWarmBins: 1,
    maxColdBins: 1,
    maxEventHighlights: 2
  });

  for (let year = 0; year <= 100; year += 10) {
    memory.record({
      elapsedYears: year,
      yearBP: 777_000 - year,
      stage: "test",
      temperatureAnomaly: year
    }, [{ yearBP: 777_000 - year, text: `Animal lineage ${year} becomes extinct.` }]);
  }

  const snapshot = memory.snapshot();
  assert.equal(snapshot.tiers.hot.length, 2);
  assert.ok(snapshot.tiers.cold.length <= 1);
  assert.ok(snapshot.compactedEventKinds.extinctions > 0);
  assert.equal(snapshot.eventHighlights.length, 2);
});

