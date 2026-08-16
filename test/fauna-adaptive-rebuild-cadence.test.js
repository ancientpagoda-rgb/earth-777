import test from "node:test";
import assert from "node:assert/strict";
import { faunaAdaptiveRebuildIntervalMs } from "../src/render/SurfaceFaunaManager.js";

test("cheap fauna rebuilds remain near frame cadence", () => {
  assert.equal(faunaAdaptiveRebuildIntervalMs(0), 16);
  assert.equal(faunaAdaptiveRebuildIntervalMs(1), 16);
  assert.equal(faunaAdaptiveRebuildIntervalMs(2), 16);
});

test("measured rebuild cost increases the next rebuild spacing", () => {
  assert.equal(faunaAdaptiveRebuildIntervalMs(4), 32);
  assert.equal(faunaAdaptiveRebuildIntervalMs(8), 64);
  assert.equal(faunaAdaptiveRebuildIntervalMs(12), 96);
});

test("adaptive rebuild spacing stays bounded", () => {
  assert.equal(faunaAdaptiveRebuildIntervalMs(50), 120);
  assert.equal(faunaAdaptiveRebuildIntervalMs(-10), 16);
});
