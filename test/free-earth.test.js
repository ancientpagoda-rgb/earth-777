import test from "node:test";
import assert from "node:assert/strict";
import { CHECKPOINT_777 } from "../src/data/checkpoint-777.js";
import { ORBITAL_ANCHOR, paleoForcingAt } from "../src/data/paleo-forcing.js";
import { FreeEarthEngine, regionalState } from "../src/sim/free-earth.js";

test("checkpoint carries the published MIS 19 boundary conditions", () => {
  assert.equal(CHECKPOINT_777.yearsBeforePresent, 777_000);
  assert.equal(CHECKPOINT_777.boundary.co2.value, 245);
  assert.equal(CHECKPOINT_777.boundary.methane.value, 631);
  assert.equal(CHECKPOINT_777.boundary.obliquity.value, 23.3);
  assert.equal(CHECKPOINT_777.boundary.eccentricity.value, 0.023);
  assert.equal(CHECKPOINT_777.boundary.seaLevelAnomaly.value, -12.76);
});

test("published forcing layers meet the canonical checkpoint", () => {
  const forcing = paleoForcingAt(777_000);
  assert.ok(Math.abs(forcing.eccentricity - 0.023) < 1e-9);
  assert.ok(Math.abs(forcing.obliquity - 23.3) < 1e-9);
  assert.ok(Math.abs(forcing.precession - 108.9) < 1e-9);
  assert.equal(forcing.seaLevel, -12.76);
  assert.equal(forcing.seaLevelSigma, 9.52);
  assert.ok(Math.abs(ORBITAL_ANCHOR.eccentricityOffset) < 0.01);
});

test("forcing interpolation is continuous inside a one-kyr interval", () => {
  const older = paleoForcingAt(777_000);
  const middle = paleoForcingAt(776_500);
  const younger = paleoForcingAt(776_000);
  assert.ok(middle.eccentricity > Math.min(older.eccentricity, younger.eccentricity));
  assert.ok(middle.eccentricity < Math.max(older.eccentricity, younger.eccentricity));
  assert.equal(middle.seaLevel, (older.seaLevel + younger.seaLevel) / 2);
  const present = paleoForcingAt(0);
  assert.equal(present.anchorWeight, 0);
  assert.ok(Math.abs(present.eccentricity - 0.016702362) < 1e-9);
});

test("Free Earth branches are deterministic by seed", () => {
  const first = new FreeEarthEngine(777001);
  const second = new FreeEarthEngine(777001);
  assert.deepEqual(first.advance(12_000), second.advance(12_000));
});

test("different branches diverge without leaving physical guardrails", () => {
  const first = new FreeEarthEngine(777001).advance(25_000);
  const second = new FreeEarthEngine(777002).advance(25_000);
  assert.notEqual(first.co2, second.co2);
  for (const state of [first, second]) {
    assert.ok(Number.isFinite(state.temperatureAnomaly));
    assert.ok(state.co2 >= 170 && state.co2 <= 330);
    assert.ok(state.iceIndex >= 0.03 && state.iceIndex <= 1);
    assert.ok(state.yearBP >= 0 && state.yearBP <= 777_000);
  }
});

test("seeking backward reconstructs the same deterministic state", () => {
  const engine = new FreeEarthEngine(77);
  engine.seek(10_000);
  engine.seek(2_000);
  const reconstructed = engine.snapshot();
  const expected = new FreeEarthEngine(77).seek(2_000);
  assert.deepEqual(reconstructed, expected);
});

test("regional materialization is finite and classified", () => {
  const state = new FreeEarthEngine().snapshot();
  const region = regionalState(state, 52, 13);
  assert.ok(Number.isFinite(region.annualTemperature));
  assert.ok(region.biome.length > 3);
});
