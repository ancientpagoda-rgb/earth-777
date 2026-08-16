import test from "node:test";
import assert from "node:assert/strict";
import { CHECKPOINT_777 } from "../src/data/checkpoint-777.js";
import { ORBITAL_ANCHOR, paleoForcingAt } from "../src/data/paleo-forcing.js";
import {
  BIOGEOCHEMISTRY_BASELINE,
  initializeBiogeochemistry,
  advanceBiogeochemistry,
  syncAtmosphereFromReservoirs,
  trackedCarbonPgC,
  trackedNitrogenTgN
} from "../src/sim/EarthBiogeochemistry.js";
import { EARTH_SYSTEM_STATUS, auditTrajectory } from "../src/sim/EarthSystemIntegrity.js";
import { FreeEarthEngine, stageForYearBP } from "../src/sim/free-earth.js";
import { regionalState } from "../src/sim/regional-state.js";

test("checkpoint carries the published MIS 19 boundary conditions", () => {
  assert.equal(CHECKPOINT_777.yearsBeforePresent, 777_000);
  assert.equal(CHECKPOINT_777.boundary.co2.value, 245);
  assert.equal(CHECKPOINT_777.boundary.methane.value, 631);
  assert.equal(CHECKPOINT_777.boundary.obliquity.value, 23.3);
  assert.equal(CHECKPOINT_777.boundary.eccentricity.value, 0.023);
  assert.equal(CHECKPOINT_777.boundary.seaLevelAnomaly.value, -12.76);
});

test("published forcing layers meet the canonical checkpoint", () => {
  const forcing = paleoForcingAt(777_000);
  assert.ok(Math.abs(forcing.eccentricity - 0.023) < 1e-9);
  assert.ok(Math.abs(forcing.obliquity - 23.3) < 1e-9);
  assert.ok(Math.abs(forcing.precession - 108.9) < 1e-9);
  assert.equal(forcing.seaLevel, -12.76);
  assert.equal(forcing.seaLevelSigma, 9.52);
  assert.ok(Math.abs(ORBITAL_ANCHOR.eccentricityOffset) < 0.01);
});

test("forcing interpolation is continuous inside a one-kyr interval", () => {
  const older = paleoForcingAt(777_000);
  const middle = paleoForcingAt(776_500);
  const younger = paleoForcingAt(776_000);
  assert.ok(middle.eccentricity > Math.min(older.eccentricity, younger.eccentricity));
  assert.ok(middle.eccentricity < Math.max(older.eccentricity, younger.eccentricity));
  assert.equal(middle.seaLevel, (older.seaLevel + younger.seaLevel) / 2);
  const present = paleoForcingAt(0);
  assert.equal(present.anchorWeight, 0);
  assert.ok(Math.abs(present.eccentricity - 0.016702362) < 1e-9);
});

test("Free Earth branches are deterministic by seed", () => {
  const first = new FreeEarthEngine(777001);
  const second = new FreeEarthEngine(777001);
  assert.deepEqual(first.advance(12_000), second.advance(12_000));
});

test("different branches diverge while concentrations remain physical rather than artificially capped", () => {
  const first = new FreeEarthEngine(777001).advance(25_000);
  const second = new FreeEarthEngine(777002).advance(25_000);
  assert.notEqual(first.co2, second.co2);
  for (const state of [first, second]) {
    assert.ok(Number.isFinite(state.temperatureAnomaly));
    assert.ok(state.co2 > 0);
    assert.ok(state.methane > 0);
    assert.ok(state.nitrousOxide > 0);
    assert.ok(state.iceIndex >= 0 && state.iceIndex <= 1);
    assert.ok(state.yearBP >= 0 && state.yearBP <= 777_000);
  }
});

test("aggregate ecology converts predator and prey lineage traits into bounded prey loss", () => {
  const configure = (predatorTraits, preyTraits) => {
    const engine = new FreeEarthEngine(991);
    engine.state.herbivoreBiomass = 4;
    engine.state.carnivoreBiomass = 2;
    engine.state.speciesLineages = [
      { id: 1, extinctionYearBP: null, populationIndex: 1, trophicLevel: 0.2, mobility: 0.5, sociality: 0.5, cognition: 0.5, ...preyTraits },
      { id: 2, extinctionYearBP: null, populationIndex: 1, trophicLevel: 0.8, mobility: 0.5, sociality: 0.5, cognition: 0.5, ...predatorTraits }
    ];
    return engine.advance(25);
  };
  const effectivePredators = configure({ mobility: 1, cognition: 1 }, { mobility: 0, sociality: 0, cognition: 0 });
  const defendedPrey = configure({ mobility: 0, cognition: 0 }, { mobility: 1, sociality: 1, cognition: 1 });

  assert.ok(effectivePredators.predationPressureIndex > defendedPrey.predationPressureIndex);
  assert.ok(effectivePredators.predationHerbivoreLossPerYear > defendedPrey.predationHerbivoreLossPerYear);
  assert.ok(effectivePredators.herbivoreBiomass < defendedPrey.herbivoreBiomass);
  for (const state of [effectivePredators, defendedPrey]) {
    assert.ok(state.herbivoreBiomass > 0);
    assert.ok(state.carnivoreBiomass > 0);
    assert.ok(state.predationHerbivoreLossPerYear > 0);
  }
});

test("aggregate predation prefers compatible predator and prey body masses", () => {
  const configure = (predatorMass, preyMass) => {
    const engine = new FreeEarthEngine(992);
    engine.state.herbivoreBiomass = 4;
    engine.state.carnivoreBiomass = 2;
    engine.state.speciesLineages = [
      { id: 1, extinctionYearBP: null, populationIndex: 1, trophicLevel: 0.2, bodyMassLog10Kg: preyMass, mobility: 0.5, sociality: 0.5, cognition: 0.5 },
      { id: 2, extinctionYearBP: null, populationIndex: 1, trophicLevel: 0.8, bodyMassLog10Kg: predatorMass, mobility: 0.5, sociality: 0.5, cognition: 0.5 }
    ];
    return engine.advance(25);
  };
  const compatible = configure(0.85, 1.3);
  const mismatched = configure(-0.3, 3.3);

  assert.ok(compatible.predationMassCompatibilityIndex > mismatched.predationMassCompatibilityIndex);
  assert.ok(compatible.predationPressureIndex > mismatched.predationPressureIndex);
  assert.ok(compatible.predationHerbivoreLossPerYear > mismatched.predationHerbivoreLossPerYear);
  assert.ok(compatible.herbivoreBiomass < mismatched.herbivoreBiomass);
});

test("CO2 can exceed the old 330 ppm guardrail and is then reduced only by modeled fluxes", () => {
  const engine = new FreeEarthEngine(77);
  engine.state.atmosphericCarbonPgC = 800 * BIOGEOCHEMISTRY_BASELINE.atmosphericCarbonPgCPerPpm;
  syncAtmosphereFromReservoirs(engine.state);
  assert.equal(Math.round(engine.state.co2), 800);
  const evolved = engine.advance(25);
  assert.ok(evolved.co2 > 330);
});

test("carbon and nitrogen reservoirs conserve tracked elemental mass", () => {
  const state = initializeBiogeochemistry({
    co2: 245, methane: 631, nitrousOxide: 270, temperatureAnomaly: -1.27,
    oceanTemperatureAnomaly: -1.27, iceIndex: 0.18, productivityIndex: 1, geologicActivityIndex: 1
  });
  const carbonBefore = trackedCarbonPgC(state);
  const nitrogenBefore = trackedNitrogenTgN(state);
  for (let step = 0; step < 200; step += 1) advanceBiogeochemistry(state, 25, { perturbation: Math.sin(step) * 0.2 });
  assert.ok(Math.abs(trackedCarbonPgC(state) - carbonBefore) < 1e-4);
  assert.ok(Math.abs(trackedNitrogenTgN(state) - nitrogenBefore) < 1e-3);
  assert.notEqual(Number(state.methane.toFixed(6)), 631);
  assert.notEqual(Number(state.nitrousOxide.toFixed(6)), 270);
});

test("simulated sea level is free to diverge from the reconstruction reference", () => {
  const state = new FreeEarthEngine(1234).advance(40_000);
  assert.ok(Number.isFinite(state.seaLevelReference));
  assert.ok(Number.isFinite(state.seaLevel));
  assert.notEqual(state.seaLevel, state.seaLevelReference);
});

test("geological stage advances instead of remaining frozen at the checkpoint label", () => {
  assert.equal(stageForYearBP(777_000), "Late MIS 19c");
  assert.equal(stageForYearBP(100_000), "Late Pleistocene");
  assert.equal(stageForYearBP(7_000), "Holocene");
  assert.equal(new FreeEarthEngine(88).seek(770_000).stage, "Holocene");
});

test("seeking backward reconstructs the same deterministic state", () => {
  const engine = new FreeEarthEngine(77);
  engine.seek(10_000);
  engine.seek(2_000);
  const reconstructed = engine.snapshot();
  const expected = new FreeEarthEngine(77).seek(2_000);
  assert.deepEqual(reconstructed, expected);
});

test("regional materialization is finite and classified", () => {
  const state = new FreeEarthEngine().snapshot();
  const region = regionalState(state, 52, 13);
  assert.ok(Number.isFinite(region.annualTemperature));
  assert.ok(region.biome.length > 3);
});

test("integrity audit catches accidentally frozen internal state and declares evolving terrain", () => {
  const engine = new FreeEarthEngine(991);
  const states = [engine.snapshot(), engine.advance(2_500), engine.advance(7_500), engine.advance(20_000)];
  const audit = auditTrajectory(states);
  assert.deepEqual(audit.nonFinite, []);
  assert.ok(!audit.unexpectedlyUnchanged.includes("co2"));
  assert.ok(!audit.unexpectedlyUnchanged.includes("methane"));
  assert.ok(!audit.unexpectedlyUnchanged.includes("nitrousOxide"));
  assert.ok(!audit.unexpectedlyUnchanged.includes("tectonicTimeMyr"));
  assert.ok(!audit.declaredFixedSystems.includes("terrain"));
  assert.equal(EARTH_SYSTEM_STATUS.terrain.status, "dynamic-partial");
  assert.equal(EARTH_SYSTEM_STATUS.tectonics.status, "dynamic-partial");
  assert.equal(EARTH_SYSTEM_STATUS.culture.status, "dynamic-partial");
});
