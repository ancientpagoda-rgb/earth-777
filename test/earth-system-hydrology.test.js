import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Biome4SoilLayer } from "../src/data/biome4-soil.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { dynamicSurfaceElevationMeters } from "../src/sim/GeneralAtmosphereCirculation.js";
import { DYNAMIC_GEOMORPHOLOGY_POLICY } from "../src/sim/DynamicGeomorphology.js";
import { DYNAMIC_SOIL_POLICY } from "../src/sim/DynamicSoilEvolution.js";
import { GROUNDWATER_POLICY, CLOSED_BASIN_LAKE_POLICY } from "../src/sim/GroundwaterLakes.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import {
  EarthSystemHydrology,
  SURFACE_GEOMORPHOLOGY_PATCH_POLICY
} from "../src/sim/EarthSystemHydrology.js";

const compressed = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
const climate = new Krapp777ClimateLayer(gunzipSync(compressed));
const soilCompressed = readFileSync(new URL("../public/data/biome4-soil.bin.gz", import.meta.url));
const soil = new Biome4SoilLayer(gunzipSync(soilCompressed));

function hydrology() {
  return new EarthSystemHydrology(new SpatialHydroClimate(climate), soil);
}

test("runtime hydrology cache signature includes orbital and tectonic atmosphere drivers", () => {
  const model = hydrology();
  const checkpoint = checkpointState();
  const first = {
    ...checkpoint,
    elapsedYears: 10_000,
    oceanTemperatureAnomaly: checkpoint.temperatureAnomaly,
    tectonicTimeMyr: 0.01,
    tectonicBoundaryActivity: 1,
    productivityIndex: 1
  };
  const second = { ...first, precession: first.precession + 40 };
  assert.notEqual(model._stateSignature(first, 0.65), model._stateSignature(second, 0.65));
});

test("runtime conserved water balance uses evolving surface elevation", () => {
  const model = hydrology();
  const checkpoint = checkpointState();
  const state = {
    ...checkpoint,
    elapsedYears: 250_000,
    yearBP: checkpoint.yearBP - 250_000,
    oceanTemperatureAnomaly: checkpoint.temperatureAnomaly,
    tectonicTimeMyr: 0.25,
    tectonicBoundaryActivity: 1.25,
    productivityIndex: 1
  };
  const sample = model.sample(state, 35, 75, 0.65);
  assert.ok(sample);
  const expected = dynamicSurfaceElevationMeters(state, sample.latitude, sample.longitude);
  assert.ok(Math.abs(sample.elevationMeters - expected) < 0.11);
});

test("checkpoint network keeps dynamic BIOME4 soil hydraulics neutral", () => {
  const model = hydrology();
  const state = checkpointState();
  const network = model.network(state, 0.1);
  const soilEvolution = network.geomorphology.soilEvolution;
  assert.equal(soilEvolution.policy, DYNAMIC_SOIL_POLICY);
  assert.ok(soilEvolution.evolvedSoilCellCount > 0);
  assert.equal(soilEvolution.fixedPasses, 2);
  for (const index of network.topology.routingOrder) {
    if (!soilEvolution.appliedMask[index]) continue;
    assert.ok(Math.abs(soilEvolution.capacityMultiplier[index] - 1) < 1e-6);
  }
  assert.ok(soilEvolution.maxWaterBalanceResidualMm < 1e-5);
});

test("runtime river network closes soil-evolved groundwater, lakes, routed water and sediment on one final topology", () => {
  const model = hydrology();
  const checkpoint = checkpointState();
  const state = {
    ...checkpoint,
    elapsedYears: 180_000,
    yearBP: checkpoint.yearBP - 180_000,
    oceanTemperatureAnomaly: checkpoint.temperatureAnomaly + 0.35,
    tectonicTimeMyr: 0.18,
    tectonicBoundaryActivity: 1.2,
    productivityIndex: 0.9
  };
  const network = model.network(state, 0.1);
  assert.ok(network.geomorphology);
  assert.equal(network.geomorphology.policy, DYNAMIC_GEOMORPHOLOGY_POLICY);
  assert.equal(network.geomorphology.soilEvolution.policy, DYNAMIC_SOIL_POLICY);
  assert.equal(network.geomorphology.soilEvolution.fixedPasses, 2);
  assert.ok(network.geomorphology.soilEvolution.evolvedSoilCellCount > 100);
  assert.ok(network.geomorphology.soilEvolution.evolvedSoilFraction > 0);
  assert.ok(network.geomorphology.soilEvolution.maxCapacityMultiplierChange > 0.001);
  assert.ok(Number.isFinite(network.geomorphology.soilEvolution.meanFertilityIndex));
  assert.ok(network.geomorphology.soilEvolution.maxWaterBalanceResidualMm < 1e-5);
  assert.equal(network.geomorphology.groundwater.policy, GROUNDWATER_POLICY);
  assert.equal(network.geomorphology.lakes.policy, CLOSED_BASIN_LAKE_POLICY);
  assert.equal(network.accumulation.massConserved, true);
  assert.equal(network.geomorphology.sedimentMassConserved, true);
  assert.equal(network.geomorphology.groundwater.massConserved, true);
  assert.equal(network.geomorphology.waterSystemMassConserved, true);
  assert.ok(Math.abs(network.accumulation.relativeClosureError) < 1e-12);
  assert.ok(Math.abs(network.geomorphology.sedimentRelativeClosureError) < 1e-10);
  assert.ok(Math.abs(network.geomorphology.groundwater.relativeClosureError) < 1e-10);
  assert.ok(Math.abs(network.geomorphology.waterSystemRelativeClosureError) <= 2e-6);
  assert.ok(network.geomorphology.generatedSedimentM3PerYear > 0);
  assert.ok(network.geomorphology.maxAbsoluteElevationChangeMeters > 0);
  assert.ok(network.geomorphology.lakes.lakeCount >= 0);
  assert.match(network.topology.elevationPolicy, /dynamic tectonic surface plus runoff-driven erosion/);

  const soilIndex = Array.from(network.topology.routingOrder).find((index) =>
    network.geomorphology.soilEvolution.appliedMask[index]
  );
  assert.ok(Number.isInteger(soilIndex));
  const soilRow = Math.floor(soilIndex / network.topology.cols);
  const soilCol = soilIndex % network.topology.cols;
  const soilLatitude = 90 - (soilRow + 0.5) * network.spacingDegrees;
  const soilLongitude = -180 + (soilCol + 0.5) * network.spacingDegrees;
  const soilSample = model.soilEvolutionSample(state, soilLatitude, soilLongitude, 0.1);
  assert.ok(soilSample);
  assert.equal(soilSample.policy, DYNAMIC_SOIL_POLICY);
  assert.equal(soilSample.evolved, true);
  assert.ok(soilSample.totalWaterCapacityMm > 0);
  assert.ok(soilSample.soilDepthMeters > 0);
  assert.ok(soilSample.fertilityIndex > 0);

  const regional = model.networkSample(state, 0, 20, 0.1);
  assert.ok(regional);
  assert.equal(regional.geomorphologyPolicy, DYNAMIC_GEOMORPHOLOGY_POLICY);
  assert.equal(regional.routeAcyclic, true);
  assert.equal(regional.networkMassConserved, true);
  assert.equal(regional.sedimentMassConserved, true);

  const waterSystem = model.groundwaterLakeSample(state, 0, 20, 0.1);
  assert.ok(waterSystem);
  assert.equal(waterSystem.groundwaterPolicy, GROUNDWATER_POLICY);
  assert.equal(waterSystem.lakePolicy, CLOSED_BASIN_LAKE_POLICY);
  assert.equal(waterSystem.groundwaterMassConserved, true);
  assert.equal(waterSystem.waterSystemMassConserved, true);
  assert.ok(Number.isFinite(waterSystem.baseflowMmPerYear));
  assert.ok(Number.isFinite(waterSystem.groundwaterResidenceTimeYears));

  const routedIndex = Array.from(network.topology.routingOrder).find((index) =>
    network.topology.downstream[index] >= 0 && network.accumulation.meanDischargeM3s[index] > 0.08
  );
  assert.ok(Number.isInteger(routedIndex));
  const row = Math.floor(routedIndex / network.topology.cols);
  const col = routedIndex % network.topology.cols;
  const latitude = 90 - (row + 0.5) * network.spacingDegrees;
  const longitude = -180 + (col + 0.5) * network.spacingDegrees;
  const patch = model.surfaceGeomorphologyPatch(state, latitude, longitude, 0.1);
  const repeated = model.surfaceGeomorphologyPatch(state, latitude, longitude, 0.1);
  assert.deepEqual(patch, repeated);
  assert.equal(patch.policy, SURFACE_GEOMORPHOLOGY_PATCH_POLICY);
  assert.equal(patch.geomorphologyPolicy, DYNAMIC_GEOMORPHOLOGY_POLICY);
  assert.equal(patch.soilPolicy, DYNAMIC_SOIL_POLICY);
  assert.equal(patch.networkCellIndex, routedIndex);
  assert.equal(patch.downstreamIndex, network.topology.downstream[routedIndex]);
  assert.ok(Number.isFinite(patch.geomorphicElevationOffsetMeters));
  assert.ok(Number.isFinite(patch.geomorphicGradientEastMetersPerKm));
  assert.ok(Number.isFinite(patch.geomorphicGradientNorthMetersPerKm));
  assert.ok(Number.isFinite(patch.channelBearingRadians));
  assert.ok(patch.channelDistanceFromSelectionKm < 1e-6);
  assert.ok(patch.channelReachLengthKm > 0);
  assert.ok(patch.meanDischargeM3s > 0.08);
});

test("browser runtime constructs real EarthSystemHydrology in the lazy regional owner", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const bootstrap = readFileSync(new URL("../src/bootstrap.js", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const regionalRuntime = readFileSync(new URL("../src/sim/RegionalScienceRuntime.js", import.meta.url), "utf8");
  assert.match(html, /src\/bootstrap\.js/);
  assert.doesNotMatch(bootstrap, /installEarthSystemHydrologyCoupling\(\)/);
  assert.match(bootstrap, /import\("\.\/main\.js"\)/);
  assert.match(main, /import\("\.\/sim\/RegionalScienceRuntime\.js"\)/);
  assert.match(regionalRuntime, /import\("\.\/EarthSystemHydrology\.js"\)/);
  assert.match(regionalRuntime, /new EarthSystemHydrology\(/);
});