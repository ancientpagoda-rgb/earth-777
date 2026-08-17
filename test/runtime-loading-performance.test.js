import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const earthView = readFileSync(new URL("../src/render/earth-view.js", import.meta.url), "utf8");
const regionalRuntime = readFileSync(new URL("../src/sim/RegionalScienceRuntime.js", import.meta.url), "utf8");
const regionalClient = readFileSync(new URL("../src/data/RegionalDataWorkerClient.js", import.meta.url), "utf8");
const regionalWorker = readFileSync(new URL("../src/data/regional-data.worker.js", import.meta.url), "utf8");
const vite = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");
const bundleBudget = readFileSync(new URL("../scripts/check-bundle-budget.mjs", import.meta.url), "utf8");

test("startup gets the initial checkpoint from the simulation worker instead of constructing FreeEarthEngine on the UI thread", () => {
  assert.doesNotMatch(main, /import\s+\{\s*FreeEarthEngine\s*\}/);
  assert.doesNotMatch(main, /new FreeEarthEngine/);
  assert.match(main, /await simulation\.ready/);
  assert.match(main, /currentState = initialSimulation\.state/);
});

test("surface scene and terrain stack are absent from the eager EarthView module graph", () => {
  assert.doesNotMatch(earthView, /^import .*SurfacePresentation/m);
  assert.doesNotMatch(earthView, /^import .*ViewTransitions/m);
  assert.match(earthView, /import\("\.\/SurfacePresentation\.js"\)/);
  assert.match(earthView, /import\("\.\/ViewTransitions\.js"\)/);
  assert.match(earthView, /async _ensureSurfaceRuntime\(\)/);
  assert.match(earthView, /await this\._ensureSurfaceRuntime\(\)/);
  assert.match(earthView, /surfaceLoaded: Boolean\(this\.terrain\)/);
});

test("regional observation and reconstruction science remain code-split out of startup", () => {
  assert.match(main, /import\("\.\/render\/RegionPanel\.js"\)/);
  assert.match(main, /import\("\.\/sim\/RegionalScienceRuntime\.js"\)/);
  assert.doesNotMatch(main, /import\("\.\/data\/krapp-777-climate\.js"\)/);
  assert.doesNotMatch(main, /import\("\.\/sim\/EarthSystemHydrology\.js"\)/);
});

test("regional science yields to first interaction and publishes progressive stages", () => {
  assert.match(main, /REGIONAL_SCIENCE_IDLE_TIMEOUT_MS = 750/);
  assert.match(main, /requestIdleCallback/);
  assert.match(main, /ensureRegionalScience\(\)\.then/);
  assert.match(regionalRuntime, /publish\("climate"/);
  assert.match(regionalRuntime, /publish\("hydrology-provisional"/);
  assert.match(regionalRuntime, /publish\("hydrology"/);
  assert.match(regionalRuntime, /publish\("complete"/);
});

test("large regional assets are verified and decompressed in a dedicated worker", () => {
  assert.match(regionalClient, /new Worker\(new URL\("\.\/regional-data\.worker\.js"/);
  assert.match(regionalWorker, /loadKrapp777Climate/);
  assert.match(regionalWorker, /loadKrapp777Vegetation/);
  assert.match(regionalWorker, /loadBiome4Soil/);
  assert.match(regionalWorker, /loadBiome4PftDrivers/);
  assert.match(regionalWorker, /self\.postMessage\(\{ id, asset, buffer \}, \[buffer\]\)/);
});

test("decoded assets and constructed regional models are cached across selections", () => {
  assert.match(regionalWorker, /const cache = new Map\(\)/);
  assert.match(regionalClient, /this\.cache = new Map\(\)/);
  assert.match(regionalClient, /if \(this\.cache\.has\(asset\)\) return this\.cache\.get\(asset\)/);
  assert.match(regionalRuntime, /let runtimePromise = null/);
  assert.match(regionalRuntime, /runtimePromise \?\?= buildRegionalScience/);
});

test("terrain data, reconstruction logic and lithosphere have explicit chunk boundaries", () => {
  assert.match(vite, /terrain-etopo/);
  assert.match(vite, /terrain-reconstruction/);
  assert.match(vite, /dynamic-lithosphere/);
});

test("CI bundle budget caps eager JavaScript and requires deferred surface mode", () => {
  assert.match(bundleBudget, /MAX_EAGER_RAW_BYTES = 665_000/);
  assert.match(bundleBudget, /MAX_EAGER_GZIP_BYTES = 195_000/);
  assert.match(bundleBudget, /SurfacePresentation/);
  assert.match(bundleBudget, /surfaceDeferred/);
});
