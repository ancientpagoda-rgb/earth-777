import test from "node:test";
import assert from "node:assert/strict";
import { FreeEarthEngine } from "../src/sim/free-earth.js";

function lineage(overrides = {}) {
  return {
    id: 1,
    parentId: null,
    birthYearBP: 777000,
    extinctionYearBP: null,
    populationIndex: 1,
    trophicLevel: 0.5,
    plantMatterAffinity: 0.5,
    livePreyAffinity: 0.5,
    carrionAffinity: 0.25,
    bodyMassLog10Kg: 1,
    thermalOptimumK: -1.27,
    mobility: 0.5,
    sociality: 0.5,
    cognition: 0.5,
    dietBreadth: 0.5,
    divergence: 0,
    ...overrides
  };
}

function engineWith(lineages) {
  const engine = new FreeEarthEngine(777123);
  engine.state.herbivoreBiomass = 3;
  engine.state.carnivoreBiomass = 1.2;
  engine.state.speciesLineages = lineages;
  return engine;
}

test("legacy grazing diagnostic is a plant-affinity-weighted lineage mean", () => {
  const engine = engineWith([
    lineage({ id: 1, populationIndex: 2, trophicLevel: 0.1, plantMatterAffinity: 0.9, livePreyAffinity: 0.1, dietBreadth: 0.1 }),
    lineage({ id: 2, populationIndex: 1, trophicLevel: 0.8, plantMatterAffinity: 0.2, livePreyAffinity: 0.8, dietBreadth: 0.9 })
  ]);

  engine.advance(1);

  const expected = (2 * 0.9 * 0.1 + 1 * 0.2 * 0.9) / (2 * 0.9 + 1 * 0.2);
  assert.ok(Math.abs(engine.state.herbivoreDietBreadthIndex - expected) < 1e-12);
});

function aggregateMetricsAt(livePreyAffinity) {
  const engine = engineWith([
    lineage({
      id: 11,
      trophicLevel: 0.2,
      plantMatterAffinity: 0.8,
      livePreyAffinity: 0.2,
      mobility: 0.1,
      sociality: 0.1,
      cognition: 0.1,
      dietBreadth: 0.1,
      bodyMassLog10Kg: 2,
      thermalOptimumK: -3
    }),
    lineage({
      id: 12,
      trophicLevel: livePreyAffinity,
      plantMatterAffinity: 1 - livePreyAffinity,
      livePreyAffinity,
      mobility: 0.9,
      sociality: 0.9,
      cognition: 0.9,
      dietBreadth: 0.9,
      bodyMassLog10Kg: 0.5,
      thermalOptimumK: 1
    })
  ]);
  engine.advance(1);
  return {
    pressure: engine.state.predationPressureIndex,
    grazing: engine.state.grazingPressureIndex,
    plantThermal: engine.state.herbivoreThermalAdaptationIndex,
    livePreyThermal: engine.state.carnivoreThermalAdaptationIndex
  };
}

test("aggregate ecology stays continuous across the former 0.55 role boundary", () => {
  const below = aggregateMetricsAt(0.549);
  const at = aggregateMetricsAt(0.55);
  const above = aggregateMetricsAt(0.551);

  for (const key of Object.keys(at)) {
    const left = Math.abs(at[key] - below[key]);
    const right = Math.abs(above[key] - at[key]);
    assert.ok(left < 0.01, `${key} has a left-side category cliff: ${left}`);
    assert.ok(right < 0.01, `${key} has a right-side category cliff: ${right}`);
    assert.ok(Math.abs(left - right) < 0.005, `${key} changes asymmetrically around the former boundary`);
  }
});

test("carrion affinity alone does not create active hunting pressure", () => {
  const configure = (carrionAffinity) => {
    const engine = engineWith([
      lineage({ id: 21, plantMatterAffinity: 0.9, livePreyAffinity: 0.1, carrionAffinity, trophicLevel: 0.1 }),
      lineage({ id: 22, plantMatterAffinity: 0.4, livePreyAffinity: 0.6, carrionAffinity: 0.2, trophicLevel: 0.6 })
    ]);
    engine.advance(1);
    return engine.state.predationPressureIndex;
  };

  assert.ok(Math.abs(configure(0) - configure(1)) < 1e-12);
});
