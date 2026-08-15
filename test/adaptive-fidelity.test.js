import test from "node:test";
import assert from "node:assert/strict";
import { AdaptiveFidelityController, ADAPTIVE_RUNTIME_POLICY } from "../src/sim/AdaptiveFidelityController.js";
import { FreeEarthEngine } from "../src/sim/free-earth.js";

test("adaptive runtime decisions are deterministic, bounded, and labeled as policy", () => {
  const state = new FreeEarthEngine(777001).snapshot();
  const firstController = new AdaptiveFidelityController({ budget: 1 });
  const secondController = new AdaptiveFidelityController({ budget: 1 });
  const first = firstController.update(state);
  const second = secondController.update(state);

  assert.deepEqual(first, second);
  assert.equal(first.runtimePolicy, ADAPTIVE_RUNTIME_POLICY);
  assert.match(first.runtimeEpistemicStatus, /not a scientific measurement/);
  assert.ok(first.targets.some((target) => target.runtimeBound));

  for (const target of first.targets) {
    assert.ok(Number.isInteger(target.temporalSubsteps));
    assert.ok(target.temporalSubsteps >= 1 && target.temporalSubsteps <= 12);
    assert.ok(target.spatialDetail >= 0 && target.spatialDetail <= 1);
  }
});

test("larger fidelity budgets spend more temporal work without dropping systems", () => {
  const state = new FreeEarthEngine(777001).snapshot();
  const low = new AdaptiveFidelityController({ budget: 0.5 }).update(state);
  const high = new AdaptiveFidelityController({ budget: 2 }).update(state);

  const lowBound = low.targets.filter((target) => target.runtimeBound);
  const highById = new Map(high.targets.map((target) => [target.id, target]));
  let lowWork = 0;
  let highWork = 0;

  for (const target of lowBound) {
    const highTarget = highById.get(target.id);
    assert.ok(highTarget?.runtimeBound);
    assert.ok(target.temporalSubsteps >= 1);
    assert.ok(highTarget.temporalSubsteps >= target.temporalSubsteps);
    lowWork += target.temporalSubsteps;
    highWork += highTarget.temporalSubsteps;
  }

  assert.ok(highWork > lowWork);
});

test("Free Earth actually executes CWF-selected substeps", () => {
  const engine = new FreeEarthEngine(777001, { fidelityBudget: 1 });
  engine.advance(500);
  const diagnostics = engine.fidelityDiagnostics();
  const refined = diagnostics.targets.find((target) => target.runtimeBound && target.temporalSubsteps > 1);

  assert.ok(refined, "expected at least one runtime-bound system to receive refinement");
  assert.ok((diagnostics.executedSubsteps.orbit ?? 0) > 0);
  assert.ok((diagnostics.executedSubsteps[refined.id] ?? 0) > diagnostics.executedSubsteps.orbit);
});

test("event log is deterministic for the same seed and runtime policy", () => {
  const first = new FreeEarthEngine(12345, { fidelityBudget: 1 }).advance(12_000);
  const second = new FreeEarthEngine(12345, { fidelityBudget: 1 }).advance(12_000);

  assert.deepEqual(first.events, second.events);
  assert.ok(first.events.length > 0);
  assert.ok(first.events.every((event) => /Matuyama–Brunhes|lineage/.test(event.text)));
});

test("journal reports lineage changes produced by the active evolutionary models", () => {
  const engine = new FreeEarthEngine(777001, { fidelityBudget: 1 });
  const animal = engine.state.speciesLineages[0];
  const hominin = engine.state.homininLineages[0];
  animal.populationIndex = 1;
  animal.divergence = 1;
  hominin.populationIndex = 1;
  hominin.divergence = 1;
  engine.evolutionRandom = () => 0;
  engine.homininRandom = () => 0;

  const state = engine.advance(25);

  assert.ok(state.events.some((event) => /Animal lineage .* branches from lineage/.test(event.text)));
  assert.ok(state.events.some((event) => /Hominin lineage .* branches from/.test(event.text)));
});

test("adaptive Free Earth remains deterministic for the same seed and runtime policy", () => {
  const options = { fidelityBudget: 1.5, observerRelevance: { climate: 1, hominins: 0.8 } };
  const first = new FreeEarthEngine(9981, options);
  const second = new FreeEarthEngine(9981, options);

  assert.deepEqual(first.advance(20_000), second.advance(20_000));
  assert.deepEqual(first.fidelityDiagnostics(), second.fidelityDiagnostics());
});
