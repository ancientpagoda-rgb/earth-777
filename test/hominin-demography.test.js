import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FreeEarthEngine } from "../src/sim/free-earth.js";
import {
  HOMININ_DEMOGRAPHY_POLICY,
  homininPopulationAt
} from "../src/sim/HomininDemography.js";

function totalDemePopulation(state) {
  return (state.homininDemes ?? []).reduce((sum, deme) => sum + (Number(deme.headcount) || 0), 0);
}

function totalLineagePopulation(state) {
  return (state.homininLineages ?? []).reduce((sum, lineage) => sum + (Number(lineage.populationPersons) || 0), 0);
}

test("checkpoint hominins have explicit conserved headcounts, age structure and demes", () => {
  const state = new FreeEarthEngine(777001).snapshot();
  assert.equal(state.homininDemographyPolicy, HOMININ_DEMOGRAPHY_POLICY);
  assert.ok(Number.isInteger(state.homininPopulationPersons));
  assert.ok(state.homininPopulationPersons > 1_000);
  assert.equal(totalDemePopulation(state), state.homininPopulationPersons);
  assert.equal(totalLineagePopulation(state), state.homininPopulationPersons);
  assert.equal(state.homininFemalePersons + state.homininMalePersons, state.homininPopulationPersons);
  const ageTotal = Object.values(state.homininAgeStructure).reduce((sum, value) => sum + value, 0);
  assert.equal(ageTotal, state.homininPopulationPersons);
  assert.equal(state.homininDemeCount, state.homininDemes.length);
  assert.ok(state.homininLineages.every((lineage) => Number.isInteger(lineage.populationPersons) && lineage.populationPersons > 0));
});

test("births and deaths reconcile with explicit headcount change", () => {
  const engine = new FreeEarthEngine(777001);
  const before = engine.snapshot().homininPopulationPersons;
  const after = engine.advance(25);
  const demographicChange = (after.homininBirthsPerYear - after.homininDeathsPerYear) * 25;
  assert.ok(Math.abs((after.homininPopulationPersons - before) - demographicChange) <= 2);
  assert.ok(after.homininBirthsPerYear >= 0);
  assert.ok(after.homininDeathsPerYear >= 0);
  assert.equal(totalDemePopulation(after), after.homininPopulationPersons);
});

test("same seed produces identical demographic history and migrating demes", () => {
  const a = new FreeEarthEngine(424242);
  const b = new FreeEarthEngine(424242);
  const stateA = a.advance(2_500);
  const stateB = b.advance(2_500);
  assert.equal(stateA.homininPopulationPersons, stateB.homininPopulationPersons);
  assert.equal(stateA.homininBirthsPerYear, stateB.homininBirthsPerYear);
  assert.equal(stateA.homininDeathsPerYear, stateB.homininDeathsPerYear);
  assert.deepEqual(stateA.homininDemes, stateB.homininDemes);
  assert.deepEqual(
    stateA.homininLineages.map((lineage) => [lineage.id, lineage.populationPersons, lineage.ageStructure]),
    stateB.homininLineages.map((lineage) => [lineage.id, lineage.populationPersons, lineage.ageStructure])
  );
});

test("local population density follows actual demographic demes", () => {
  const state = new FreeEarthEngine(777001).advance(1_000);
  const deme = state.homininDemes.find((candidate) => candidate.headcount > 0);
  assert.ok(deme);
  const local = homininPopulationAt(state, deme.latitude, deme.longitude, 100);
  const antipodeLongitude = ((deme.longitude + 360) % 360) - 180;
  const opposite = homininPopulationAt(state, -deme.latitude, antipodeLongitude, 100);
  assert.ok(local.densityPersonsPerKm2 > 0);
  assert.ok(local.estimatedPersonsWithinRadius > 0);
  assert.ok(local.nearestDemeDistanceKm < 1e-6);
  assert.ok(local.densityPersonsPerKm2 >= opposite.densityPersonsPerKm2);
});

test("surface hominin placement contains no named geographic outcome boxes", () => {
  const profileSource = readFileSync(new URL("../src/render/SurfaceBiomeProfile.js", import.meta.url), "utf8");
  const demographySource = readFileSync(new URL("../src/sim/HomininDemography.js", import.meta.url), "utf8");
  assert.doesNotMatch(profileSource, /homininSuitability/);
  assert.doesNotMatch(`${profileSource}\n${demographySource}`, /Africa|Sahara|India|Amazon|Australia|Greenland/i);
  assert.match(profileSource, /homininPopulationAt/);
  assert.match(demographySource, /migrating demes/);
});

test("bootstrap installs the demographic population readout", () => {
  const bootstrap = readFileSync(new URL("../src/bootstrap.js", import.meta.url), "utf8");
  const readout = readFileSync(new URL("../src/render/DemographyReadout.js", import.meta.url), "utf8");
  assert.match(bootstrap, /DemographyReadout\.js/);
  assert.match(readout, /#hominin-readout/);
  assert.match(readout, /populationPersons/);
});
