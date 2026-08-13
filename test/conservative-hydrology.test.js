import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import {
  CONSERVATIVE_HYDROLOGY_POLICY,
  ConservativeHydrology,
  buildDrainageTopology,
  extraterrestrialRadiationMjM2Day,
  oudinPotentialEvapotranspirationMmMonth,
  routeRunoffVolumes,
  routingSpacingForSpatialDetail,
  stepWaterBucket
} from "../src/sim/ConservativeHydrology.js";

const compressed = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
const climate = new Krapp777ClimateLayer(gunzipSync(compressed));
const hydroClimate = new SpatialHydroClimate(climate);

test("routing fidelity is capped at browser-safe 2 degree drainage cells", () => {
  assert.equal(routingSpacingForSpatialDetail(0), 4);
  assert.equal(routingSpacingForSpatialDetail(0.57), 4);
  assert.equal(routingSpacingForSpatialDetail(0.58), 2);
  assert.equal(routingSpacingForSpatialDetail(1), 2);
});

test("Oudin PET forcing is positive in warm sunlit conditions and zero below -5 C", () => {
  const radiation = extraterrestrialRadiationMjM2Day(0, 2, 23.3);
  assert.ok(radiation > 30 && radiation < 45);
  assert.ok(oudinPotentialEvapotranspirationMmMonth(25, 0, 2, 23.3) > 100);
  assert.equal(oudinPotentialEvapotranspirationMmMonth(-5, 0, 2, 23.3), 0);
});

test("monthly soil and snow bucket closes water exactly", () => {
  const step = stepWaterBucket({
    precipitationMm: 140,
    temperatureCelsius: 6,
    potentialEtMm: 52,
    soilStorageMm: 120,
    snowStorageMm: 18
  });
  assert.ok(step.actualEtMm >= 0);
  assert.ok(step.runoffMm >= 0);
  assert.ok(step.soilStorageMm >= 0 && step.soilStorageMm <= 180);
  assert.ok(step.snowStorageMm >= 0);
  assert.ok(Math.abs(step.closureErrorMm) < 1e-10);
});

test("runoff routing conserves all source volume to an outlet", () => {
  const topology = {
    count: 3,
    routingOrder: Int32Array.from([0, 1, 2]),
    downstream: Int32Array.from([1, 2, -1])
  };
  const routed = routeRunoffVolumes(Float64Array.from([10, 20, 30]), topology);
  assert.equal(routed.localTotalM3, 60);
  assert.equal(routed.oceanVolumeM3, 60);
  assert.equal(routed.endorheicVolumeM3, 0);
  assert.equal(routed.routingClosureErrorM3, 0);
  assert.deepEqual([...routed.accumulatedVolumeM3], [10, 30, 60]);
});

test("ETOPO drainage links only flow downhill or terminate", () => {
  const topology = buildDrainageTopology(4, checkpointState().seaLevel);
  assert.ok(topology.landCellCount > 0);
  assert.ok(topology.oceanOutletCells > 0);
  for (const index of topology.routingOrder) {
    const downstream = topology.downstream[index];
    if (downstream >= 0) {
      assert.ok(
        topology.elevation[downstream] < topology.elevation[index],
        `cell ${index} routed uphill from ${topology.elevation[index]} to ${topology.elevation[downstream]}`
      );
    } else {
      assert.ok(downstream === -1 || downstream === -2);
    }
  }
});

test("real 777 ka conservative hydrology closes global and routing budgets", () => {
  const state = checkpointState();
  const hydrology = new ConservativeHydrology(hydroClimate);
  const snapshot = hydrology.compute(state, 0.35);
  assert.equal(snapshot.policy, CONSERVATIVE_HYDROLOGY_POLICY);
  assert.equal(snapshot.spacingDegrees, 4);
  assert.ok(snapshot.activeLandCells > 1000);
  assert.ok(snapshot.budget.precipitationM3 > 0);
  assert.ok(snapshot.budget.actualEtM3 >= 0);
  assert.ok(snapshot.budget.oceanDischargeM3 >= 0);
  assert.ok(snapshot.budget.endorheicRetentionM3 >= 0);
  assert.ok(Math.abs(snapshot.budget.relativeClosureError) < 1e-10);
  assert.ok(Math.abs(snapshot.budget.relativeRoutingClosureError) < 1e-10);

  const sample = hydrology.sample(state, 0, 20, 0.35);
  assert.ok(sample);
  assert.ok(Number.isFinite(sample.actualEtMm));
  assert.ok(Number.isFinite(sample.localRunoffMm));
  assert.ok(Number.isFinite(sample.meanDischargeM3s));
  assert.equal(sample.routingSpacingDegrees, 4);
  assert.match(sample.epistemicStatus, /model derived water balance/);
});
