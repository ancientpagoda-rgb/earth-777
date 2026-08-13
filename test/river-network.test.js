import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { MassConservingHydrology } from "../src/sim/MassConservingHydrology.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import {
  accumulateRunoffNetwork,
  buildRunoffNetworkTopology,
  networkSpacingForSpatialDetail,
  RIVER_NETWORK_POLICY
} from "../src/sim/RunoffRouting.js";

const compressed = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
const climate = new Krapp777ClimateLayer(gunzipSync(compressed));

function hydrology() {
  return new MassConservingHydrology(new SpatialHydroClimate(climate));
}

test("CWF river-network detail is bounded to browser-safe 4 and 2 degree grids", () => {
  assert.equal(networkSpacingForSpatialDetail(0), 4);
  assert.equal(networkSpacingForSpatialDetail(0.81), 4);
  assert.equal(networkSpacingForSpatialDetail(0.82), 2);
  assert.equal(networkSpacingForSpatialDetail(1), 2);
});

test("synthetic upstream accumulation conserves volume and drainage area", () => {
  const topology = {
    policy: RIVER_NETWORK_POLICY,
    count: 3,
    routingOrder: Int32Array.from([0, 1, 2]),
    downstream: Int32Array.from([1, 2, -1]),
    cellAreaKm2: Float64Array.from([1, 1, 1])
  };
  const accumulated = accumulateRunoffNetwork(topology, Float32Array.from([10, 20, 30]));
  assert.deepEqual([...accumulated.localAnnualVolumeM3], [10_000, 20_000, 30_000]);
  assert.deepEqual([...accumulated.accumulatedAnnualVolumeM3], [10_000, 30_000, 60_000]);
  assert.deepEqual([...accumulated.upstreamAreaKm2], [1, 2, 3]);
  assert.deepEqual([...accumulated.upstreamCellCount], [1, 2, 3]);
  assert.equal(accumulated.localRunoffTotalM3, 60_000);
  assert.equal(accumulated.oceanDischargeM3, 60_000);
  assert.equal(accumulated.closedBasinRetentionM3, 0);
  assert.equal(accumulated.closureErrorM3, 0);
  assert.equal(accumulated.massConserved, true);
});

test("ETOPO network topology is acyclic because every land link descends", () => {
  const topology = buildRunoffNetworkTopology({
    spacingDegrees: 4,
    seaLevelMeters: checkpointState().seaLevel
  });
  assert.ok(topology.landCellCount > 1000);
  assert.ok(topology.oceanOutletCells > 0);
  assert.ok(topology.closedBasinSinkCells > 0);
  for (const index of topology.routingOrder) {
    const downstream = topology.downstream[index];
    if (downstream >= 0) {
      assert.equal(topology.landMask[downstream], 1);
      assert.ok(
        topology.elevationMeters[downstream] < topology.elevationMeters[index] - 0.009,
        `network link ${index} -> ${downstream} does not descend`
      );
    } else {
      assert.ok(downstream === -1 || downstream === -2);
    }
  }
});

test("real 777 ka network accumulates closed local runoff and conserves it globally", () => {
  const state = checkpointState();
  const model = hydrology();
  const network = model.network(state, 0.35);
  assert.equal(network.policy, RIVER_NETWORK_POLICY);
  assert.equal(network.spacingDegrees, 4);
  assert.ok(network.activeRunoffCells > 1000);
  assert.ok(network.accumulation.localRunoffTotalM3 > 0);
  assert.ok(network.accumulation.oceanDischargeM3 >= 0);
  assert.ok(network.accumulation.closedBasinRetentionM3 >= 0);
  assert.equal(network.accumulation.massConserved, true);
  assert.ok(Math.abs(network.accumulation.relativeClosureError) < 1e-12);
  assert.ok(
    Math.abs(
      network.accumulation.localRunoffTotalM3 -
      network.accumulation.oceanDischargeM3 -
      network.accumulation.closedBasinRetentionM3
    ) < Math.max(1, network.accumulation.localRunoffTotalM3 * 1e-12)
  );
});

test("regional river sample reports accumulated discharge rather than only local runoff", () => {
  const state = checkpointState();
  const model = hydrology();
  const river = model.networkSample(state, 0, 20, 0.35);
  assert.ok(river);
  assert.equal(river.policy, RIVER_NETWORK_POLICY);
  assert.equal(river.spacingDegrees, 4);
  assert.ok(river.upstreamAreaKm2 > 0);
  assert.ok(river.upstreamCellCount >= 1);
  assert.ok(river.accumulatedAnnualVolumeM3 >= river.localAnnualVolumeM3);
  assert.ok(river.meanDischargeM3s >= 0);
  assert.equal(river.networkMassConserved, true);
  assert.ok(Math.abs(river.networkRelativeClosureError) < 1e-12);
});

test("network forcing is deterministic within a quantized CWF state bin", () => {
  const state = checkpointState();
  const model = hydrology();
  const first = model.network({ ...state, temperatureAnomaly: -1.231, seaLevel: -12.2 }, 0.35);
  const second = model.network({ ...state, temperatureAnomaly: -1.249, seaLevel: -12.7 }, 0.35);
  assert.strictEqual(first, second);
  assert.equal(first.signature, second.signature);
});
