import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { checkpointState } from "../src/data/checkpoint-777.js";
import { Krapp777ClimateLayer } from "../src/data/krapp-777-climate.js";
import { dynamicSurfaceElevationMeters } from "../src/sim/GeneralAtmosphereCirculation.js";
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

test("browser entrypoint installs Earth-system hydrology coupling before main", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const bootstrap = readFileSync(new URL("../src/bootstrap.js", import.meta.url), "utf8");
  assert.match(html, /src\/bootstrap\.js/);
  assert.match(bootstrap, /installEarthSystemHydrologyCoupling\(\)/);
  assert.match(bootstrap, /import\("\.\/main\.js"\)/);
});
