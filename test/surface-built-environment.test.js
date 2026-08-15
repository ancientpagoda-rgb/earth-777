import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const managerUrl = new URL("../src/render/SurfaceBuiltEnvironmentManager.js", import.meta.url);
const terrainUrl = new URL("../src/render/SurfaceTerrainSystem.js", import.meta.url);
const profileUrl = new URL("../src/render/SurfaceBiomeProfile.js", import.meta.url);

test("surface built environment projects modeled defensive works and water transport without causal feedback", () => {
  const manager = readFileSync(managerUrl, "utf8");
  const terrain = readFileSync(terrainUrl, "utf8");
  const profile = readFileSync(profileUrl, "utf8");
  assert.match(terrain, /SurfaceBuiltEnvironmentManager/);
  assert.match(terrain, /surfaceBuiltEnvironment\.setContext/);
  assert.match(profile, /homininDefensiveWorksIndex/);
  assert.match(profile, /homininWaterTransportIndex/);
  assert.match(manager, /homininDefensiveWorksIndex/);
  assert.match(manager, /homininWaterTransportIndex/);
  assert.match(manager, /_nearestVisibleWater/);
  assert.match(manager, /adaptive visual LOD/);
});

test("built-environment presentation contains no scripted historical outcome labels", () => {
  const manager = readFileSync(managerUrl, "utf8");
  assert.doesNotMatch(manager, /pirate|castle|empire|kingdom|medieval|bronze age|iron age/i);
  assert.match(manager, /defensiveWork/);
  assert.match(manager, /watercraft/);
});
