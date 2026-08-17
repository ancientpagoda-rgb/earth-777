import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const earthView = readFileSync(new URL("../src/render/earth-view.js", import.meta.url), "utf8");
const surfacePresentation = readFileSync(new URL("../src/render/SurfacePresentation.js", import.meta.url), "utf8");
const workerSurfaceTerrain = readFileSync(new URL("../src/render/WorkerSurfaceTerrainSystem.js", import.meta.url), "utf8");
const workerSurfaceEcology = readFileSync(new URL("../src/render/WorkerSurfaceEcologyManager.js", import.meta.url), "utf8");
const surfaceComputeClient = readFileSync(new URL("../src/render/SurfaceComputeClient.js", import.meta.url), "utf8");
const surfaceComputeWorker = readFileSync(new URL("../src/render/surface-compute.worker.js", import.meta.url), "utf8");
const simulationWorker = readFileSync(new URL("../src/sim/simulation.worker.js", import.meta.url), "utf8");
const simulationClient = readFileSync(new URL("../src/sim/SimulationWorkerClient.js", import.meta.url), "utf8");
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

test("continuous simulation transfers state deltas while seek/reset keep full-state ownership safe", () => {
  assert.match(simulationWorker, /stateMode: "delta"/);
  assert.match(simulationWorker, /statePatch/);
  assert.match(simulationWorker, /fidelityPayload\(\)/);
  assert.match(simulationClient, /message\.statePatch/);
  assert.match(simulationClient, /this\.latestState = Object\.freeze/);
  assert.match(simulationClient, /message\.version === this\.version/);
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

test("surface terrain and vegetation CPU generation use a transferable worker with a compatibility fallback", () => {
  assert.match(surfacePresentation, /WorkerSurfaceTerrainSystem/);
  assert.match(surfaceComputeClient, /surface-compute\.worker\.js/);
  assert.match(surfaceComputeWorker, /buildTerrainChunkData/);
  assert.match(surfaceComputeWorker, /buildEcologyChunkPlan/);
  assert.match(surfaceComputeWorker, /transferListForTerrain/);
  assert.match(workerSurfaceTerrain, /this\.computeClient\.terrain/);
  assert.match(workerSurfaceTerrain, /new THREE\.BufferGeometry/);
  assert.match(workerSurfaceTerrain, /return super\.pump\(budgetMs\)/);
  assert.match(workerSurfaceEcology, /this\.computeClient\.ecology/);
  assert.match(workerSurfaceEcology, /return super\.pump\(budgetMs\)/);
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
  assert.match(regionalWorker, /self\.postMessage\(\{ id, asset, buffer, cacheSource: source \}, \[buffer\]\)/);
});

test("verified raw science bytes persist across reloads and are integrity-checked before reuse", () => {
  assert.match(regionalWorker, /indexedDB\.open/);
  assert.match(regionalWorker, /earth-777-science-cache-v1/);
  assert.match(regionalWorker, /sourceSha256 !== meta\.assetSha256/);
  assert.match(regionalWorker, /bytes\.byteLength !== meta\.uncompressedBytes/);
  assert.match(regionalWorker, /sha256Hex\(bytes\)/);
  assert.match(regionalWorker, /deletePersistent/);
  assert.match(regionalClient, /persistentHits/);
});

test("decoded assets and constructed regional models are cached across selections", () => {
  assert.match(regionalWorker, /const cache = new Map\(\)/);
  assert.match(regionalClient, /this\.cache = new Map\(\)/);
  assert.match(regionalClient, /if \(this\.cache\.has\(asset\)\) return this\.cache\.get\(asset\)/);
  assert.match(regionalRuntime, /let runtimePromise = null/);
  assert.match(regionalRuntime, /runtimePromise \?\?= buildRegionalScience/);
});

test("terrain data, reconstruction logic, lithosphere, and Three.js have explicit cache boundaries", () => {
  assert.match(vite, /vendor-three/);
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
