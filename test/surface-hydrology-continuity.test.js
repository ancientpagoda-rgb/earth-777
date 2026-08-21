import test from "node:test";
import assert from "node:assert/strict";
import { majorChannelPresenceAt, modelLakePresenceAt } from "../src/render/SurfaceHydrologyContinuity.js";

const channelContext = {
  chunkSizeKm: 84,
  branchSeed: 777001,
  geomorphologyPatch: {
    channelBearingRadians: 0,
    channelClosestXKm: 0,
    channelClosestZKm: 0,
    meanDischargeM3s: 1800
  }
};

test("major routed channel is defined by world coordinates rather than chunk identity", () => {
  const onChannel = majorChannelPresenceAt(channelContext, 41.999, 0);
  const acrossBoundary = majorChannelPresenceAt(channelContext, 42.001, 0);
  const offChannel = majorChannelPresenceAt(channelContext, 42.001, 8);
  assert.ok(onChannel > 0.1);
  assert.ok(Math.abs(onChannel - acrossBoundary) < 0.01);
  assert.ok(offChannel < acrossBoundary * 0.02);
});

test("modeled lake footprint stays continuous across a terrain boundary", () => {
  const context = {
    chunkSizeKm: 8,
    radius: 2,
    branchSeed: 777001,
    waterSystem: {
      lakeSurfaceElevationMeters: 105,
      lakeCoverageFraction: 0.24,
      lakeAreaKm2: 420,
      channelClosestXKm: 4,
      channelClosestZKm: 0
    }
  };
  const west = modelLakePresenceAt(context, 3.999, 0, 100);
  const east = modelLakePresenceAt(context, 4.001, 0, 100);
  const far = modelLakePresenceAt(context, 30, 0, 100);
  assert.ok(west > 0.4);
  assert.ok(Math.abs(west - east) < 0.01);
  assert.ok(far < 0.05);
});
