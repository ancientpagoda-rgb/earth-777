import test from "node:test";
import assert from "node:assert/strict";
import { CausalDependencyGraph } from "../src/sim/CausalDependencyGraph.js";
import { consequenceWeightedScore, rankFidelityTargets } from "../src/sim/ConsequenceWeightedFidelity.js";
import { createFidelityPlan } from "../src/sim/fidelity-policy.js";
import { FreeEarthEngine } from "../src/sim/free-earth.js";

test("causal uncertainty propagation converges and stays bounded", () => {
  const graph = new CausalDependencyGraph({
    nodes: [
      { id: "a", localUncertainty: 0.2 },
      { id: "b", localUncertainty: 0.3 },
      { id: "c", localUncertainty: 0.1 }
    ],
    edges: [
      { from: "a", to: "b", strength: 0.8 },
      { from: "b", to: "c", strength: 0.7 },
      { from: "c", to: "a", strength: 0.2 }
    ]
  });

  const result = graph.propagate();
  assert.equal(result.converged, true);
  for (const node of Object.values(result.nodes)) {
    assert.ok(node.totalUncertainty >= node.localUncertainty);
    assert.ok(node.totalUncertainty >= 0 && node.totalUncertainty <= 1);
    assert.ok(node.propagatedUncertainty >= 0 && node.propagatedUncertainty <= 1);
  }
});

test("reducing upstream uncertainty lowers downstream uncertainty", () => {
  const graph = new CausalDependencyGraph({
    nodes: [
      { id: "forcing", localUncertainty: 0.5 },
      { id: "climate", localUncertainty: 0.2 },
      { id: "ecology", localUncertainty: 0.3 }
    ],
    edges: [
      { from: "forcing", to: "climate", strength: 0.9 },
      { from: "climate", to: "ecology", strength: 0.8 }
    ]
  });

  const leverage = graph.researchLeverage("forcing", { reductionFraction: 0.35 });
  assert.ok(leverage.downstreamReduction > 0);
  assert.ok(leverage.reductions.climate > 0);
  assert.ok(leverage.reductions.ecology > 0);
});

test("CWF score increases with consequence and decreases with compute cost", () => {
  const base = {
    causalInfluence: 1,
    sensitivity: 1,
    uncertainty: 0.5,
    systemsAffected: 4,
    relevance: 1,
    computeCost: 1
  };
  assert.ok(consequenceWeightedScore({ ...base, causalInfluence: 2 }) > consequenceWeightedScore(base));
  assert.ok(consequenceWeightedScore({ ...base, computeCost: 2 }) < consequenceWeightedScore(base));
});

test("CWF ranking is deterministic", () => {
  const targets = [
    { id: "a", causalInfluence: 2, sensitivity: 1, uncertainty: 0.5, systemsAffected: 3, relevance: 1, computeCost: 1 },
    { id: "b", causalInfluence: 1, sensitivity: 1, uncertainty: 0.5, systemsAffected: 1, relevance: 1, computeCost: 1 }
  ];
  const first = rankFidelityTargets(targets);
  const second = rankFidelityTargets(targets);
  assert.deepEqual(first, second);
  assert.equal(first[0].id, "a");
});

test("Earth 777 fidelity plan is bounded, labeled as policy, and deterministic", () => {
  const state = new FreeEarthEngine(777001).advance(12_000);
  const first = createFidelityPlan(state);
  const second = createFidelityPlan(state);

  assert.deepEqual(first, second);
  assert.equal(first.policy, "consequence-weighted-fidelity-v1");
  assert.match(first.epistemicStatus, /not a scientific measurement/);
  assert.equal(first.graphConverged, true);
  assert.ok(first.targets.length >= 8);

  const allocation = first.targets.reduce((sum, target) => sum + target.allocation, 0);
  assert.ok(Math.abs(allocation - 1) < 1e-9);
  for (const target of first.targets) {
    assert.ok(target.localUncertainty >= 0 && target.localUncertainty <= 1);
    assert.ok(target.propagatedUncertainty >= 0 && target.propagatedUncertainty <= 1);
    assert.ok(target.allocation >= 0 && target.allocation <= 1);
  }
});
