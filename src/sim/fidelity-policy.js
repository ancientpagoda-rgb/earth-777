import { CausalDependencyGraph } from "./CausalDependencyGraph.js";
import { allocateFidelityBudget } from "./ConsequenceWeightedFidelity.js";

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const BASE_NODES = Object.freeze([
  { id: "orbit", localUncertainty: 0.03, evidence: "study constrained" },
  { id: "carbon", localUncertainty: 0.22, evidence: "mixed: study constrained + model derived" },
  { id: "climate", localUncertainty: 0.24, evidence: "model derived" },
  { id: "ice", localUncertainty: 0.28, evidence: "model derived" },
  { id: "seaLevel", localUncertainty: 0.18, evidence: "study constrained + modeled branch divergence" },
  { id: "hydrology", localUncertainty: 0.46, evidence: "provisional prior" },
  { id: "vegetation", localUncertainty: 0.48, evidence: "provisional prior" },
  { id: "herbivores", localUncertainty: 0.60, evidence: "provisional prior" },
  { id: "carnivores", localUncertainty: 0.65, evidence: "provisional prior" },
  { id: "hominins", localUncertainty: 0.72, evidence: "provisional prior" },
  { id: "magnetism", localUncertainty: 0.34, evidence: "chronology constrained; field geometry provisional" }
]);

const EDGES = Object.freeze([
  { from: "orbit", to: "climate", strength: 0.72 },
  { from: "orbit", to: "ice", strength: 0.46 },
  { from: "carbon", to: "climate", strength: 0.82 },
  { from: "climate", to: "carbon", strength: 0.28 },
  { from: "climate", to: "ice", strength: 0.78 },
  { from: "ice", to: "climate", strength: 0.42 },
  { from: "ice", to: "seaLevel", strength: 0.91 },
  { from: "seaLevel", to: "hydrology", strength: 0.36 },
  { from: "climate", to: "hydrology", strength: 0.84 },
  { from: "hydrology", to: "vegetation", strength: 0.73 },
  { from: "climate", to: "vegetation", strength: 0.68 },
  { from: "carbon", to: "vegetation", strength: 0.38 },
  { from: "vegetation", to: "carbon", strength: 0.18 },
  { from: "vegetation", to: "herbivores", strength: 0.86 },
  { from: "herbivores", to: "vegetation", strength: 0.22 },
  { from: "herbivores", to: "carnivores", strength: 0.84 },
  { from: "vegetation", to: "hominins", strength: 0.55 },
  { from: "herbivores", to: "hominins", strength: 0.44 },
  { from: "climate", to: "hominins", strength: 0.40 },
  { from: "magnetism", to: "hominins", strength: 0.05 }
]);

const SENSITIVITY = Object.freeze({
  orbit: 0.92,
  carbon: 0.90,
  climate: 1.00,
  ice: 0.95,
  seaLevel: 0.72,
  hydrology: 0.88,
  vegetation: 0.82,
  herbivores: 0.62,
  carnivores: 0.48,
  hominins: 0.58,
  magnetism: 0.24
});

const COMPUTE_COST = Object.freeze({
  orbit: 0.12,
  carbon: 0.28,
  climate: 1.00,
  ice: 0.82,
  seaLevel: 0.34,
  hydrology: 0.72,
  vegetation: 0.55,
  herbivores: 0.62,
  carnivores: 0.68,
  hominins: 0.86,
  magnetism: 0.42
});

function localUncertaintyFor(node, state) {
  if (node.id === "seaLevel" && Number.isFinite(state?.seaLevelUncertainty)) {
    return clamp01(0.08 + state.seaLevelUncertainty / 35);
  }
  if (node.id === "climate") {
    const elapsed = clamp01((state?.elapsedYears ?? 0) / 777_000);
    return clamp01(node.localUncertainty + elapsed * 0.22);
  }
  return node.localUncertainty;
}

function activityFor(id, state) {
  switch (id) {
    case "carbon": return clamp01(0.45 + Math.abs((state?.co2 ?? 245) - 245) / 110);
    case "climate": return clamp01(0.55 + Math.abs((state?.temperatureAnomaly ?? -1.27) + 1.27) / 5);
    case "ice": return clamp01(0.45 + Math.abs((state?.iceIndex ?? 0.18) - 0.18));
    case "seaLevel": return clamp01(0.45 + Math.abs((state?.seaLevel ?? -12.76) + 12.76) / 140);
    case "vegetation": return clamp01(0.50 + Math.abs((state?.productivityIndex ?? 1) - 1));
    case "herbivores": return clamp01(0.45 + Math.abs((state?.herbivoreBiomass ?? 1) - 1));
    case "carnivores": return clamp01(0.40 + Math.abs((state?.carnivoreBiomass ?? 1) - 1));
    case "hominins": return clamp01(0.42 + Math.abs((state?.homininPopulationIndex ?? 1) - 1));
    case "magnetism": return clamp01(0.28 + (1 - (state?.magneticStrength ?? 0.78)) * 0.72);
    default: return 0.55;
  }
}

export function createEarth777CausalGraph(state = {}) {
  return new CausalDependencyGraph({
    nodes: BASE_NODES.map((node) => ({
      ...node,
      localUncertainty: localUncertaintyFor(node, state)
    })),
    edges: EDGES
  });
}

export function createFidelityPlan(state = {}, { budget = 1, observerRelevance = {} } = {}) {
  const graph = createEarth777CausalGraph(state);
  const analysis = graph.analyze();
  const targets = Object.entries(analysis.nodes).map(([id, node]) => ({
    id,
    causalInfluence: 1 + node.reach.weightedReach + node.researchLeverage,
    sensitivity: SENSITIVITY[id] ?? 0.5,
    uncertainty: node.totalUncertainty,
    systemsAffected: node.reach.systemsAffected,
    relevance: clamp01(activityFor(id, state) * 0.75 + (observerRelevance[id] ?? 0.5) * 0.25),
    computeCost: COMPUTE_COST[id] ?? 1,
    localUncertainty: node.localUncertainty,
    propagatedUncertainty: node.propagatedUncertainty,
    researchLeverage: node.researchLeverage,
    evidence: node.evidence
  }));

  return Object.freeze({
    policy: "consequence-weighted-fidelity-v1",
    epistemicStatus: "simulation policy metadata; not a scientific measurement",
    graphConverged: analysis.converged,
    graphIterations: analysis.iterations,
    budget: Math.max(0, Number(budget) || 0),
    targets: allocateFidelityBudget(targets, { budget })
  });
}
