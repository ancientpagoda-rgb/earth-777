import test from "node:test";
import assert from "node:assert/strict";
import { faunaGroupBehaviorAt } from "../src/sim/FaunaRuntime.js";

function lineage(overrides = {}) {
  return {
    id: 1,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.5,
    plantMatterAffinity: 0.5,
    livePreyAffinity: 0.5,
    carrionAffinity: 0.2,
    bodyMassLog10Kg: 1,
    mobility: 0.6,
    sociality: 0.5,
    cognition: 0.6,
    dietBreadth: 0.2,
    thermalOptimumK: -1,
    ...overrides
  };
}

test("behavior label transitions do not create locomotion jumps", () => {
  const predator = lineage({ plantMatterAffinity: 0, livePreyAffinity: 1, mobility: 0.6, cognition: 0.6 });
  let previous = faunaGroupBehaviorAt({
    role: "carnivore",
    id: "continuous-label-boundary",
    elapsedYears: 12.5,
    field: { preyPressure: 0 },
    lineage: predator
  });
  let transition = null;

  for (let index = 1; index <= 1000; index += 1) {
    const current = faunaGroupBehaviorAt({
      role: "carnivore",
      id: "continuous-label-boundary",
      elapsedYears: 12.5,
      field: { preyPressure: index / 1000 },
      lineage: predator
    });
    if (current.behavior !== previous.behavior) {
      transition = { previous, current };
      break;
    }
    previous = current;
  }

  assert.ok(transition, "expected a diagnostic behavior boundary across the prey-pressure sweep");
  assert.ok(Math.abs(transition.current.locomotionDrive - transition.previous.locomotionDrive) < 0.01);
  assert.ok(Math.abs(transition.current.distanceKm - transition.previous.distanceKm) < 0.002);
});

test("resource and threat state continuously increase herbivore locomotion", () => {
  const herbivore = lineage({ plantMatterAffinity: 1, livePreyAffinity: 0, mobility: 0.7, sociality: 0.4, cognition: 0.5, dietBreadth: 0.3 });
  const comfortable = faunaGroupBehaviorAt({
    role: "herbivore",
    id: "same-herd",
    elapsedYears: 8.25,
    field: { predatorPressure: 0.01, predationExposure: 0, productivity: 1, waterAccess: 1 },
    lineage: herbivore
  });
  const stressed = faunaGroupBehaviorAt({
    role: "herbivore",
    id: "same-herd",
    elapsedYears: 8.25,
    field: { predatorPressure: 1, predationExposure: 1, productivity: 0.1, waterAccess: 0.1 },
    lineage: herbivore
  });

  assert.ok(stressed.resourceNeed > comfortable.resourceNeed);
  assert.ok(stressed.waterNeed > comfortable.waterNeed);
  assert.ok(stressed.threatIndex > comfortable.threatIndex);
  assert.ok(stressed.locomotionDrive > comfortable.locomotionDrive);
  assert.ok(stressed.distanceKm > comfortable.distanceKm);
});

test("legacy no-lineage fallback retains the existing categorical movement budget", () => {
  const result = faunaGroupBehaviorAt({
    role: "carnivore",
    id: "legacy-pack",
    elapsedYears: 12.5,
    field: { preyPressure: 1 },
    lineage: null
  });
  const expected = result.behavior === "hunt" || result.behavior === "travel" ? 0.11
    : result.behavior === "stalk" ? 0.06
      : 0.025;

  assert.equal(result.distanceKm, expected);
  assert.equal(result.locomotionDrive, null);
});
