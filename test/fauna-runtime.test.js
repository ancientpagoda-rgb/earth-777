import test from "node:test";
import assert from "node:assert/strict";
import {
  approximateCellAreaKm2,
  buildObservedFauna,
  faunaForCells,
  faunaGroupBehaviorAt,
  faunaPopulationAt
} from "../src/sim/FaunaRuntime.js";

const state = Object.freeze({ seed: 777001, elapsedYears: 12.5, herbivoreBiomass: 1.1, carnivoreBiomass: 0.7, productivityIndex: 1.0, temperatureAnomaly: -1.0 });
const vegetation = Object.freeze({ biomeCode: 17, npp: 950, lai: 2.8 });
const hydrology = Object.freeze({ surfaceRunoffMmPerYear: 430 });

function cell(scope, key, south, north, west, east) {
  return Object.freeze({ scope, key, latitude: (south + north) * 0.5, longitude: (west + east) * 0.5, bounds: Object.freeze({ south, north, west, east }) });
}

function lineage(overrides = {}) {
  return {
    id: 101,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.2,
    bodyMassLog10Kg: 1,
    mobility: 0.5,
    sociality: 0.5,
    cognition: 0.5,
    dietBreadth: 0.5,
    thermalOptimumK: -1.0,
    ...overrides
  };
}

test("cell area shrinks toward the poles", () => {
  const equatorial = approximateCellAreaKm2(cell("local", "eq", -0.5, 0.5, 0, 1));
  const polar = approximateCellAreaKm2(cell("local", "polar", 79.5, 80.5, 0, 1));
  assert.ok(equatorial > polar * 4);
});

test("far fauna stays aggregate and scales with area", () => {
  const small = faunaPopulationAt({ state, vegetationSample: vegetation, hydrologySample: hydrology, areaKm2: 10 });
  const large = faunaPopulationAt({ state, vegetationSample: vegetation, hydrologySample: hydrology, areaKm2: 1000 });
  assert.ok(large.herbivorePopulation > small.herbivorePopulation * 90);
  assert.equal("individuals" in large, false);
  assert.equal("herds" in large, false);
});

test("regional and local cells use the same compact summary function", () => {
  const cells = [cell("regional", "r", 30, 40, -100, -90), cell("local", "l", 38, 39, -96, -95)];
  const summaries = faunaForCells(cells, { state, vegetationSample: vegetation, hydrologySample: hydrology });
  assert.equal(summaries.length, 2);
  assert.ok(summaries.every((summary) => Number.isFinite(summary.estimatedHerds)));
  assert.ok(summaries.every((summary) => Number.isFinite(summary.estimatedPacks)));
});

test("cell fauna summaries read their own environmental context", () => {
  const cells = [cell("regional", "wet", 30, 40, -100, -90), cell("regional", "dry", 30, 40, -90, -80)];
  const summaries = faunaForCells(cells, {
    state,
    environmentForCell: (entry) => entry.key === "wet"
      ? { state, vegetationSample: { biomeCode: 17, npp: 1600 }, hydrologySample: { surfaceRunoffMmPerYear: 700 } }
      : { state, vegetationSample: { biomeCode: 28, npp: 30 }, hydrologySample: { surfaceRunoffMmPerYear: 5 } }
  });

  assert.ok(summaries[0].herbivoreDensityAnimalsPerKm2 > summaries[1].herbivoreDensityAnimalsPerKm2);
});

test("demand-driven fauna fields and observed detail cannot write aggregate ecology", () => {
  const authoritativeState = {
    ...state,
    predationExposureIndex: 1.4,
    speciesLineages: [
      lineage({ id: 301, trophicLevel: 0.2 }),
      lineage({ id: 302, trophicLevel: 0.8, mobility: 0.8, cognition: 0.8 })
    ]
  };
  const before = structuredClone(authoritativeState);
  const cells = [cell("regional", "wet", 30, 40, -100, -90), cell("local", "dry", 38, 39, -96, -95)];
  const fields = faunaForCells(cells, {
    state: authoritativeState,
    environmentForCell: (entry) => entry.key === "wet"
      ? { state: authoritativeState, vegetationSample: { biomeCode: 17, npp: 1600 }, hydrologySample: { surfaceRunoffMmPerYear: 700 } }
      : { state: authoritativeState, vegetationSample: { biomeCode: 28, npp: 30 }, hydrologySample: { surfaceRunoffMmPerYear: 5 } }
  });
  const nearby = faunaPopulationAt({
    state: authoritativeState,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    areaKm2: Math.PI * 3 ** 2,
    key: "observed-window"
  });
  const plan = buildObservedFauna({
    state: authoritativeState,
    faunaField: nearby,
    latitude: 39,
    longitude: -95,
    seed: 777001,
    windowRadiusKm: 3,
    individualRadiusKm: 3
  });

  assert.equal(fields.length, 2);
  assert.equal(plan.field, nearby);
  assert.deepEqual(authoritativeState, before);
});

test("group behavior is deterministic and moves with simulated time", () => {
  const field = faunaPopulationAt({ state, vegetationSample: vegetation, hydrologySample: hydrology, areaKm2: 10 });
  const a = faunaGroupBehaviorAt({ role: "herbivore", id: "herd-a", elapsedYears: 4, field });
  const b = faunaGroupBehaviorAt({ role: "herbivore", id: "herd-a", elapsedYears: 4, field });
  const later = faunaGroupBehaviorAt({ role: "herbivore", id: "herd-a", elapsedYears: 4.5, field });
  assert.deepEqual(a, b);
  assert.notEqual(a.heading, later.heading);
  assert.ok(["graze", "drink", "travel", "flee", "rest"].includes(a.behavior));
});

test("lineage mobility changes movement distance without changing behavior category", () => {
  const field = faunaPopulationAt({ state, vegetationSample: vegetation, hydrologySample: hydrology, areaKm2: 10 });
  const slow = faunaGroupBehaviorAt({ role: "herbivore", id: "trait-herd", elapsedYears: 4, field, lineage: lineage({ mobility: 0 }) });
  const fast = faunaGroupBehaviorAt({ role: "herbivore", id: "trait-herd", elapsedYears: 4, field, lineage: lineage({ mobility: 1 }) });

  assert.equal(slow.behavior, fast.behavior);
  assert.ok(fast.distanceKm > slow.distanceKm * 1.9);
});

test("broad diets buffer scarcity-driven travel", () => {
  const scarceField = { productivity: 0.4, waterAccess: 0.4, predatorPressure: 0, preyPressure: 0.4 };
  const narrow = faunaGroupBehaviorAt({ role: "herbivore", id: "scarcity-herd", elapsedYears: 4, field: scarceField, lineage: lineage({ dietBreadth: 0 }) });
  const broad = faunaGroupBehaviorAt({ role: "herbivore", id: "scarcity-herd", elapsedYears: 4, field: scarceField, lineage: lineage({ dietBreadth: 1 }) });

  assert.equal(narrow.behavior, "travel");
  assert.notEqual(broad.behavior, "travel");
});

test("cognition modestly changes directional wandering", () => {
  const field = faunaPopulationAt({ state, vegetationSample: vegetation, hydrologySample: hydrology, areaKm2: 10 });
  const low = faunaGroupBehaviorAt({ role: "herbivore", id: "cognitive-herd", elapsedYears: 4.125, field, lineage: lineage({ cognition: 0 }) });
  const high = faunaGroupBehaviorAt({ role: "herbivore", id: "cognitive-herd", elapsedYears: 4.125, field, lineage: lineage({ cognition: 1 }) });

  assert.notEqual(low.heading, high.heading);
});

test("aggregate predation exposure raises derived herd threat without letting observation write it", () => {
  const lowHistory = faunaPopulationAt({
    state: { ...state, carnivoreBiomass: 0.1, predationExposureIndex: 0 },
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    areaKm2: 10
  });
  const highHistory = faunaPopulationAt({
    state: { ...state, carnivoreBiomass: 0.1, predationExposureIndex: 3 },
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    areaKm2: 10
  });
  const low = faunaGroupBehaviorAt({ role: "herbivore", id: "history-herd", elapsedYears: 4, field: lowHistory, lineage: lineage() });
  const high = faunaGroupBehaviorAt({ role: "herbivore", id: "history-herd", elapsedYears: 4, field: highHistory, lineage: lineage() });

  assert.equal(lowHistory.predatorPressure, highHistory.predatorPressure);
  assert.ok(high.threatIndex > low.threatIndex);
  assert.equal(highHistory.aggregatePredationExposure, 3);
});

test("local prey support refines aggregate predation exposure without introducing a local history writer", () => {
  const options = {
    state: { ...state, predationExposureIndex: 3 },
    hydrologySample: hydrology,
    areaKm2: 10
  };
  const supported = faunaPopulationAt({ ...options, vegetationSample: { biomeCode: 17, npp: 1_600 } });
  const unsupported = faunaPopulationAt({ ...options, vegetationSample: { biomeCode: 28, npp: 30 } });

  assert.equal(supported.aggregatePredationExposure, unsupported.aggregatePredationExposure);
  assert.ok(supported.preyPressure > unsupported.preyPressure);
  assert.ok(supported.predationExposure > unsupported.predationExposure);
});

test("observed fauna is deterministic for seed, place, and time", () => {
  const options = { state, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 777001, windowRadiusKm: 3, individualRadiusKm: 0.6 };
  const first = buildObservedFauna(options);
  const second = buildObservedFauna(options);
  assert.deepEqual(first.herds, second.herds);
  assert.deepEqual(first.packs, second.packs);
  assert.deepEqual(first.individuals, second.individuals);
});

test("observed fauna materializes from a supplied aggregate field", () => {
  const radiusKm = 3;
  const faunaField = faunaPopulationAt({
    state,
    vegetationSample: vegetation,
    hydrologySample: hydrology,
    latitude: 39,
    longitude: -95,
    areaKm2: Math.PI * radiusKm * radiusKm,
    key: "observed-window"
  });
  const plan = buildObservedFauna({ state, vegetationSample: vegetation, hydrologySample: hydrology, faunaField, latitude: 39, longitude: -95, seed: 777001, windowRadiusKm: radiusKm, individualRadiusKm: 0.6 });

  assert.equal(plan.field, faunaField);
  assert.equal(plan.herds.reduce((sum, herd) => sum + herd.population, 0), faunaField.herbivorePopulation);
  assert.equal(plan.packs.reduce((sum, pack) => sum + pack.population, 0), faunaField.carnivorePopulation);
});

test("observed groups inherit identity from living evolutionary lineages", () => {
  const lineageState = {
    ...state,
    speciesLineages: [
      lineage({ id: 101, trophicLevel: 0.2, bodyMassLog10Kg: 2.0 }),
      lineage({ id: 202, populationIndex: 0.7, trophicLevel: 0.8, bodyMassLog10Kg: 0.7 })
    ]
  };
  const plan = buildObservedFauna({ state: lineageState, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 777001, windowRadiusKm: 3, individualRadiusKm: 3 });

  assert.ok(plan.herds.length > 0);
  assert.ok(plan.packs.length > 0);
  assert.ok(plan.herds.every((group) => group.lineageId === 101));
  assert.ok(plan.packs.every((group) => group.lineageId === 202));
  assert.ok(plan.individuals.every((animal) => animal.lineageId === (animal.role === "carnivore" ? 202 : 101)));
  assert.deepEqual(new Set(plan.lineageIds), new Set([101, 202]));
});

test("local thermal fit biases observed lineage representation without changing animal totals", () => {
  const localState = {
    ...state,
    herbivoreBiomass: 4,
    temperatureAnomaly: -1,
    speciesLineages: [
      lineage({ id: 101, thermalOptimumK: -1, sociality: 0.2 }),
      lineage({ id: 102, thermalOptimumK: 3, sociality: 0.2 })
    ]
  };
  const plan = buildObservedFauna({ state: localState, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 44, windowRadiusKm: 4, individualRadiusKm: 0.2 });
  const represented = new Map();
  for (const herd of plan.herds) represented.set(herd.lineageId, (represented.get(herd.lineageId) ?? 0) + herd.population);

  assert.ok((represented.get(101) ?? 0) > (represented.get(102) ?? 0));
  assert.equal([...represented.values()].reduce((sum, value) => sum + value, 0), plan.visiblePopulation);
  assert.ok(plan.herds.filter((herd) => herd.lineageId === 101).every((herd) => herd.localSuitability > 0.5));
});

test("flexible lineages are favored in marginal local resources", () => {
  const marginalVegetation = { ...vegetation, npp: 35 };
  const marginalHydrology = { surfaceRunoffMmPerYear: 2 };
  const localState = {
    ...state,
    herbivoreBiomass: 4,
    speciesLineages: [
      lineage({ id: 301, mobility: 0, dietBreadth: 0, sociality: 0.2 }),
      lineage({ id: 302, mobility: 1, dietBreadth: 1, sociality: 0.2 })
    ]
  };
  const plan = buildObservedFauna({ state: localState, vegetationSample: marginalVegetation, hydrologySample: marginalHydrology, latitude: 39, longitude: -95, seed: 81, windowRadiusKm: 5, individualRadiusKm: 0.2 });
  const represented = new Map();
  for (const herd of plan.herds) represented.set(herd.lineageId, (represented.get(herd.lineageId) ?? 0) + herd.population);

  assert.ok((represented.get(302) ?? 0) > (represented.get(301) ?? 0));
  assert.equal([...represented.values()].reduce((sum, value) => sum + value, 0), plan.visiblePopulation);
});

test("predation exposure favors locally defensive herbivore lineages without changing represented population", () => {
  const localState = {
    ...state,
    herbivoreBiomass: 4,
    predationExposureIndex: 3,
    speciesLineages: [
      lineage({ id: 351, mobility: 0, sociality: 0, cognition: 0, dietBreadth: 0.5 }),
      lineage({ id: 352, mobility: 1, sociality: 1, cognition: 1, dietBreadth: 0.5 })
    ]
  };
  const plan = buildObservedFauna({ state: localState, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 115, windowRadiusKm: 5, individualRadiusKm: 0.2 });
  const represented = new Map();
  for (const herd of plan.herds) represented.set(herd.lineageId, (represented.get(herd.lineageId) ?? 0) + herd.population);

  assert.ok((represented.get(352) ?? 0) > (represented.get(351) ?? 0));
  assert.equal([...represented.values()].reduce((sum, value) => sum + value, 0), plan.visiblePopulation);
});

test("social lineages form larger, fewer groups without changing represented population", () => {
  const lowSocialState = { ...state, speciesLineages: [lineage({ sociality: 0 })] };
  const highSocialState = { ...state, speciesLineages: [lineage({ sociality: 1 })] };
  const options = { vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 77, windowRadiusKm: 3, individualRadiusKm: 0.2 };
  const low = buildObservedFauna({ ...options, state: lowSocialState });
  const high = buildObservedFauna({ ...options, state: highSocialState });

  assert.equal(low.visiblePopulation, high.visiblePopulation);
  assert.ok(high.herds.length < low.herds.length);
  assert.ok(high.herds[0].groupSizeScale > low.herds[0].groupSizeScale);
  assert.equal(low.herds.reduce((sum, herd) => sum + herd.population, 0), low.visiblePopulation);
  assert.equal(high.herds.reduce((sum, herd) => sum + herd.population, 0), high.visiblePopulation);
});

test("body mass affects observed scale and spacing without changing aggregate population", () => {
  const smallState = { ...state, speciesLineages: [lineage({ bodyMassLog10Kg: -0.3 })] };
  const largeState = { ...state, speciesLineages: [lineage({ bodyMassLog10Kg: 3.0 })] };
  const options = { vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 88, windowRadiusKm: 2, individualRadiusKm: 2 };
  const small = buildObservedFauna({ ...options, state: smallState });
  const large = buildObservedFauna({ ...options, state: largeState });

  assert.equal(small.visiblePopulation, large.visiblePopulation);
  assert.ok(small.individuals.length > 0 && large.individuals.length > 0);
  assert.ok(large.individuals[0].scale > small.individuals[0].scale);
  assert.ok(large.herds[0].spacingScale > small.herds[0].spacingScale);
});

test("predator cognition expands only the local targeting perception radius", () => {
  const configure = (cognition) => ({
    ...state,
    herbivoreBiomass: 4,
    carnivoreBiomass: 2,
    speciesLineages: [
      lineage({ id: 381, trophicLevel: 0.2, bodyMassLog10Kg: 1.4 }),
      lineage({ id: 382, trophicLevel: 0.85, bodyMassLog10Kg: 0.9, mobility: 0.5, cognition, dietBreadth: 0.5 })
    ]
  });
  const options = { vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 123, windowRadiusKm: 4, individualRadiusKm: 0.2 };
  const low = buildObservedFauna({ ...options, state: configure(0) });
  const high = buildObservedFauna({ ...options, state: configure(1) });

  assert.ok(low.packs.length > 0 && high.packs.length > 0);
  assert.ok(high.packs[0].perceptionRadiusKm > low.packs[0].perceptionRadiusKm);
  assert.equal(low.visiblePopulation, high.visiblePopulation);
  assert.equal(low.visibleCarnivorePopulation, high.visibleCarnivorePopulation);
});

test("predator targeting produces bounded approach and direct herd threat response", () => {
  const predatorState = {
    ...state,
    herbivoreBiomass: 4,
    carnivoreBiomass: 2,
    speciesLineages: [
      lineage({ id: 401, trophicLevel: 0.2, bodyMassLog10Kg: 1.4, sociality: 0.4 }),
      lineage({ id: 402, trophicLevel: 0.85, bodyMassLog10Kg: 0.9, mobility: 1, cognition: 1, dietBreadth: 0, sociality: 0.6 })
    ]
  };
  const plan = buildObservedFauna({ state: predatorState, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 123, windowRadiusKm: 4, individualRadiusKm: 4 });
  const herdById = new Map(plan.herds.map((herd) => [herd.id, herd]));
  const packById = new Map(plan.packs.map((pack) => [pack.id, pack]));
  const targeted = plan.packs.filter((pack) => pack.targetGroupId != null);
  const threatened = plan.herds.filter((herd) => herd.threatGroupId != null);

  assert.ok(targeted.length > 0);
  assert.equal(plan.predatorTargetCount, targeted.length);
  assert.ok(targeted.some((pack) => pack.approachDistanceKm > 0));
  for (const pack of targeted) {
    const target = herdById.get(pack.targetGroupId);
    assert.ok(target);
    assert.equal(pack.targetLineageId, target.lineageId);
    assert.ok(Number.isFinite(pack.targetDistanceKm));
    assert.ok(Number.isFinite(pack.targetDistanceBeforeKm));
    assert.ok(pack.targetDistanceBeforeKm <= pack.perceptionRadiusKm + 1e-12);
    assert.ok(pack.approachDistanceKm >= 0);
    assert.ok(pack.approachDistanceKm <= pack.movementDistanceKm + 1e-12);
    assert.ok(pack.targetDistanceKm <= pack.targetDistanceBeforeKm + 1e-12);
    assert.ok(Math.abs((pack.targetDistanceBeforeKm - pack.approachDistanceKm) - pack.targetDistanceKm) < 1e-10);
    const clearanceKm = target.radiusKm + pack.radiusKm;
    if (pack.targetDistanceBeforeKm >= clearanceKm) assert.ok(pack.targetDistanceKm >= clearanceKm - 1e-12);
    const expectedHeading = Math.atan2(target.z - pack.z, target.x - pack.x);
    assert.ok(Math.abs(pack.heading - expectedHeading) < 1e-12);
  }

  assert.ok(threatened.length > 0);
  assert.equal(plan.threatenedHerdCount, threatened.length);
  for (const herd of threatened) {
    const threat = packById.get(herd.threatGroupId);
    assert.ok(threat);
    assert.equal(threat.targetGroupId, herd.id);
    assert.equal(herd.threatLineageId, threat.lineageId);
    assert.equal(herd.behavior, "flee");
    assert.ok(herd.threatDistanceBeforeKm <= herd.threatPerceptionRadiusKm + 1e-12);
    assert.ok(herd.threatenedByCount >= 1);
    const expectedAwayHeading = Math.atan2(herd.z - threat.z, herd.x - threat.x);
    assert.ok(Math.abs(herd.heading - expectedAwayHeading) < 1e-12);
    const targetingThreats = targeted.filter((pack) => pack.targetGroupId === herd.id);
    const nearestDistance = Math.min(...targetingThreats.map((pack) => Math.hypot(herd.x - pack.x, herd.z - pack.z)));
    assert.ok(Math.abs(herd.threatDistanceKm - nearestDistance) < 1e-12);
  }

  const targetedIndividuals = plan.individuals.filter((animal) => animal.role === "carnivore" && animal.targetGroupId != null);
  assert.ok(targetedIndividuals.length > 0);
  for (const animal of targetedIndividuals) {
    const pack = packById.get(animal.groupId);
    assert.ok(pack?.targetGroupId);
    assert.equal(animal.targetGroupId, pack.targetGroupId);
    assert.equal(animal.targetLineageId, pack.targetLineageId);
    assert.ok(Math.abs(animal.yaw - pack.heading) < 1e-12);
  }

  const threatenedIndividuals = plan.individuals.filter((animal) => animal.role === "herbivore" && animal.threatGroupId != null);
  assert.ok(threatenedIndividuals.length > 0);
  for (const animal of threatenedIndividuals) {
    const herd = herdById.get(animal.groupId);
    assert.ok(herd?.threatGroupId);
    assert.equal(animal.behavior, "flee");
    assert.equal(animal.threatGroupId, herd.threatGroupId);
    assert.equal(animal.threatLineageId, herd.threatLineageId);
    assert.ok(Math.abs(animal.yaw - herd.heading) < 1e-12);
  }

  assert.equal(plan.herds.reduce((sum, herd) => sum + herd.population, 0), plan.visiblePopulation);
  assert.equal(plan.packs.reduce((sum, pack) => sum + pack.population, 0), plan.visibleCarnivorePopulation);
});

test("group populations conserve the observed aggregate populations", () => {
  const plan = buildObservedFauna({ state, vegetationSample: vegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 9, windowRadiusKm: 3, individualRadiusKm: 0.3 });
  assert.equal(plan.herds.reduce((sum, herd) => sum + herd.population, 0), plan.visiblePopulation);
  assert.equal(plan.packs.reduce((sum, pack) => sum + pack.population, 0), plan.visibleCarnivorePopulation);
});

test("individual detail is controlled by distance rather than a count cap", () => {
  const richState = { ...state, herbivoreBiomass: 4 };
  const richVegetation = { ...vegetation, npp: 1800 };
  const wide = buildObservedFauna({ state: richState, vegetationSample: richVegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 7, windowRadiusKm: 2.5, individualRadiusKm: 2.5 });
  const narrow = buildObservedFauna({ state: richState, vegetationSample: richVegetation, hydrologySample: hydrology, latitude: 39, longitude: -95, seed: 7, windowRadiusKm: 2.5, individualRadiusKm: 0.2 });
  assert.equal(wide.materializedHerbivores, wide.visiblePopulation);
  assert.ok(wide.materializedHerbivores > 100);
  assert.ok(narrow.materializedHerbivores < narrow.visiblePopulation);
});
