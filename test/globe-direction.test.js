import test from "node:test";
import assert from "node:assert/strict";
import { globeDirectionFromGeographic } from "../src/render/GeoSelection.js";

const close = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test("geographic directions invert the sphere UV mapping", () => {
  const equatorPrime = globeDirectionFromGeographic(0, 0, 0);
  close(equatorPrime.x, 1);
  close(equatorPrime.y, 0);
  close(equatorPrime.z, 0);

  const northPole = globeDirectionFromGeographic(90, 45, 0);
  close(northPole.x, 0, 1e-8);
  close(northPole.y, 1, 1e-8);
  close(northPole.z, 0, 1e-8);

  const east = globeDirectionFromGeographic(0, 90, 0);
  close(east.x, 0, 1e-8);
  close(east.y, 0, 1e-8);
  close(east.z, -1, 1e-8);
});

test("globe direction follows the rendered Earth's Y rotation", () => {
  const direction = globeDirectionFromGeographic(0, 0, -0.35);
  close(direction.x, Math.cos(0.35), 1e-9);
  close(direction.z, Math.sin(0.35), 1e-9);
});
