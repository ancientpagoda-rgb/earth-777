import test from "node:test";
import assert from "node:assert/strict";
import { AdaptivePerformanceController } from "../src/render/AdaptivePerformanceController.js";

test("adaptive performance controller reduces visual LOD under sustained frame pressure", () => {
  const controller = new AdaptivePerformanceController({ targetFps: 60, initialTier: "ultra" });
  let changed = false;
  for (let i = 0; i < 24; i += 1) {
    changed = controller.sample(34, 100 + i * 120) || changed;
  }
  assert.equal(changed, true);
  assert.equal(controller.diagnostics().visualLod, "high");
});

test("adaptive performance controller settings combine visual and scientific detail", () => {
  const controller = new AdaptivePerformanceController({ initialTier: "balanced" });
  const lowScience = controller.settings(0.35);
  const highScience = controller.settings(1);
  assert.equal(lowScience.visualLod, "balanced");
  assert.ok(highScience.effectiveTerrainSegments >= lowScience.effectiveTerrainSegments);
  assert.ok(highScience.effectiveTerrainRadius >= lowScience.effectiveTerrainRadius);
});
