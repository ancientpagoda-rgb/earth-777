import test from "node:test";
import assert from "node:assert/strict";
import { faunaGroupRenderShape } from "../src/render/FaunaRenderViews.js";

test("explicit predation affinity, not herd/pack labels, controls group silhouette", () => {
  const herbivoreLabel = faunaGroupRenderShape({ role: "herbivore", representation: "herd", predationAffinity: 0.35 });
  const carnivoreLabel = faunaGroupRenderShape({ role: "carnivore", representation: "pack", predationAffinity: 0.35 });
  assert.deepEqual(herbivoreLabel, carnivoreLabel);
});

test("group silhouette interpolates continuously across feeding ecology", () => {
  const plant = faunaGroupRenderShape({ predationAffinity: 0 });
  const omnivore = faunaGroupRenderShape({ predationAffinity: 0.5 });
  const livePrey = faunaGroupRenderShape({ predationAffinity: 1 });

  assert.equal(plant.longitudinalScale, 2.3);
  assert.equal(livePrey.longitudinalScale, 1.6);
  assert.ok(omnivore.longitudinalScale < plant.longitudinalScale);
  assert.ok(omnivore.longitudinalScale > livePrey.longitudinalScale);
  assert.ok(omnivore.verticalScale < plant.verticalScale);
  assert.ok(omnivore.verticalScale > livePrey.verticalScale);
});

test("legacy groups retain their historical visual endpoints as fallback only", () => {
  assert.equal(faunaGroupRenderShape({ representation: "herd" }).predationAffinity, 0);
  assert.equal(faunaGroupRenderShape({ representation: "pack" }).predationAffinity, 1);
});
