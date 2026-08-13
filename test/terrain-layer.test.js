import test from "node:test";
import assert from "node:assert/strict";
import { ETOPO_2022_META, bedrockElevationAt, isLandAt } from "../src/data/generated/etopo-2022.generated.js";

test("compact ETOPO layer is finite, global, and scientifically labeled", () => {
  assert.equal(ETOPO_2022_META.rows, 360);
  assert.equal(ETOPO_2022_META.cols, 720);
  assert.equal(ETOPO_2022_META.sampleSpacingDegrees, 0.5);
  assert.match(ETOPO_2022_META.epistemicStatus, /modern bedrock baseline/);
  assert.match(ETOPO_2022_META.epistemicStatus, /not a direct reconstruction of 777 ka/);
  for (const [lat, lon] of [[0, 0], [40, -100], [-30, 140], [70, 20]]) {
    assert.ok(Number.isFinite(bedrockElevationAt(lat, lon)));
  }
});

test("paleo sea level changes shoreline classification without changing bedrock", () => {
  const latitude = 0;
  const longitude = 0;
  const elevation = bedrockElevationAt(latitude, longitude);
  assert.equal(isLandAt(latitude, longitude, elevation - 1), true);
  assert.equal(isLandAt(latitude, longitude, elevation + 1), false);
  assert.equal(bedrockElevationAt(latitude, longitude), elevation);
});
