import test from "node:test";
import assert from "node:assert/strict";
import { faunaIndividualRenderShape } from "../src/render/FaunaRenderViews.js";

test("parent group affinity, not individual role label, controls explicit silhouette", () => {
  const parent = { predationAffinity: 0.4 };
  const herbivoreLabel = faunaIndividualRenderShape({ role: "herbivore" }, parent);
  const carnivoreLabel = faunaIndividualRenderShape({ role: "carnivore" }, parent);
  assert.deepEqual(herbivoreLabel, carnivoreLabel);
});

test("individual silhouette interpolates continuously with predation affinity", () => {
  const plant = faunaIndividualRenderShape({}, { predationAffinity: 0 });
  const omnivore = faunaIndividualRenderShape({}, { predationAffinity: 0.5 });
  const livePrey = faunaIndividualRenderShape({}, { predationAffinity: 1 });

  assert.equal(plant.longitudinalScale, 1.8);
  assert.equal(livePrey.longitudinalScale, 1.55);
  assert.ok(omnivore.longitudinalScale < plant.longitudinalScale);
  assert.ok(omnivore.longitudinalScale > livePrey.longitudinalScale);
  assert.equal(plant.verticalScale, 1);
  assert.equal(livePrey.lateralScale, 0.8);
});

test("legacy role labels remain fallback only when no affinity exists", () => {
  assert.equal(faunaIndividualRenderShape({ role: "herbivore" }).predationAffinity, 0);
  assert.equal(faunaIndividualRenderShape({ role: "carnivore" }).predationAffinity, 1);
});
