import test from "node:test";
import assert from "node:assert/strict";
import { observedGroupViews } from "../src/render/FaunaRenderViews.js";

test("canonical observed groups take precedence over compatibility views", () => {
  const canonical = Object.freeze([
    Object.freeze({ id: "a", representation: "herd" }),
    Object.freeze({ id: "b", representation: "pack" })
  ]);
  const result = observedGroupViews({
    groups: canonical,
    herds: [Object.freeze({ id: "legacy-herd" })],
    packs: [Object.freeze({ id: "legacy-pack" })]
  });
  assert.deepEqual(result, canonical);
});

test("fallback herd and pack views are deduplicated by group identity", () => {
  const shared = Object.freeze({ id: "same-group", representation: "herd" });
  const result = observedGroupViews({
    herds: [shared, Object.freeze({ id: "herd-only", representation: "herd" })],
    packs: [shared, Object.freeze({ id: "pack-only", representation: "pack" })]
  });
  assert.deepEqual(result.map((group) => group.id), ["same-group", "herd-only", "pack-only"]);
});
