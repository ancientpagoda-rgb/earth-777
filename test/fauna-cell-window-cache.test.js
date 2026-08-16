import test from "node:test";
import assert from "node:assert/strict";
import { faunaCellWindowKey } from "../src/render/SurfaceTerrainSystem.js";

test("fauna cell window key is stable within the same local degree cell", () => {
  const a = faunaCellWindowKey(39.10, -95.90);
  const b = faunaCellWindowKey(39.99, -95.01);
  assert.equal(a, b);
});

test("fauna cell window key changes only when the local cell changes", () => {
  assert.notEqual(faunaCellWindowKey(39.99, -95.5), faunaCellWindowKey(40.01, -95.5));
  assert.notEqual(faunaCellWindowKey(39.5, -95.01), faunaCellWindowKey(39.5, -94.99));
});

test("fauna cell window key wraps longitude deterministically", () => {
  assert.equal(faunaCellWindowKey(0, 180), faunaCellWindowKey(0, -180));
  assert.equal(faunaCellWindowKey(0, 540), faunaCellWindowKey(0, -180));
});
