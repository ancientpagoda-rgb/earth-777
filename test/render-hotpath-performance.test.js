import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const earthView = readFileSync(new URL("../src/render/earth-view.js", import.meta.url), "utf8");
const globePresentation = readFileSync(new URL("../src/render/GlobePresentation.js", import.meta.url), "utf8");
const surfacePresentation = readFileSync(new URL("../src/render/SurfacePresentation.js", import.meta.url), "utf8");
const surfacePresentationBase = readFileSync(new URL("../src/render/SurfacePresentationBase.js", import.meta.url), "utf8");
const rasterRefresh = readFileSync(new URL("../src/render/RasterRefresh.js", import.meta.url), "utf8");
const surfaceTerrain = readFileSync(new URL("../src/render/SurfaceTerrainSystem.js", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("surface render hot path checks pending work without materializing diagnostics", () => {
  assert.match(earthView, /terrain\.hasPendingWork\?\.\(\)/);
  assert.doesNotMatch(earthView, /terrain\.diagnostics\(\)\.queuedChunks/);
  assert.match(surfaceTerrain, /hasPendingWork\(\)/);
});

test("expensive diagnostics snapshots are throttled instead of rebuilt every frame", () => {
  assert.match(earthView, /DIAGNOSTICS_INTERVAL_MS = 250/);
  assert.match(earthView, /this\.diagnosticsCache/);
  assert.match(earthView, /now - this\.diagnosticsCacheAt < DIAGNOSTICS_INTERVAL_MS/);
});

test("unchanged adaptive performance settings are not reapplied", () => {
  assert.match(earthView, /lastPerformanceSignature/);
  assert.match(earthView, /signature === this\.lastPerformanceSignature/);
  assert.match(earthView, /return false/);
});

test("surface science context is inactive while globe-only rendering does not need it", () => {
  assert.match(surfaceTerrain, /surfaceContextActive = false/);
  assert.match(surfaceTerrain, /setSurfaceContextActive\(active/);
  assert.match(surfaceTerrain, /if \(!this\.surfaceContextActive \|\| !this\.origin\) return false/);
  assert.match(earthView, /const needsSurfaceContext = this\.mode !== "globe"/);
  assert.match(earthView, /setEarthSystemState\?\.\(state, state\.seed, refreshContext, \{ refreshTerrain, refreshTopography \}\)/);
});

test("surface water reuses cached hydrology context before issuing a fallback query", () => {
  assert.match(surfaceTerrain, /currentWaterSystem\(\)/);
  assert.match(earthView, /this\.terrain\.currentWaterSystem\?\.\(\)/);
});

test("interaction prioritizes smooth frames before rebuilding all surface detail", () => {
  assert.match(earthView, /initialTier: "high"/);
  assert.match(earthView, /SURFACE_PUMP_ACTIVE_MS = 0\.9/);
  assert.match(earthView, /SURFACE_PUMP_IDLE_MS = 2\.3/);
  assert.match(earthView, /this\.interacting \? SURFACE_PUMP_ACTIVE_MS : SURFACE_PUMP_IDLE_MS/);
});

test("mouse-wheel zoom follows the conventional direction in globe and surface views", () => {
  assert.match(globePresentation, /controls\.zoomSpeed = 1\.0/);
  assert.match(surfacePresentationBase, /controls\.zoomSpeed = 1\.0/);
  assert.doesNotMatch(globePresentation, /zoomSpeed = -/);
  assert.doesNotMatch(surfacePresentationBase, /zoomSpeed = -/);
});

test("globe zoom keeps a single damping model throughout the gesture", () => {
  assert.match(globePresentation, /controls\.enableDamping = true/);
  assert.match(globePresentation, /controls\.dampingFactor = 0\.09/);
  assert.doesNotMatch(globePresentation, /controls\.enableDamping = false/);
  assert.doesNotMatch(globePresentation, /controls\.addEventListener\("start"/);
  assert.doesNotMatch(globePresentation, /controls\.addEventListener\("end"/);
});

test("globe interaction leaves renderer resolution and transparent layers stable", () => {
  assert.doesNotMatch(globePresentation, /INTERACTION_PIXEL_RATIO_CAP/);
  assert.doesNotMatch(globePresentation, /canvas\.width\s*=/);
  assert.doesNotMatch(globePresentation, /canvas\.height\s*=/);
  assert.doesNotMatch(globePresentation, /clouds\.visible = false/);
  assert.doesNotMatch(globePresentation, /atmosphere\.visible = false/);
});

test("completed raster jobs wait until globe motion settles before GPU upload", () => {
  assert.match(rasterRefresh, /applyWhenViewSettles/);
  assert.match(rasterRefresh, /Boolean\(view\.interacting\)/);
  assert.match(rasterRefresh, /performance\.now\(\) < \(Number\(view\.continuousUntilMs\) \|\| 0\)/);
  assert.match(rasterRefresh, /setTimeout\(tryApply, RASTER_APPLY_RETRY_MS\)/);
});

test("playback yields to globe manipulation through the post-drag settle window", () => {
  assert.match(earthView, /INTERACTION_SETTLE_MS = 900/);
  assert.match(earthView, /continuousUntilMs = performance\.now\(\) \+ INTERACTION_SETTLE_MS/);
  assert.match(earthView, /isInteracting\(now = performance\.now\(\)\)/);
  assert.match(earthView, /now < this\.continuousUntilMs/);
});

test("globe interaction reuses cached diagnostics instead of rebuilding terrain telemetry", () => {
  assert.match(earthView, /this\.isInteracting\(now\) && this\.diagnosticsCache/);
  assert.match(earthView, /return this\.diagnosticsCache/);
});

test("adaptive visual retuning cannot resize the globe during an active drag", () => {
  assert.match(earthView, /this\.mode !== "globe" && \(this\.interacting \|\| this\.descent \|\| this\.surfaceEntry\)/);
});

test("fast-forward batches worker advances and throttles expensive surface-state rebuilds", () => {
  assert.match(main, /SIMULATION_INTERVAL_MS = 250/);
  assert.match(earthView, /SURFACE_STATE_REFRESH_YEARS = 250/);
  assert.match(earthView, /SURFACE_STATE_REFRESH_INTERVAL_MS = 3_000/);
  assert.match(earthView, /this\._terrainStateRefreshDue\(state, force, now\)/);
  assert.match(earthView, /yearDelta >= SURFACE_STATE_REFRESH_YEARS/);
  assert.match(earthView, /const refreshExactTerrain = force \|\| !this\.simulationPlaying/);
  assert.match(surfaceTerrain, /if \(refreshTerrain\) this\.setGeomorphologyPatch/);
});

test("fast-forward preserves the current topography until an exact refresh is safe", () => {
  assert.match(earthView, /refreshTopography: refreshExactTerrain/);
  assert.match(surfaceTerrain, /if \(refreshTopography\) \{/);
  assert.match(surfaceTerrain, /this\.earthState = state \?\? null/);
  assert.match(surfaceTerrain, /2,500-year terrain band changes/);
});

test("pausing fast-forward commits the exact final surface state", () => {
  assert.match(earthView, /const stopped = this\.simulationPlaying && !next/);
  assert.match(earthView, /this\._applyTerrainState\(this\.lastState, \{ refreshContext: this\.mode !== "globe" \}\)/);
  assert.match(earthView, /this\.mode === "surface"[\s\S]*this\.updateSurfaceWater\(\)/);
});
