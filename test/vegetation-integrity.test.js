import test from "node:test";
import assert from "node:assert/strict";
import { checkpointState } from "../src/data/checkpoint-777.js";
import { BIOGEOCHEMISTRY_BASELINE } from "../src/sim/EarthBiogeochemistry.js";
import { SpatialVegetation } from "../src/sim/SpatialVegetation.js";

function createSpatialVegetation() {
  const checkpoint = {
    meta: { id: "test-checkpoint", spacingDegrees: 0.5 },
    annualAt: () => ({ biomeCode: 10, biomeLabel: "test woodland", npp: 100, lai: 2, source: "test" }),
    monthlyNppAt: () => 8
  };
  const hydrology = {
    sample: (_state, latitude, longitude) => ({
      latitude,
      longitude,
      gridSpacingDegrees: 0.5,
      actualEvapotranspirationMmPerYear: 700,
      soilMoistureIndex: 0.6
    })
  };
  return new SpatialVegetation(checkpoint, hydrology);
}

test("vegetation CO2 response has no old 600 ppm or 2.5x hard ceiling", () => {
  const spatial = createSpatialVegetation();
  const base = checkpointState();
  const common = {
    ...base,
    elapsedYears: 10_000,
    terrestrialReactiveNitrogenTgN: BIOGEOCHEMISTRY_BASELINE.nitrogen.terrestrialReactiveTgN
  };
  const at600 = spatial.sample({ ...common, co2: 600 }, 10, 20, 0.5);
  const at6000 = spatial.sample({ ...common, co2: 6_000 }, 10, 20, 0.5);
  assert.ok(at6000.productivityFactor > at600.productivityFactor);
  assert.ok(at6000.lai > at600.lai);
  assert.ok(Number.isFinite(at6000.productivityFactor));
});

test("reactive nitrogen reservoir now influences vegetation productivity", () => {
  const spatial = createSpatialVegetation();
  const base = checkpointState();
  const common = { ...base, elapsedYears: 10_000, co2: 350 };
  const lowN = spatial.sample({
    ...common,
    terrestrialReactiveNitrogenTgN: BIOGEOCHEMISTRY_BASELINE.nitrogen.terrestrialReactiveTgN * 0.5
  }, 10, 20, 0.5);
  const highN = spatial.sample({
    ...common,
    terrestrialReactiveNitrogenTgN: BIOGEOCHEMISTRY_BASELINE.nitrogen.terrestrialReactiveTgN * 2
  }, 10, 20, 0.5);
  assert.ok(highN.productivityFactor > lowN.productivityFactor);
});
