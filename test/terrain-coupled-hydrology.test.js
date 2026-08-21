import test from "node:test";
import assert from "node:assert/strict";
import { solveTerrainCoupledHydrology } from "../src/render/TerrainCoupledHydrology.js";

function flatPositions(side) {
  const positions = new Float32Array(side * side * 3);
  let index = 0;
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      positions[index * 3] = col;
      positions[index * 3 + 1] = 0;
      positions[index * 3 + 2] = row;
      index += 1;
    }
  }
  return positions;
}

test("terrain-coupled runoff accumulates down a reconstructed valley", () => {
  const side = 5;
  const elevations = Float32Array.from([
    12, 11, 10, 11, 12,
    10,  8,  7,  8, 10,
     9,  6,  5,  6,  9,
     8,  5,  3,  5,  8,
     7,  4,  1,  4,  7
  ]);
  const hydro = solveTerrainCoupledHydrology({
    elevations,
    positions: flatPositions(side),
    vertexSide: side,
    seaLevelMeters: -100,
    runoffMmPerYear: 900,
    routedDischargeM3s: 1200
  });
  assert.equal(hydro.policy, "displayed-terrain-d8-basin-wetland-v1");
  assert.ok(hydro.maxAccumulation > 4);
  assert.ok(Math.max(...hydro.streamStrength) > 0.3);
  assert.ok(hydro.streamSegments.length > 0);
});

test("closed terrain depression fills as a lake only when water balance supports it", () => {
  const side = 5;
  const elevations = Float32Array.from([
    9, 9, 9, 9, 9,
    9, 5, 4, 5, 9,
    9, 4, 1, 4, 9,
    9, 5, 4, 5, 9,
    9, 9, 9, 9, 9
  ]);
  const dry = solveTerrainCoupledHydrology({ elevations, vertexSide: side, seaLevelMeters: -100, runoffMmPerYear: 20 });
  const wet = solveTerrainCoupledHydrology({
    elevations,
    vertexSide: side,
    seaLevelMeters: -100,
    runoffMmPerYear: 700,
    lakeCoverageFraction: 0.12,
    lakeSurfaceElevationMeters: 4.5
  });
  assert.equal(dry.lakeStrength[12], 0);
  assert.ok(wet.sinkCount >= 1);
  assert.ok(wet.lakeStrength[12] > 0.5);
  assert.ok(Number.isFinite(wet.lakeSurfaceByCell[12]));
});

test("edge-draining terrain is not mistaken for a closed lake basin", () => {
  const side = 3;
  const elevations = Float32Array.from([
    5, 4, 3,
    4, 3, 2,
    3, 2, 1
  ]);
  const hydro = solveTerrainCoupledHydrology({
    elevations,
    vertexSide: side,
    seaLevelMeters: -100,
    lakeCoverageFraction: 0.5,
    lakeSurfaceElevationMeters: 4
  });
  assert.equal(Math.max(...hydro.lakeStrength), 0);
});
