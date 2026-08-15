import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const earthView = readFileSync(new URL("../src/render/earth-view.js", import.meta.url), "utf8");
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
