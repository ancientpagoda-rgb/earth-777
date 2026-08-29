import test from "node:test";
import assert from "node:assert/strict";
import {
  LITE_ACCEPTANCE_CRITERIA,
  LITE_ACCEPTANCE_THRESHOLDS,
  acceptanceCriterion,
} from "./lite-acceptance-spec.mjs";

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
