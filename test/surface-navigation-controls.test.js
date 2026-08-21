import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGamepadDeadzone,
  surfaceTravelSpeedKmPerSecond,
  SURFACE_NAVIGATION_POLICY
} from "../src/render/SurfaceNavigationControls.js";

test("surface navigation exposes a stable input policy", () => {
  assert.equal(SURFACE_NAVIGATION_POLICY, "scale-aware-keyboard-standard-gamepad-v1");
});

test("gamepad deadzone removes stick drift and preserves full-scale input", () => {
  assert.equal(applyGamepadDeadzone(0.08), 0);
  assert.equal(applyGamepadDeadzone(-0.12), 0);
  assert.ok(applyGamepadDeadzone(0.6) > 0.4);
  assert.ok(applyGamepadDeadzone(-0.6) < -0.4);
  assert.equal(applyGamepadDeadzone(1), 1);
  assert.equal(applyGamepadDeadzone(-1), -1);
});

test("surface travel speed scales from walking-scale to geographic movement", () => {
  const ground = surfaceTravelSpeedKmPerSecond(0.005);
  const landscape = surfaceTravelSpeedKmPerSecond(2);
  const regional = surfaceTravelSpeedKmPerSecond(80);
  assert.ok(ground >= 0.003 && ground < 0.01);
  assert.ok(landscape > ground);
  assert.ok(regional > landscape);
  assert.ok(regional <= 24);
});

test("boost and precision modifiers are deterministic", () => {
  const normal = surfaceTravelSpeedKmPerSecond(10);
  const boost = surfaceTravelSpeedKmPerSecond(10, { boost: true });
  const precision = surfaceTravelSpeedKmPerSecond(10, { precision: true });
  assert.equal(boost, normal * 4);
  assert.equal(precision, normal * 0.24);
});
