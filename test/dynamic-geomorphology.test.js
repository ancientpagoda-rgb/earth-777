import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DYNAMIC_GEOMORPHOLOGY_POLICY, evolveRunoffNetworkTopography } from "../src/sim/DynamicGeomorphology.js";
import { buildRunoffNetworkTopology, traceRunoffNetwork } from "../src/sim/RunoffRouting.js";

function syntheticElevation(latitude, longitude) {
  if (Math.abs(latitude) > 72) return -1200;
  return 600
    + 180 * Math.cos(latitude * 1.7 * Math.PI / 180)
    + 90 * Math.sin(longitude * 2 * Math.PI / 180)
    + 35 * Math.sin((longitude + latitude) * 5 * Math.PI / 180);
}

function syntheticTopology() {
  return buildRunoffNetworkTopology({
    spacingDegrees: 4,
    seaLevelMeters: 0,
    elevationAt: syntheticElevation,
    elevationPolicy: "synthetic landscape regression"
  });
}

function runoffFor(topology) {
  const runoff = new Float32Array(topology.count);
  for (const index of topology.routingOrder) {
    const row = Math.floor(index / topology.cols);
    const col = index % topology.cols;
    const latitude = 90 - (row + 0.5) * topology.spacingDegrees;
    const longitude = -180 + (col + 0.5) * topology.spacingDegrees;
    runoff[index] = 300
      + 500 * (0.5 + 0.5 * Math.sin(longitude * 3 * Math.PI / 180))
      * (0.3 + 0.7 * Math.cos(latitude * Math.PI / 180) ** 2);
  }
  return runoff;
}

function assertStrictlyDescending(topology) {
  for (const index of topology.routingOrder) {
    const downstream = topology.downstream[index];
    if (downstream >= 0) {
      assert.ok(topology.elevationMeters[downstream] < topology.elevationMeters[index] - 0.009);
    } else {
      assert.ok(downstream === -1 || downstream === -2);
    }
  }
}

test("geomorphology is elevation-neutral at elapsed year zero while sediment routing still closes", () => {
  const topology = syntheticTopology();
  const runoff = runoffFor(topology);
  const result = evolveRunoffNetworkTopography({ elapsedYears: 0, productivityIndex: 1, tectonicBoundaryActivity: 1 }, topology, runoff);
  assert.equal(result.policy, DYNAMIC_GEOMORPHOLOGY_POLICY);
  assert.equal(result.maxAbsoluteElevationChangeMeters, 0);
  assert.equal(result.reroutedCellCount, 0);
  assert.equal(result.shorelineChangedCellCount, 0);
  assert.equal(result.sedimentMassConserved, true);
  assert.ok(Math.abs(result.sedimentRelativeClosureError) < 1e-10);
  assert.deepEqual([...result.topology.downstream], [...topology.downstream]);
});

test("runoff-driven erosion transports sediment conservatively and can move drainage divides", () => {
  const topology = syntheticTopology();
  const runoff = runoffFor(topology);
  const state = { elapsedYears: 300_000, productivityIndex: 0.8, tectonicBoundaryActivity: 1.2 };
  const first = evolveRunoffNetworkTopography(state, topology, runoff);
  const second = evolveRunoffNetworkTopography(state, topology, runoff);
  assert.equal(first.sedimentMassConserved, true);
  assert.ok(Math.abs(first.sedimentRelativeClosureError) < 1e-10);
  assert.ok(first.generatedSedimentM3PerYear > 0);
  assert.ok(first.depositedSedimentM3PerYear > 0);
  assert.ok(first.activeErosionCells > 0);
  assert.ok(first.activeDepositionCells > 0);
  assert.ok(first.maxAbsoluteElevationChangeMeters > 0.1);
  assert.ok(first.reroutedCellCount > 0, "evolving relief should migrate at least one drainage link in the synthetic landscape");
  assert.deepEqual([...first.topology.downstream], [...second.topology.downstream]);
  assert.deepEqual([...first.evolvedElevationMeters], [...second.evolvedElevationMeters]);
  assertStrictlyDescending(first.topology);
});

test("traced routes remain acyclic after geomorphic drainage reorganization", () => {
  const topology = syntheticTopology();
  const result = evolveRunoffNetworkTopography(
    { elapsedYears: 450_000, productivityIndex: 0.65, tectonicBoundaryActivity: 1.4 },
    topology,
    runoffFor(topology)
  );
  const start = result.topology.routingOrder[Math.floor(result.topology.routingOrder.length / 2)];
  const route = traceRunoffNetwork(result.topology, start);
  assert.equal(route.acyclic, true);
  assert.ok(route.routeCellsToOutlet >= 1);
});

test("geomorphology implementation contains no named geographic outcome rules", () => {
  const source = readFileSync(new URL("../src/sim/DynamicGeomorphology.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Africa|Sahara|India|Amazon|Australia|Greenland|Nile|Mississippi/i);
  assert.match(source, /preliminary topology provides a non-recursive first pass/);
});
