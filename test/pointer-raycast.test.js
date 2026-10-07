import test from "node:test";
import assert from "node:assert/strict";
import { isTapGesture } from "../src/render/PointerRaycast.js";

test("globe picking accepts a short stationary touch or click", () => {
  assert.equal(isTapGesture(
    { clientX: 120, clientY: 80, timeStamp: 100 },
    { clientX: 126, clientY: 84, timeStamp: 420 }
  ), true);
});

test("globe picking rejects camera drags and long presses", () => {
  assert.equal(isTapGesture(
    { clientX: 120, clientY: 80, timeStamp: 100 },
    { clientX: 140, clientY: 84, timeStamp: 420 }
  ), false);
  assert.equal(isTapGesture(
    { clientX: 120, clientY: 80, timeStamp: 100 },
    { clientX: 122, clientY: 82, timeStamp: 900 }
  ), false);
});
