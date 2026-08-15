import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FreeEarthEngine } from "../src/sim/free-earth.js";
import {
  HOMININ_SOCIAL_POLICY,
  advanceHomininSocialOrganization,
  homininSocialAt
} from "../src/sim/HomininSocialOrganization.js";

function activeSites(state) {
  return (state.homininSites ?? []).filter((site) => site.active && site.sitePopulationPersons > 0);
}

function totalStored(state) {
  return activeSites(state).reduce((sum, site) => sum + (Number(site.storedFoodPersonDays) || 0), 0);
}

test("checkpoint demes decompose into households, residential groups and occupied sites", () => {
  const state = new FreeEarthEngine(777001).snapshot();
  assert.equal(state.homininSocialPolicy, HOMININ_SOCIAL_POLICY);
  assert.ok(state.homininHouseholdCount > 0);
  assert.ok(state.homininResidentialGroupCount > 0);
  assert.equal(state.homininActiveSiteCount, activeSites(state).length);
  assert.ok(activeSites(state).length > 0);

  const demeById = new Map(state.homininDemes.map((deme) => [deme.id, deme]));
  for (const deme of state.homininDemes) {
    assert.ok(deme.householdSizePersons >= 3.4 && deme.householdSizePersons <= 6.5);
    assert.ok(deme.householdCount > 0);
    assert.ok(deme.meanResidentialGroupSizePersons >= deme.householdSizePersons * 2);
    assert.ok(deme.residentialGroupCount > 0);
    assert.ok(deme.periodicAggregationSizePersons <= deme.headcount + 1e-9);
  }
  for (const site of activeSites(state)) {
    const deme = demeById.get(site.occupantDemeId);
    assert.ok(deme);
    assert.ok(site.sitePopulationPersons > 0);
    assert.ok(site.sitePopulationPersons <= deme.headcount);
    assert.ok(site.householdCount > 0);
    assert.ok(site.persistence >= 0 && site.persistence <= 1);
    assert.ok(site.builtEnvironmentIndex >= 0 && site.builtEnvironmentIndex <= 1);
  }
});

test("social geography and exchange topology update on a 250-year temporal LOD", () => {
  const engine = new FreeEarthEngine(777001);
  const site = activeSites(engine.snapshot())[0];
  const initialTenure = site.tenureYears;
  const state25 = engine.advance(25);
  const sameSite25 = state25.homininSites.find((candidate) => candidate.id === site.id);
  assert.equal(state25.homininSocialAccumulatorYears, 25);
  assert.equal(sameSite25.tenureYears, initialTenure);
  const state250 = engine.advance(225);
  const sameSite250 = state250.homininSites.find((candidate) => candidate.id === site.id);
  assert.equal(state250.homininSocialAccumulatorYears, 0);
  assert.ok(!sameSite250 || sameSite250.tenureYears >= initialTenure + 250 || sameSite250.active === false);
});

test("storage, communication and low mobility can produce more persistent co-residence without a scripted stage", () => {
  const low = new FreeEarthEngine(919191);
  const high = new FreeEarthEngine(919191);
  for (const lineage of low.state.homininLineages) {
    lineage.cumulativeCulture = 0.04;
    lineage.toolComplexity = 0.08;
    lineage.fireReliance = 0.02;
    lineage.communication = 0.18;
    lineage.sociality = 0.42;
    lineage.mobility = 0.86;
  }
  for (const lineage of high.state.homininLineages) {
    lineage.cumulativeCulture = 0.90;
    lineage.toolComplexity = 0.90;
    lineage.fireReliance = 0.72;
    lineage.communication = 0.88;
    lineage.sociality = 0.76;
    lineage.mobility = 0.10;
  }
  advanceHomininSocialOrganization(low.state, 1000);
  advanceHomininSocialOrganization(high.state, 1000);
  assert.ok(high.state.homininMeanSettlementPersistence > low.state.homininMeanSettlementPersistence);
  assert.ok(high.state.homininLargestSitePopulationPersons > low.state.homininLargestSitePopulationPersons);
  assert.ok(totalStored(high.state) > totalStored(low.state));
  assert.ok(high.state.homininSites.every((site) => !site.active || !("historicalStage" in site)));
});

test("nearby demes form unique distance-grounded exchange ties without an all-pairs cap", () => {
  const engine = new FreeEarthEngine(515151);
  const state = engine.state;
  assert.ok(state.homininDemes.length >= 2);
  const anchor = state.homininDemes[0];
  const neighbor = state.homininDemes[1];
  neighbor.latitude = anchor.latitude;
  neighbor.longitude = anchor.longitude;
  for (const lineage of state.homininLineages) {
    lineage.communication = 0.86;
    lineage.cumulativeCulture = 0.74;
  }
  advanceHomininSocialOrganization(state, 250);
  const pairs = new Set();
  for (const edge of state.homininExchangeEdges) {
    assert.notEqual(edge.aDemeId, edge.bDemeId);
    assert.ok(Number.isFinite(edge.distanceKm) && edge.distanceKm >= 0);
    assert.ok(edge.interactionWeight > 0);
    assert.ok(edge.personTripsPerYear >= 0);
    const pair = [edge.aDemeId, edge.bDemeId].sort().join("|");
    assert.ok(!pairs.has(pair));
    pairs.add(pair);
  }
  assert.ok(state.homininExchangeEdges.some((edge) => {
    const ids = new Set([edge.aDemeId, edge.bDemeId]);
    return ids.has(anchor.id) && ids.has(neighbor.id);
  }));
});

test("same seed produces identical households, sites and exchange networks", () => {
  const a = new FreeEarthEngine(424242);
  const b = new FreeEarthEngine(424242);
  const stateA = a.advance(2500);
  const stateB = b.advance(2500);
  assert.equal(stateA.homininHouseholdCount, stateB.homininHouseholdCount);
  assert.equal(stateA.homininResidentialGroupCount, stateB.homininResidentialGroupCount);
  assert.equal(stateA.homininLargestSitePopulationPersons, stateB.homininLargestSitePopulationPersons);
  assert.deepEqual(stateA.homininSites, stateB.homininSites);
  assert.deepEqual(stateA.homininExchangeEdges, stateB.homininExchangeEdges);
});

test("local social sampling returns the actual nearest occupied site", () => {
  const state = new FreeEarthEngine(777001).advance(250);
  const site = activeSites(state)[0];
  assert.ok(site);
  const local = homininSocialAt(state, site.latitude, site.longitude, 50);
  assert.ok(local);
  assert.equal(local.nearestSiteId, site.id);
  assert.ok(local.nearestSiteDistanceKm < 1e-6);
  assert.ok(local.sitePopulationPersons > 0);
  assert.ok(local.householdCount > 0);
  assert.ok(local.settlementPersistence >= 0 && local.settlementPersistence <= 1);
});

test("social equations contain no named historical or geographic outcome rules and surface uses social-site LOD", () => {
  const socialSource = readFileSync(new URL("../src/sim/HomininSocialOrganization.js", import.meta.url), "utf8");
  const surfaceProfile = readFileSync(new URL("../src/render/SurfaceBiomeProfile.js", import.meta.url), "utf8");
  const surfaceManager = readFileSync(new URL("../src/render/SurfaceEcologyManager.js", import.meta.url), "utf8");
  assert.doesNotMatch(socialSource, /Africa|Sahara|Europe|Mesopotamia|India|Amazon|castle|pirate|empire|kingdom/i);
  assert.match(socialSource, /SPATIAL_BIN_DEGREES/);
  assert.match(socialSource, /SOCIAL_INTERVAL_YEARS/);
  assert.match(surfaceProfile, /homininSocialAt/);
  assert.match(surfaceManager, /homininSocialSiteOffsetEastKm/);
  assert.match(surfaceManager, /householdsPerRenderedShelter/);
  assert.match(surfaceManager, /Math\.sqrt\(households\)/);
});
