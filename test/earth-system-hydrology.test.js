import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { dynamicSurfaceElevationMeters } from "../src/sim/GeneralAtmosphereCirculation.js";
import { DYNAMIC_GEOMORPHOLOGY_POLICY } from "../src/sim/DynamicGeomorphology.js";
import { GROUNDWATER_POLICY, CLOSED_BASIN_LAKE_POLICY } from "../src/sim/GroundwaterLakes.js";
import { MassConservingHydrology } from "../src/sim/MassConservingHydrology.js";
import { SpatialHydroClimate } from "../src/sim/SpatialHydroClimate.js";
import { installEarthSystemHydrologyCoupling } from "../src/sim/EarthSystemHydrology.js";

const compressed = readFileSync(new URL("../public/data/krapp-777-climate.bin.gz", import.meta.url));
const climate = new Krapp777ClimateLayer(gunzipSync(compressed));

installEarthSystemHydrologyCoupling();

test("runtime hydrology cache signature includes orbital and tectonic atmosphere drivers", () => {
  const hydrology = new MassConservingHydrology(new SpatialHydroClimate(climate));
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
  assert.notEqual(hydrology._stateSignature(first, 0.65), hydrology._stateSignature(second, 0.65));
});

test("runtime conserved water balance uses evolving surface elevation", () => {
  const hydrology = new MassConservingHydrology(new SpatialHydroClimate(climate));
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
  const sample = hydrology.sample(state, 35, 75, 0.65);
  assert.ok(sample);
  const expected = dynamicSurfaceElevationMeters(state, sample.latitude, sample.longitude);
  assert.ok(Math.abs(sample.elevationMeters - expected) < 0.11);
});

test("runtime river network closes groundwater, lakes, routed water and sediment on one evolved topology", () => {
  const hydrology = new MassConservingHydrology(new SpatialHydroClimate(climate));
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
  const network = hydrology.network(state, 0.1);
  assert.ok(network.geomorphology);
  assert.equal(network.geomorphology.policy, DYNAMIC_GEOMORPHOLOGY_POLICY);
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
  const regional = hydrology.networkSample(state, 0, 20, 0.1);
  assert.ok(regional);
  assert.equal(regional.geomorphologyPolicy, DYNAMIC_GEOMORPHOLOGY_POLICY);
  assert.equal(regional.routeAcyclic, true);
  assert.equal(regional.networkMassConserved, true);
  assert.equal(regional.sedimentMassConserved, true);
  const waterSystem = hydrology.groundwaterLakeSample(state, 0, 20, 0.1);
  assert.ok(waterSystem);
  assert.equal(waterSystem.groundwaterPolicy, GROUNDWATER_POLICY);
  assert.equal(waterSystem.lakePolicy, CLOSED_BASIN_LAKE_POLICY);
  assert.equal(waterSystem.groundwaterMassConserved, true);
  assert.equal(waterSystem.waterSystemMassConserved, true);
  assert.ok(Number.isFinite(waterSystem.baseflowMmPerYear));
  assert.ok(Number.isFinite(waterSystem.groundwaterResidenceTimeYears));
});

test("browser entrypoint installs Earth-system hydrology coupling before main", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const bootstrap = readFileSync(new URL("../src/bootstrap.js", import.meta.url), "utf8");
  assert.match(html, /src\/bootstrap\.js/);
  assert.match(bootstrap, /installEarthSystemHydrologyCoupling\(\)/);
  assert.match(bootstrap, /import\("\.\/main\.js"\)/);
});