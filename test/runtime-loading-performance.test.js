import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("startup gets the initial checkpoint from the simulation worker instead of constructing FreeEarthEngine on the UI thread", () => {
  assert.doesNotMatch(main, /import\s+\{\s*FreeEarthEngine\s*\}/);
  assert.doesNotMatch(main, /new FreeEarthEngine/);
  assert.match(main, /await simulation\.ready/);
  assert.match(main, /currentState = initialSimulation\.state/);
});

test("regional observation and reconstruction science are code-split out of the startup path", () => {
  assert.match(main, /import\("\.\/render\/RegionPanel\.js"\)/);
  assert.match(main, /import\("\.\/data\/krapp-777-climate\.js"\)/);
  assert.match(main, /import\("\.\/data\/krapp-777-vegetation\.js"\)/);
  assert.match(main, /import\("\.\/sim\/EarthSystemHydrology\.js"\)/);
  assert.match(main, /import\("\.\/sim\/SpatialVegetation\.js"\)/);
});

test("regional science yields to first interaction but can be demand-loaded by a selection", () => {
  assert.match(main, /REGIONAL_SCIENCE_IDLE_TIMEOUT_MS = 750/);
  assert.match(main, /requestIdleCallback/);
  assert.match(main, /ensureRegionalScience\(\)\.then/);
  assert.match(main, /Promise\.allSettled\(\[loadBiome4Soil\(\), loadBiome4PftDrivers\(\)\]\)/);
});
