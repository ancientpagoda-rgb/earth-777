import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FreeEarthEngine } from "../src/sim/free-earth.js";
import {
  HOMININ_WATER_TRANSPORT_POLICY,
  advanceHomininWaterTransport,
  homininWaterTransportAt
} from "../src/sim/HomininWaterTransport.js";
import {
  HOMININ_CONFLICT_CONSTRUCTION_POLICY,
  advanceHomininConflictConstruction,
  homininConflictAt
} from "../src/sim/HomininConflictConstruction.js";

function activeSites(state) {
  return (state.homininSites ?? []).filter((site) => site.active && site.sitePopulationPersons > 0);
}

function totalStored(state) {
  return activeSites(state).reduce((sum, site) => sum + Math.max(0, Number(site.storedFoodPersonDays) || 0), 0);
}

function distinctLineageSites(state) {
  const sites = activeSites(state);
  const first = sites[0];
  const second = sites.find((site) => site.lineageId !== first?.lineageId) ?? sites[1];
  return [first, second];
}

test("checkpoint initializes generic water-transport and conflict-construction policies", () => {
  const state = new FreeEarthEngine(777001).snapshot();
  assert.equal(state.homininWaterTransportPolicy, HOMININ_WATER_TRANSPORT_POLICY);
  assert.equal(state.homininConflictConstructionPolicy, HOMININ_CONFLICT_CONSTRUCTION_POLICY);
  assert.ok(Array.isArray(state.homininWaterRoutes));
  assert.ok(Array.isArray(state.homininConflictEdges));
  assert.ok(Number.isFinite(state.homininWaterTransportSiteCount));
  assert.ok(Number.isFinite(state.homininDefensiveSiteCount));
});

test("water access plus construction and navigation capability can generate a physically water-dominated route", () => {
  const engine = new FreeEarthEngine(10101);
  const state = engine.state;
  const [a, b] = activeSites(state);
  assert.ok(a && b);

  a.latitude = 36.05; a.longitude = -5.58;
  b.latitude = 35.90; b.longitude = -5.30;
  a.coastalAccess = 1; b.coastalAccess = 1;
  a.sitePopulationPersons = Math.max(a.sitePopulationPersons, 700);
  b.sitePopulationPersons = Math.max(b.sitePopulationPersons, 700);
  for (const lineage of state.homininLineages) {
    lineage.toolComplexity = 0.92;
    lineage.cumulativeCulture = 0.90;
    lineage.communication = 0.90;
    lineage.dexterity = 0.90;
  }
  for (const deme of state.homininDemes) deme.exchangeDegree = 8;
  a.waterTransportIndex = 0.9; b.waterTransportIndex = 0.9;
  a.navigationIndex = 0.9; b.navigationIndex = 0.9;
  state.homininWaterTransportAccumulatorYears = 0;
  state.homininWaterRouteAccumulatorYears = 0;
  advanceHomininWaterTransport(state, 1000);

  const route = state.homininWaterRoutes.find((candidate) => {
    const ids = new Set([candidate.aSiteId, candidate.bSiteId]);
    return ids.has(a.id) && ids.has(b.id);
  });
  assert.ok(route);
  assert.ok(route.waterFraction >= 0.48);
  assert.ok(route.distanceKm > 0);
  assert.ok(route.personTripsPerYear > 0);
  assert.ok(route.cargoPersonDaysPerYear > 0);
  const sample = homininWaterTransportAt(state, a.id);
  assert.ok(sample.waterTransportIndex > 0);
  assert.ok(sample.navigationIndex > 0);
  assert.ok(sample.routeCount > 0);
});

test("low water access cannot create a route merely because tools are advanced", () => {
  const engine = new FreeEarthEngine(20202);
  const state = engine.state;
  const [a, b] = activeSites(state);
  assert.ok(a && b);
  a.coastalAccess = 0; b.coastalAccess = 0;
  for (const lineage of state.homininLineages) {
    lineage.toolComplexity = 1;
    lineage.cumulativeCulture = 1;
    lineage.communication = 1;
    lineage.dexterity = 1;
  }
  a.waterTransportIndex = 0; b.waterTransportIndex = 0;
  state.homininWaterTransportAccumulatorYears = 0;
  state.homininWaterRouteAccumulatorYears = 0;
  advanceHomininWaterTransport(state, 5000);
  assert.equal(a.waterTransportIndex, 0);
  assert.equal(b.waterTransportIndex, 0);
  assert.ok(!state.homininWaterRoutes.some((route) => route.aSiteId === a.id || route.bSiteId === a.id));
});

test("resource seizure transfers existing stores exactly and raises defensive investment under threat", () => {
  const engine = new FreeEarthEngine(30303);
  const state = engine.state;
  const [a, b] = distinctLineageSites(state);
  assert.ok(a && b);
  a.latitude = 10; a.longitude = 20;
  b.latitude = 10.1; b.longitude = 20.1;
  a.persistence = 0.92; b.persistence = 0.92;
  a.resourceReliability = 0.15; b.resourceReliability = 0.15;
  a.resourceConcentration = 0.95; b.resourceConcentration = 0.95;
  a.storedFoodPersonDays = 20_000;
  b.storedFoodPersonDays = 180_000;
  a.defensibility = 0.05; b.defensibility = 0.05;
  a.defensiveWorksIndex = 0; b.defensiveWorksIndex = 0;
  const demeA = state.homininDemes.find((deme) => deme.id === a.occupantDemeId);
  const demeB = state.homininDemes.find((deme) => deme.id === b.occupantDemeId);
  demeA.headcount = Math.max(demeA.headcount, 25_000);
  demeB.headcount = Math.max(demeB.headcount, 4_000);
  const lineageA = state.homininLineages.find((lineage) => lineage.id === a.lineageId);
  const lineageB = state.homininLineages.find((lineage) => lineage.id === b.lineageId);
  lineageA.toolComplexity = 0.95; lineageA.sociality = 0.92; lineageA.communication = 0.90; lineageA.mobility = 0.85;
  lineageB.toolComplexity = 0.16; lineageB.sociality = 0.30; lineageB.communication = 0.22; lineageB.mobility = 0.25;
  lineageA.populationPersons = Math.max(lineageA.populationPersons, 30_000); lineageA.carryingCapacityPersons = 20_000;
  lineageB.populationPersons = Math.max(lineageB.populationPersons, 5_000); lineageB.carryingCapacityPersons = 4_500;
  state.homininExchangeEdges = [];
  state.homininWaterRoutes = [];
  state.homininConflictEdges = [];
  state.homininConflictAccumulatorYears = 0;

  const before = totalStored(state);
  advanceHomininConflictConstruction(state, 250);
  const after = totalStored(state);
  assert.ok(Math.abs(after - before) < 1e-8);
  assert.ok(Math.abs(state.homininConflictResourceTransferClosureErrorPersonDays) < 1e-8);
  const edge = state.homininConflictEdges.find((candidate) => {
    const ids = new Set([candidate.aSiteId, candidate.bSiteId]);
    return ids.has(a.id) && ids.has(b.id);
  });
  assert.ok(edge);
  assert.ok(edge.conflictIntensity > 0);
  assert.ok(edge.resourceTransferPersonDays >= 0);
  assert.ok(a.defensiveWorksIndex > 0 || b.defensiveWorksIndex > 0);
  assert.ok(a.threatIndex > 0 || b.threatIndex > 0);
});

test("waterborne conflict requires a modeled water route rather than a coastal label alone", () => {
  const engine = new FreeEarthEngine(40404);
  const state = engine.state;
  const [a, b] = distinctLineageSites(state);
  assert.ok(a && b);
  a.latitude = 36.05; a.longitude = -5.58;
  b.latitude = 35.90; b.longitude = -5.30;
  a.coastalAccess = 1; b.coastalAccess = 1;
  a.persistence = 0.95; b.persistence = 0.95;
  a.resourceReliability = 0.12; b.resourceReliability = 0.12;
  a.resourceConcentration = 0.96; b.resourceConcentration = 0.96;
  a.storedFoodPersonDays = 100_000; b.storedFoodPersonDays = 100_000;
  for (const lineage of state.homininLineages) {
    lineage.toolComplexity = 0.95;
    lineage.cumulativeCulture = 0.92;
    lineage.communication = 0.88;
    lineage.dexterity = 0.90;
    lineage.sociality = 0.70;
    lineage.mobility = 0.75;
    lineage.populationPersons = Math.max(lineage.populationPersons, 10_000);
    lineage.carryingCapacityPersons = Math.max(1, lineage.populationPersons * 0.75);
  }
  a.waterTransportIndex = 0.95; b.waterTransportIndex = 0.95;
  a.navigationIndex = 0.95; b.navigationIndex = 0.95;
  state.homininWaterTransportAccumulatorYears = 0;
  state.homininWaterRouteAccumulatorYears = 0;
  advanceHomininWaterTransport(state, 1000);
  assert.ok(state.homininWaterRoutes.some((route) => new Set([route.aSiteId, route.bSiteId]).has(a.id)));
  state.homininConflictEdges = [];
  state.homininConflictAccumulatorYears = 0;
  advanceHomininConflictConstruction(state, 250);
  const waterEdge = state.homininConflictEdges.find((edge) => {
    const ids = new Set([edge.aSiteId, edge.bSiteId]);
    return ids.has(a.id) && ids.has(b.id) && edge.medium === "water";
  });
  assert.ok(waterEdge);

  state.homininWaterRoutes = [];
  state.homininConflictEdges = [];
  state.homininConflictAccumulatorYears = 0;
  advanceHomininConflictConstruction(state, 250);
  const withoutRoute = state.homininConflictEdges.find((edge) => {
    const ids = new Set([edge.aSiteId, edge.bSiteId]);
    return ids.has(a.id) && ids.has(b.id);
  });
  assert.ok(!withoutRoute || withoutRoute.medium === "land");
});

test("capability and conflict use 250-year cadence while route topology uses 1000-year LOD", () => {
  const engine = new FreeEarthEngine(50505);
  const state = engine.state;
  const site = activeSites(state)[0];
  const transportBefore = site.waterTransportIndex;
  const defenseBefore = site.defensiveWorksIndex;
  engine.advance(25);
  assert.equal(state.homininWaterTransportAccumulatorYears, 25);
  assert.equal(state.homininWaterRouteAccumulatorYears, 25);
  assert.equal(state.homininConflictAccumulatorYears, 25);
  assert.equal(site.waterTransportIndex, transportBefore);
  assert.equal(site.defensiveWorksIndex, defenseBefore);
  engine.advance(225);
  assert.equal(state.homininWaterTransportAccumulatorYears, 0);
  assert.equal(state.homininWaterRouteAccumulatorYears, 250);
  assert.equal(state.homininConflictAccumulatorYears, 0);
  engine.advance(750);
  assert.equal(state.homininWaterTransportAccumulatorYears, 0);
  assert.equal(state.homininWaterRouteAccumulatorYears, 0);
  assert.equal(state.homininConflictAccumulatorYears, 0);
});

test("same seed reproduces water routes, conflict edges and defensive works", () => {
  const a = new FreeEarthEngine(60606).advance(5000);
  const b = new FreeEarthEngine(60606).advance(5000);
  assert.deepEqual(a.homininWaterRoutes, b.homininWaterRoutes);
  assert.deepEqual(a.homininConflictEdges, b.homininConflictEdges);
  assert.deepEqual(
    a.homininSites.map((site) => [site.id, site.waterTransportIndex, site.navigationIndex, site.threatIndex, site.defensiveWorksIndex]),
    b.homininSites.map((site) => [site.id, site.waterTransportIndex, site.navigationIndex, site.threatIndex, site.defensiveWorksIndex])
  );
});

test("mechanism source contains no named historical outcome or era switch", () => {
  const waterSource = readFileSync(new URL("../src/sim/HomininWaterTransport.js", import.meta.url), "utf8");
  const conflictSource = readFileSync(new URL("../src/sim/HomininConflictConstruction.js", import.meta.url), "utf8");
  const source = `${waterSource}\n${conflictSource}`;
  assert.doesNotMatch(source, /pirate|castle|empire|kingdom|medieval|bronze age|iron age|viking|rome|greece|africa|europe|mesopotamia/i);
  assert.match(waterSource, /routeWaterFraction/);
  assert.match(waterSource, /CAPABILITY_INTERVAL_YEARS = 250/);
  assert.match(waterSource, /ROUTE_INTERVAL_YEARS = 1000/);
  assert.match(conflictSource, /CONFLICT_INTERVAL_YEARS = 250/);
  assert.match(conflictSource, /homininConflictResourceTransferClosureErrorPersonDays/);
  assert.match(conflictSource, /defensiveWorksIndex/);
});

test("local diagnostics expose the generic capabilities rather than a named social role", () => {
  const state = new FreeEarthEngine(70707).advance(1000);
  const site = activeSites(state)[0];
  const water = homininWaterTransportAt(state, site.id);
  const conflict = homininConflictAt(state, site.id);
  assert.ok(water);
  assert.ok(conflict);
  assert.ok(water.waterTransportIndex >= 0 && water.waterTransportIndex <= 1);
  assert.ok(conflict.defensiveWorksIndex >= 0 && conflict.defensiveWorksIndex <= 1);
  assert.ok(Number.isFinite(conflict.defensiveBarrierEquivalentMeters));
});
