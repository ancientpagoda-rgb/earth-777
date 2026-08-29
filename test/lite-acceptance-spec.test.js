import test from "node:test";
import assert from "node:assert/strict";
import {
  LITE_ACCEPTANCE_CRITERIA,
  LITE_ACCEPTANCE_THRESHOLDS,
  acceptanceCriterion,
} from "./lite-acceptance-spec.mjs";
import {
  computeHydrology,
  countFlowChanges,
  fillTerrainDelta,
  prepareTerrainDrivers,
  classifyBiome,
} from "../public/lite/living-world-core.js";

test("Earth 777 Lite canonical acceptance contract remains complete", () => {
  assert.equal(LITE_ACCEPTANCE_CRITERIA.length, 22);
  assert.equal(new Set(LITE_ACCEPTANCE_CRITERIA.map(({ id }) => id)).size, 22);
  assert.ok(LITE_ACCEPTANCE_CRITERIA.every(({ canonical }) => canonical.length > 20));
});

test("canonical performance thresholds are locked", () => {
  assert.equal(LITE_ACCEPTANCE_THRESHOLDS.averageFps, 55);
  assert.equal(LITE_ACCEPTANCE_THRESHOLDS.onePercentLowFps, 30);
  assert.equal(LITE_ACCEPTANCE_THRESHOLDS.maxPerformanceRegressionFraction, 0.10);
  assert.equal(LITE_ACCEPTANCE_THRESHOLDS.cachedInteractiveMs, 5000);
  assert.equal(LITE_ACCEPTANCE_THRESHOLDS.soakMinutes, 20);
  assert.equal(LITE_ACCEPTANCE_THRESHOLDS.hundredXObservationMinutes, 5);
  assert.equal(LITE_ACCEPTANCE_THRESHOLDS.minimumEvolutionCycles, 30);
  assert.equal(LITE_ACCEPTANCE_THRESHOLDS.minimumSurfaceViewportWidths, 10);
  assert.equal(LITE_ACCEPTANCE_THRESHOLDS.zoomCycles, 20);
});

test("critical criteria have automated or proxy coverage", () => {
  for (const id of [
    "performance",
    "high-speed-simulation",
    "no-degradation",
    "load-time",
    "infinite-surface",
    "persistent-geography",
    "continuous-evolution",
    "simulation-continuity",
    "region-to-surface",
    "zoom",
    "navigation",
    "console-cleanliness",
    "regression-rule",
  ]) {
    const criterion = acceptanceCriterion(id);
    assert.ok(criterion, `missing criterion ${id}`);
    assert.notEqual(criterion.automation, "manual", `${id} unexpectedly manual-only`);
  }
});

test("Living Terrain is deterministic and visibly changes over a 100x observation horizon", () => {
  const width = 32;
  const height = 16;
  const size = width * height;
  const base = new Float32Array(size);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      base[y * width + x] = 900 - y * 45 + Math.sin(x * 0.55) * 280 + Math.cos(y * 0.8) * 90;
    }
  }
  const drivers = prepareTerrainDrivers(base, 777, width, height);
  const checkpoint = new Float32Array(size);
  const evolvedA = new Float32Array(size);
  const evolvedB = new Float32Array(size);
  fillTerrainDelta(base, checkpoint, 0, 777, drivers, width, height);
  const metricsA = fillTerrainDelta(base, evolvedA, 30_000, 777, drivers, width, height);
  const metricsB = fillTerrainDelta(base, evolvedB, 30_000, 777, drivers, width, height);
  assert.ok(checkpoint.every((value) => value === 0));
  assert.deepEqual([...evolvedA], [...evolvedB]);
  assert.ok(metricsA.meanAbs > 3, `mean terrain change too small: ${metricsA.meanAbs}`);
  assert.ok(metricsA.maxAbs > 10, `max terrain change too small: ${metricsA.maxAbs}`);
  assert.deepEqual(metricsA, metricsB);
});

test("Dynamic hydrology responds to changed topography", () => {
  const width = 12;
  const height = 8;
  const size = width * height;
  const base = new Float32Array(size);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) base[y * width + x] = 1200 - y * 130 + Math.abs(x - 6) * 20;
  const before = computeHydrology(base, -20, width, height);
  const diverted = base.slice();
  diverted[3 * width + 6] -= 700;
  const after = computeHydrology(diverted, -20, width, height);
  assert.ok(countFlowChanges(before.flow, after.flow) > 0);
  assert.notDeepEqual([...before.accumulation], [...after.accumulation]);
});

test("biome classification follows climate and terrain constraints", () => {
  assert.equal(classifyBiome({ temperature: 25, moisture: 0.82, frozen: 0, elevation: 100, sea: -20 }), 7);
  assert.equal(classifyBiome({ temperature: 22, moisture: 0.12, frozen: 0, elevation: 100, sea: -20 }), 3);
  assert.equal(classifyBiome({ temperature: -14, moisture: 0.5, frozen: 0.8, elevation: 100, sea: -20 }), 1);
  assert.equal(classifyBiome({ temperature: 8, moisture: 0.5, frozen: 0, elevation: -30, sea: -20 }), 0);
});
