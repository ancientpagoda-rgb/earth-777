import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const earthView = readFileSync(new URL("../src/render/earth-view.js", import.meta.url), "utf8");
const globePresentation = readFileSync(new URL("../src/render/GlobePresentation.js", import.meta.url), "utf8");
const rasterRefresh = readFileSync(new URL("../src/render/RasterRefresh.js", import.meta.url), "utf8");
const surfaceTerrain = readFileSync(new URL("../src/render/SurfaceTerrainSystem.js", import.meta.url), "utf8");

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
  assert.match(earthView, /setEarthSystemState\?\.\(state, state\.seed, needsSurfaceContext\)/);
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

test("globe drag disables damping only for the active gesture", () => {
  assert.match(globePresentation, /dampingFactor = 0\.09/);
  assert.match(globePresentation, /addEventListener\("start", \(\) => \{ controls\.enableDamping = false; \}\)/);
  assert.match(globePresentation, /addEventListener\("end", \(\) => \{ controls\.enableDamping = true; \}\)/);
});

test("completed raster jobs wait until globe motion settles before GPU upload", () => {
  assert.match(rasterRefresh, /applyWhenViewSettles/);
  assert.match(rasterRefresh, /Boolean\(view\.interacting\)/);
  assert.match(rasterRefresh, /performance\.now\(\) < \(Number\(view\.continuousUntilMs\) \|\| 0\)/);
  assert.match(rasterRefresh, /setTimeout\(tryApply, RASTER_APPLY_RETRY_MS\)/);
});
