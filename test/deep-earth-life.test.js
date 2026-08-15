import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  advanceLithosphere,
  initializeLithosphere,
  tectonicElevationOffsetMeters,
  tectonicSampleAt
} from "../src/sim/DynamicLithosphere.js";
import {
  advanceOceanCirculation,
  initializeOceanCirculation,
  spatialOceanState
} from "../src/sim/SpatialOceanCirculation.js";
import { deriveCompetitiveBiomeSuccession } from "../src/sim/BiomeSuccession.js";
import { FreeEarthEngine } from "../src/sim/free-earth.js";

test("tectonic topography begins at the reference baseline and diverges causally with branch time", () => {
  const state = initializeLithosphere({ elapsedYears: 0, geologicActivityIndex: 1 }, 777001);
  const checkpointOffset = tectonicElevationOffsetMeters(state, 34, 36, 777001);
  assert.ok(Math.abs(checkpointOffset) < 1e-12);

  state.elapsedYears = 500_000;
  advanceLithosphere(state, 25);
  const sample = tectonicSampleAt(state, 34, 36, 777001);
  const offset = tectonicElevationOffsetMeters(state, 34, 36, 777001);
  assert.ok(Number.isInteger(sample.plateId));
  assert.ok(Number.isInteger(sample.neighboringPlateId));
  assert.ok(Number.isFinite(sample.upliftRateMmPerYear));
  assert.ok(Number.isFinite(offset));
  assert.notEqual(offset, checkpointOffset);
  assert.ok(["plate interior", "convergent", "divergent", "transform / diffuse"].includes(sample.boundaryType));
});

test("overturning moves carbon between surface and deep ocean without creating carbon", () => {
  const state = initializeOceanCirculation({
    oceanTemperatureAnomaly: 1.8,
    temperatureAnomaly: 1.8,
    iceIndex: 0.08,
    seaLevel: 8,
    co2: 420,
    oceanSurfaceCarbonPgC: 1_080,
    oceanDeepCarbonPgC: 36_920
  });
  const before = state.oceanSurfaceCarbonPgC + state.oceanDeepCarbonPgC;
  advanceOceanCirculation(state, 250);
  const after = state.oceanSurfaceCarbonPgC + state.oceanDeepCarbonPgC;
  assert.ok(Math.abs(after - before) < 1e-9);
  assert.ok(Number.isFinite(state.oceanOverturningIndex));
  assert.ok(Number.isFinite(state.oceanCirculationCarbonFluxPgCPerYear));
  assert.notEqual(state.oceanSurfaceCarbonPgC, 1_080);
});

test("spatial ocean chemistry and currents are finite branch outputs", () => {
  const state = initializeOceanCirculation({
    oceanTemperatureAnomaly: 0.4,
    temperatureAnomaly: 0.5,
    iceIndex: 0.14,
    seaLevel: -4,
    co2: 330,
    oceanSurfaceCarbonPgC: 950,
    oceanDeepCarbonPgC: 37_050
  });
  advanceOceanCirculation(state, 500);
  const ocean = spatialOceanState(state, 28, -38, -3_500);
  assert.equal(ocean.isOcean, true);
  for (const key of ["temperatureCelsius", "salinityPsu", "dissolvedInorganicCarbonUmolKg", "alkalinityUmolKg", "pH", "oxygenUmolKg", "carbonateSaturationIndex", "currentSpeedMps"]) {
    assert.ok(Number.isFinite(ocean[key]), `${key} should be finite`);
  }
  assert.ok(ocean.pH > 0);
  assert.ok(ocean.salinityPsu > 0);
});

test("competitive PFT selection can mature into a branch biome instead of remaining the checkpoint category", () => {
  const succession = deriveCompetitiveBiomeSuccession({
    elapsedYears: 20_000,
    checkpointBiomeLabel: "checkpoint woodland",
    competition: {
      policy: "test-competition",
      selectedPftId: 9,
      dominantWoodyLai: 0.8
    },
    climateIndices: { warmestMonthCelsius: 26 },
    annualPrecipitationMm: 780,
    transitionPressure: 0.8
  });
  assert.equal(succession.status, "resolved");
  assert.ok(succession.progress > 0.95);
  assert.equal(succession.biomeLabel, "warm savanna / grassland");
});

test("Free Earth exposes evolving species, hominin cognition, culture and technology", () => {
  const checkpoint = new FreeEarthEngine(424242).snapshot();
  const state = new FreeEarthEngine(424242).advance(25_000);
  assert.ok(Array.isArray(state.speciesLineages));
  assert.ok(Array.isArray(state.homininLineages));
  assert.ok(state.speciesLineages.length >= 1);
  assert.ok(state.homininLineages.length >= 1);
  assert.ok(Number.isInteger(state.speciesRichness));
  assert.ok(Number.isInteger(state.homininSpeciesRichness));
  for (const key of ["cognitionIndex", "cultureIndex", "technologyIndex", "communicationIndex", "evolutionaryNoveltyIndex"]) {
    assert.ok(Number.isFinite(state[key]), `${key} should be finite`);
  }
  assert.ok(state.tectonicTimeMyr > checkpoint.tectonicTimeMyr);
  assert.notEqual(state.oceanOverturningIndex, checkpoint.oceanOverturningIndex);
});

test("timeline includes the requested ten-thousand-times speed and terrain uses shader contours", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const terrain = readFileSync(new URL("../src/render/TerrainChunkManager.js", import.meta.url), "utf8");
  assert.match(html, /(?:data-speed|value)="10000"[^>]*>10K×<\/(?:button|option)>/);
  assert.match(terrain, /uContourIntervalMeters/);
  assert.match(terrain, /elevationMeters/);
  assert.match(terrain, /tectonicElevationOffsetMeters/);
});
