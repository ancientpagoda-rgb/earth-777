import test from "node:test";
import assert from "node:assert/strict";
import { applyDeadzone, buttonValue, pickGamepad, readGamepadState } from "../src/input/gamepad.js";

test("deadzone suppresses tiny stick drift and rescales intentional input", () => {
  assert.equal(applyDeadzone(0.05), 0);
  assert.equal(applyDeadzone(-0.18), 0);
  assert.ok(applyDeadzone(0.6) > 0.45);
  assert.ok(applyDeadzone(-0.6) < -0.45);
});

test("button values normalize numeric and object-shaped inputs", () => {
  assert.equal(buttonValue(undefined), 0);
  assert.equal(buttonValue(0.4), 0.4);
  assert.equal(buttonValue({ value: 0.75, pressed: false }), 0.75);
  assert.equal(buttonValue({ value: 0.1, pressed: true }), 1);
});

test("preferred connected gamepads are kept when available", () => {
  const pads = [
    { connected: true, index: 0, id: "primary" },
    { connected: true, index: 1, id: "secondary" }
  ];

  assert.equal(pickGamepad(pads, 1)?.id, "secondary");
  assert.equal(pickGamepad([{ connected: false }, pads[1]], 0)?.id, "secondary");
});

test("gamepad state favors stick zoom but falls back to triggers", () => {
  const stickZoom = readGamepadState({
    axes: [0.42, -0.5, 0, -0.9],
    buttons: Array.from({ length: 8 }, () => ({ value: 0, pressed: false }))
  });
  assert.ok(stickZoom.orbitX > 0);
  assert.ok(stickZoom.orbitY < 0);
  assert.ok(stickZoom.zoom < -0.8);

  const triggerZoom = readGamepadState({
    axes: [0, 0, 0, 0.03],
    buttons: [
      { value: 0, pressed: false },
      { value: 0, pressed: false },
      { value: 0, pressed: false },
      { value: 0, pressed: false },
      { value: 0, pressed: false },
      { value: 0, pressed: false },
      { value: 0.8, pressed: false },
      { value: 0.1, pressed: false }
    ]
  });
  assert.ok(triggerZoom.zoom > 0.6);
});
