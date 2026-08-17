import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const simulationWorker = readFileSync(new URL("../src/sim/simulation.worker.js", import.meta.url), "utf8");
const surfaceClient = readFileSync(new URL("../src/render/SurfaceComputeClient.js", import.meta.url), "utf8");
const surfaceTerrain = readFileSync(new URL("../src/render/WorkerSurfaceTerrainSystem.js", import.meta.url), "utf8");
const regionalWorker = readFileSync(new URL("../src/data/regional-data.worker.js", import.meta.url), "utf8");
const playtest = readFileSync(new URL("./cdp-playtest.mjs", import.meta.url), "utf8");

test("deeper optimization pass preserves scientific computation rather than replacing it with baked output", () => {
  assert.doesNotMatch(simulationWorker, /precomputed|baked|static snapshot/i);
  assert.match(surfaceClient, /surface-compute\.worker\.js/);
  assert.match(surfaceTerrain, /this\.computeClient\.terrain/);
  assert.match(regionalWorker, /loadKrapp777Climate/);
  assert.match(regionalWorker, /loadKrapp777Vegetation/);
});

test("performance profiler attributes long tasks by timing overlap and captures browser task metrics", () => {
  assert.match(playtest, /task\.startTime < segment\.endedAt/);
  assert.match(playtest, /taskEnd > segment\.startedAt/);
  assert.match(playtest, /Performance\.getMetrics/);
  assert.match(playtest, /TaskDuration/);
  assert.match(playtest, /ScriptDuration/);
});
