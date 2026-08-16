import { CausalDependencyGraph } from "./CausalDependencyGraph.js";
import { allocateFidelityBudget } from "./ConsequenceWeightedFidelity.js";

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const BASE_NODES = Object.freeze([
  { id: "orbit", localUncertainty: 0.03, evidence: "study constrained" },
  { id: "geology", localUncertainty: 0.54, evidence: "provisional mantle/geologic activity emulator" },
  { id: "tectonics", localUncertainty: 0.62, evidence: "moving plate-domain and boundary-strain topography model" },
  { id: "carbon", localUncertainty: 0.34, evidence: "reservoir-conserving intermediate-complexity carbon cycle" },
  { id: "methane", localUncertainty: 0.42, evidence: "process-responsive wetland/inland-water/geologic source + oxidation lifetime model" },
  { id: "nitrogen", localUncertainty: 0.48, evidence: "reactive-N reservoirs + fixation/N2O source/photolysis model" },
  { id: "climate", localUncertainty: 0.28, evidence: "study-constrained checkpoint + model-derived greenhouse/orbital/ice response" },
  { id: "ocean", localUncertainty: 0.48, evidence: "branch overturning/ventilation/salinity + spatial carbonate chemistry and surface/deep carbon exchange" },
  { id: "ice", localUncertainty: 0.32, evidence: "model derived climate/orbital response" },
  { id: "seaLevel", localUncertainty: 0.30, evidence: "simulated ice-volume + ocean-heat response; reconstruction retained only for validation" },
  { id: "hydrology", localUncertainty: 0.36, evidence: "study-constrained BIOME4 soil + model-derived closed water balance, branch hydroclimate and ETOPO river routing" },
  { id: "vegetation", localUncertainty: 0.40, evidence: "BIOME4 physiology + optimized PFT competition and lagged branch succession" },
  { id: "fauna", localUncertainty: 0.60, evidence: "one energy-limited aggregate animal biomass coupled to continuous lineage feeding affinities and predation" },
  { id: "evolution", localUncertainty: 0.70, evidence: "open anonymous lineage adaptation, competition, speciation and extinction" },
  { id: "hominins", localUncertainty: 0.70, evidence: "species-resolved hominin lineage ecology with culture/tool traits internal to the lineage model" },
  { id: "magnetism", localUncertainty: 0.40, evidence: "reversal chronology constrained; secular field dynamics provisional" }
]);

const EDGES = Object.freeze([
  { from: "orbit", to: "climate", strength: 0.72 },
  { from: "orbit", to: "ice", strength: 0.46 },
  { from: "orbit", to: "hydrology", strength: 0.35 },
  { from: "geology", to: "tectonics", strength: 0.82 },
  { from: "geology", to: "carbon", strength: 0.62 },
  { from: "geology", to: "methane", strength: 0.20 },
  { from: "tectonics", to: "carbon", strength: 0.28 },
  { from: "tectonics", to: "hydrology", strength: 0.32 },
  { from: "tectonics", to: "ocean", strength: 0.28 },
  { from: "carbon", to: "climate", strength: 0.78 },
  { from: "carbon", to: "ocean", strength: 0.64 },
  { from: "carbon", to: "vegetation", strength: 0.48 },
  { from: "methane", to: "climate", strength: 0.56 },
  { from: "methane", to: "carbon", strength: 0.18 },
  { from: "nitrogen", to: "climate", strength: 0.34 },
  { from: "nitrogen", to: "vegetation", strength: 0.58 },
  { from: "climate", to: "carbon", strength: 0.36 },
  { from: "climate", to: "methane", strength: 0.52 },
  { from: "climate", to: "nitrogen", strength: 0.42 },
  { from: "climate", to: "ocean", strength: 0.76 },
  { from: "ocean", to: "climate", strength: 0.34 },
  { from: "ocean", to: "carbon", strength: 0.62 },
  { from: "ocean", to: "nitrogen", strength: 0.24 },
  { from: "climate", to: "ice", strength: 0.78 },
  { from: "ice", to: "climate", strength: 0.42 },
  { from: "ocean", to: "seaLevel", strength: 0.52 },
  { from: "ice", to: "seaLevel", strength: 0.91 },
  { from: "seaLevel", to: "hydrology", strength: 0.36 },
  { from: "climate", to: "hydrology", strength: 0.84 },
  { from: "hydrology", to: "vegetation", strength: 0.73 },
  { from: "climate", to: "vegetation", strength: 0.68 },
  { from: "vegetation", to: "carbon", strength: 0.28 },
  { from: "vegetation", to: "methane", strength: 0.22 },
  { from: "vegetation", to: "nitrogen", strength: 0.26 },
  { from: "vegetation", to: "fauna", strength: 0.86 },
  { from: "climate", to: "fauna", strength: 0.55 },
  { from: "fauna", to: "vegetation", strength: 0.22 },
  { from: "climate", to: "evolution", strength: 0.50 },
  { from: "vegetation", to: "evolution", strength: 0.52 },
  { from: "fauna", to: "evolution", strength: 0.62 },
  { from: "evolution", to: "fauna", strength: 0.34 },
  { from: "vegetation", to: "hominins", strength: 0.55 },
  { from: "fauna", to: "hominins", strength: 0.44 },
  { from: "evolution", to: "hominins", strength: 0.24 },
  { from: "climate", to: "hominins", strength: 0.40 },
  { from: "magnetism", to: "hominins", strength: 0.05 }
]);

const SENSITIVITY = Object.freeze({
  orbit: 0.92, geology: 0.54, tectonics: 0.72, carbon: 0.94, methane: 0.82, nitrogen: 0.76,
  climate: 1.00, ocean: 0.92, ice: 0.95, seaLevel: 0.72, hydrology: 0.88,
  vegetation: 0.84, fauna: 0.64, evolution: 0.66, hominins: 0.66, magnetism: 0.24
});

const COMPUTE_COST = Object.freeze({
  orbit: 0.12, geology: 0.16, tectonics: 0.34, carbon: 0.36, methane: 0.24, nitrogen: 0.28,
  climate: 1.00, ocean: 0.48, ice: 0.82, seaLevel: 0.34, hydrology: 0.72,
  vegetation: 0.64, fauna: 0.72, evolution: 0.78, hominins: 0.88, magnetism: 0.42
});

function localUncertaintyFor(node, state) {
  if (node.id === "seaLevel" && Number.isFinite(state?.seaLevelUncertainty)) {
    return clamp01(0.18 + state.seaLevelUncertainty / 45);
  }
  if (["climate", "hydrology", "vegetation", "ocean", "tectonics", "fauna", "evolution", "hominins"].includes(node.id)) {
    const elapsed = clamp01((state?.elapsedYears ?? 0) / 777_000);
    const divergencePenalty = node.id === "climate" ? 0.18
      : node.id === "hydrology" ? 0.24
        : node.id === "vegetation" ? 0.22
          : node.id === "ocean" ? 0.18
            : node.id === "tectonics" ? 0.12
              : 0.16;
    return clamp01(node.localUncertainty + elapsed * divergencePenalty);
  }
  return node.localUncertainty;
}

function activityFor(id, state) {
  switch (id) {
    case "geology": return clamp01(0.35 + Math.abs((state?.geologicActivityIndex ?? 1) - 1) * 0.8);
    case "tectonics": return clamp01(0.38 + Math.abs((state?.tectonicBoundaryActivity ?? 1) - 1) * 0.7 + (state?.elapsedYears ?? 0) / 2_000_000);
    case "carbon": return clamp01(0.45 + Math.abs(Math.log(Math.max(1e-6, (state?.co2 ?? 245) / 245))) * 1.4);
    case "methane": return clamp01(0.42 + Math.abs(Math.log(Math.max(1e-6, (state?.methane ?? 631) / 631))) * 1.2);
    case "nitrogen": return clamp01(0.40 + Math.abs(Math.log(Math.max(1e-6, (state?.nitrousOxide ?? 270) / 270))) * 1.4);
    case "climate": return clamp01(0.55 + Math.abs((state?.temperatureAnomaly ?? -1.27) + 1.27) / 5);
    case "ocean": return clamp01(0.42 + Math.abs((state?.oceanTemperatureAnomaly ?? -1.27) + 1.27) / 4 + Math.abs((state?.oceanOverturningIndex ?? 1) - 1) * 0.35);
    case "ice": return clamp01(0.45 + Math.abs((state?.iceIndex ?? 0.18) - 0.18));
    case "seaLevel": return clamp01(0.45 + Math.abs((state?.seaLevel ?? -12.76) + 12.76) / 140);
    case "hydrology": return clamp01(0.48 + Math.abs((state?.temperatureAnomaly ?? -1.27) + 1.27) / 7 + Math.abs((state?.iceIndex ?? 0.18) - 0.18) * 0.35);
    case "vegetation": return clamp01(0.50 + Math.abs(Math.log(Math.max(1e-6, state?.productivityIndex ?? 1))) * 0.8);
    case "fauna": return clamp01(0.45 + Math.abs(Math.log(Math.max(1e-6, state?.animalBiomass ?? 1))) * 0.7 + Math.min(0.2, state?.predationPressureIndex ?? 0) * 0.25);
    case "evolution": return clamp01(0.42 + Math.min(0.45, (state?.speciesRichness ?? 12) / 80) + Math.min(0.25, state?.evolutionaryNoveltyIndex ?? 0));
    case "hominins": return clamp01(0.42 + Math.abs(Math.log(Math.max(1e-6, state?.homininPopulationIndex ?? 1))) * 0.55 + Math.min(0.2, (state?.homininSpeciesRichness ?? 2) / 20));
    case "magnetism": return clamp01(0.28 + Math.abs(1 - (state?.magneticStrength ?? 1)) * 0.72);
    default: return 0.55;
  }
}

export function createEarth777CausalGraph(state = {}) {
  return new CausalDependencyGraph({
    nodes: BASE_NODES.map((node) => ({ ...node, localUncertainty: localUncertaintyFor(node, state) })),
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
    policy: "consequence-weighted-fidelity-v3",
    epistemicStatus: "simulation policy metadata; not a scientific measurement",
    graphConverged: analysis.converged,
    graphIterations: analysis.iterations,
    budget: Math.max(0, Number(budget) || 0),
    targets: allocateFidelityBudget(targets, { budget })
  });
}
