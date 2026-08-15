import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveGroundwaterBaseflow,
  resolveClosedBasinLakes,
  GROUNDWATER_POLICY,
  CLOSED_BASIN_LAKE_POLICY
} from "../src/sim/GroundwaterLakes.js";

function tinyRiverTopology() {
  return Object.freeze({
    count: 2,
    rows: 1,
    cols: 2,
    spacingDegrees: 4,
    seaLevelMeters: 0,
    elevationPolicy: "synthetic",
    epistemicStatus: "synthetic test topology",
    elevationMeters: Float32Array.from([100, 50]),
    landMask: Uint8Array.from([1, 1]),
    downstream: Int32Array.from([1, -1]),
    cellAreaKm2: Float64Array.from([1, 1]),
    routingOrder: Int32Array.from([0, 1]),
    landCellCount: 2,
    landAreaKm2: 2,
    oceanOutletCells: 1,
    closedBasinSinkCells: 0
  });
}

function closedBasinTopology() {
  // The sink is surrounded by a complete one-cell land ring. This matters:
  // D8 permits diagonal neighbors, so a 3x3 test accidentally placed the
  // center sink directly beside ocean corners and created a 100 m spill saddle.
  const elevation = Float32Array.from([
    -20, -20, -20, -20, -20,
    -20, 130, 125, 120, -20,
    -20, 118, 100, 110, -20,
    -20, 122, 124, 126, -20,
    -20, -20, -20, -20, -20
  ]);
  const landMask = Uint8Array.from([
    0, 0, 0, 0, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 0, 0, 0, 0
  ]);
  const downstream = Int32Array.from([
    -3, -3, -3, -3, -3,
    -3, 12, 12, 12, -3,
    -3, 12, -2, 12, -3,
    -3, 12, 12, 12, -3,
    -3, -3, -3, -3, -3
  ]);
  return Object.freeze({
    count: 25,
    rows: 5,
    cols: 5,
    spacingDegrees: 4,
    seaLevelMeters: 0,
    elevationPolicy: "synthetic closed basin",
    epistemicStatus: "synthetic closed basin",
    elevationMeters: elevation,
    landMask,
    downstream,
    cellAreaKm2: Float64Array.from({ length: 25 }, () => 1),
    routingOrder: Int32Array.from([6, 18, 7, 17, 16, 8, 11, 13, 12]),
    landCellCount: 9,
    landAreaKm2: 9,
    oceanOutletCells: 0,
    closedBasinSinkCells: 1
  });
}

function landField(topology, value) {
  return Float32Array.from({ length: topology.count }, (_, index) => topology.landMask[index] ? value : 0);
}

test("checkpoint groundwater starts in recharge/baseflow equilibrium with exact closure", () => {
  const topology = tinyRiverTopology();
  const groundwater = resolveGroundwaterBaseflow({ elapsedYears: 0 }, topology, {
    totalRunoffMmPerYear: Float32Array.from([30, 30]),
    surfaceRunoffMmPerYear: Float32Array.from([10, 10]),
    deepDrainageMmPerYear: Float32Array.from([20, 20]),
    precipitationScale: Float32Array.from([1, 1]),
    soilWaterCapacityMm: Float32Array.from([200, 200])
  });
  assert.equal(groundwater.policy, GROUNDWATER_POLICY);
  assert.deepEqual([...groundwater.baseflowMmPerYear], [20, 20]);
  assert.deepEqual([...groundwater.groundwaterStorageChangeMmPerYear], [0, 0]);
  assert.deepEqual([...groundwater.effectiveRunoffMmPerYear], [30, 30]);
  assert.equal(groundwater.massConserved, true);
  assert.ok(Math.abs(groundwater.relativeClosureError) < 1e-12);
});

test("branch recharge departures can store water or release aquifer storage before baseflow equilibrates", () => {
  const topology = tinyRiverTopology();
  const wet = resolveGroundwaterBaseflow({ elapsedYears: 1000 }, topology, {
    totalRunoffMmPerYear: Float32Array.from([30, 30]),
    surfaceRunoffMmPerYear: Float32Array.from([10, 10]),
    deepDrainageMmPerYear: Float32Array.from([20, 20]),
    precipitationScale: Float32Array.from([2, 2]),
    soilWaterCapacityMm: Float32Array.from([350, 350])
  });
  const dry = resolveGroundwaterBaseflow({ elapsedYears: 1000 }, topology, {
    totalRunoffMmPerYear: Float32Array.from([30, 30]),
    surfaceRunoffMmPerYear: Float32Array.from([10, 10]),
    deepDrainageMmPerYear: Float32Array.from([20, 20]),
    precipitationScale: Float32Array.from([0.5, 0.5]),
    soilWaterCapacityMm: Float32Array.from([350, 350])
  });
  assert.ok(wet.groundwaterStorageChangeMmPerYear[0] > 0);
  assert.ok(dry.groundwaterStorageChangeMmPerYear[0] < 0);
  assert.equal(wet.massConserved, true);
  assert.equal(dry.massConserved, true);
});

test("a water-rich closed basin fills to its spill saddle and exports only the post-evaporation remainder", () => {
  const topology = closedBasinTopology();
  const runoff = landField(topology, 5000);
  const originalVolume = 45_000_000;
  const lakes = resolveClosedBasinLakes({}, topology, runoff, {
    precipitationMmPerYear: landField(topology, 500),
    potentialEvapotranspirationMmPerYear: landField(topology, 800)
  });
  assert.equal(lakes.policy, CLOSED_BASIN_LAKE_POLICY);
  assert.equal(lakes.lakeCount, 1);
  assert.equal(lakes.spillingLakeCount, 1);
  assert.equal(lakes.topology.downstream[12], -1);
  assert.ok(lakes.lakes[0].overflowM3PerYear > 0);
  assert.ok(lakes.lakes[0].spillElevationMeters >= 109.9);
  assert.ok(lakes.lakes[0].lakeSurfaceElevationMeters >= 109.9);
  assert.ok(lakes.lakeEvaporationM3PerYear > 0);
  assert.ok(Math.abs(originalVolume - lakes.lakeEvaporationM3PerYear - lakes.adjustedLocalRunoffM3PerYear) < 5);
  assert.equal(lakes.topology.routingOrder.length, topology.landCellCount);
});

test("an arid underfilled basin remains closed and stores its routed water", () => {
  const topology = closedBasinTopology();
  const runoff = landField(topology, 8);
  const lakes = resolveClosedBasinLakes({}, topology, runoff, {
    precipitationMmPerYear: landField(topology, 100),
    potentialEvapotranspirationMmPerYear: landField(topology, 1400)
  });
  assert.equal(lakes.spillingLakeCount, 0);
  assert.equal(lakes.closedLakeCount, 1);
  assert.equal(lakes.topology.downstream[12], -2);
  assert.ok(lakes.lakes[0].fillFraction < 1);
  assert.deepEqual([...lakes.adjustedRunoffMmPerYear], [...runoff]);
});

test("groundwater/lake equations contain no named geographic outcome rules and surface view uses science providers", () => {
  const modelSource = readFileSync(new URL("../src/sim/GroundwaterLakes.js", import.meta.url), "utf8");
  const surfaceSource = readFileSync(new URL("../src/render/SurfaceTerrainSystem.js", import.meta.url), "utf8");
  const viewSource = readFileSync(new URL("../src/render/earth-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(modelSource, /Sahara|Amazon|Nile|Caspian|Great Lakes|Africa|Asia|America/i);
  assert.match(modelSource, /spill saddle/i);
  assert.match(surfaceSource, /science-coupled/);
  assert.match(surfaceSource, /groundwaterLakeSample/);
  assert.match(viewSource, /setScienceProviders/);
  assert.match(viewSource, /lakeSurfaceElevationMeters/);
});