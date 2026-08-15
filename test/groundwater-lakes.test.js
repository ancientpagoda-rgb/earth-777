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
  const elevation = Float32Array.from([
    -20, 130, -20,
    120, 100, 110,
    -20, 125, -20
  ]);
  const landMask = Uint8Array.from([
    0, 1, 0,
    1, 1, 1,
    0, 1, 0
  ]);
  const downstream = Int32Array.from([
    -3, 4, -3,
    4, -2, 4,
    -3, 4, -3
  ]);
  return Object.freeze({
    count: 9,
    rows: 3,
    cols: 3,
    spacingDegrees: 4,
    seaLevelMeters: 0,
    elevationPolicy: "synthetic closed basin",
    epistemicStatus: "synthetic closed basin",
    elevationMeters: elevation,
    landMask,
    downstream,
    cellAreaKm2: Float64Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1]),
    routingOrder: Int32Array.from([1, 7, 3, 5, 4]),
    landCellCount: 5,
    landAreaKm2: 5,
    oceanOutletCells: 0,
    closedBasinSinkCells: 1
  });
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
  const runoff = Float32Array.from([0, 5000, 0, 5000, 5000, 5000, 0, 5000, 0]);
  const originalVolume = 25_000_000;
  const lakes = resolveClosedBasinLakes({}, topology, runoff, {
    precipitationMmPerYear: Float32Array.from([0, 500, 0, 500, 500, 500, 0, 500, 0]),
    potentialEvapotranspirationMmPerYear: Float32Array.from([0, 800, 0, 800, 800, 800, 0, 800, 0])
  });
  assert.equal(lakes.policy, CLOSED_BASIN_LAKE_POLICY);
  assert.equal(lakes.lakeCount, 1);
  assert.equal(lakes.spillingLakeCount, 1);
  assert.equal(lakes.topology.downstream[4], -1);
  assert.ok(lakes.lakes[0].overflowM3PerYear > 0);
  assert.ok(lakes.lakes[0].lakeSurfaceElevationMeters >= 109.9);
  assert.ok(lakes.lakeEvaporationM3PerYear > 0);
  assert.ok(Math.abs(originalVolume - lakes.lakeEvaporationM3PerYear - lakes.adjustedLocalRunoffM3PerYear) < 2);
  assert.equal(lakes.topology.routingOrder.length, topology.landCellCount);
});

test("an arid underfilled basin remains closed and stores its routed water", () => {
  const topology = closedBasinTopology();
  const runoff = Float32Array.from([0, 8, 0, 8, 8, 8, 0, 8, 0]);
  const lakes = resolveClosedBasinLakes({}, topology, runoff, {
    precipitationMmPerYear: Float32Array.from([0, 100, 0, 100, 100, 100, 0, 100, 0]),
    potentialEvapotranspirationMmPerYear: Float32Array.from([0, 1400, 0, 1400, 1400, 1400, 0, 1400, 0])
  });
  assert.equal(lakes.spillingLakeCount, 0);
  assert.equal(lakes.closedLakeCount, 1);
  assert.equal(lakes.topology.downstream[4], -2);
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
