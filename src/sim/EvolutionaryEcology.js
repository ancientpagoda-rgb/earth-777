const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const positive = (value, floor = 1e-9) => Math.max(floor, Number(value) || 0);
const relax = (current, target, dtYears, tauYears) => current + (target - current) * (1 - Math.exp(-dtYears / tauYears));

function hash32(value) {
  let x = Number(value) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function unit(seed, index, salt) {
  return hash32((Number(seed) >>> 0) ^ Math.imul(index + 1, salt)) / 0x100000000;
}

function legacyFeedingAffinities(lineage = {}) {
  const trophicLevel = clamp01(lineage.trophicLevel ?? 0.5);
  const dietBreadth = clamp01(lineage.dietBreadth ?? 0.5);
  return {
    plantMatterAffinity: 1 - trophicLevel,
    livePreyAffinity: trophicLevel,
    carrionAffinity: trophicLevel * dietBreadth
  };
}

export function feedingProfileForLineage(lineage = {}) {
  const legacy = legacyFeedingAffinities(lineage);
  const plantMatterAffinity = Number.isFinite(Number(lineage.plantMatterAffinity))
    ? clamp01(lineage.plantMatterAffinity)
    : legacy.plantMatterAffinity;
  const livePreyAffinity = Number.isFinite(Number(lineage.livePreyAffinity))
    ? clamp01(lineage.livePreyAffinity)
    : legacy.livePreyAffinity;
  const carrionAffinity = Number.isFinite(Number(lineage.carrionAffinity))
    ? clamp01(lineage.carrionAffinity)
    : legacy.carrionAffinity;
  const primaryFoodTotal = plantMatterAffinity + livePreyAffinity;
  const trophicLevel = primaryFoodTotal > 1e-12
    ? livePreyAffinity / primaryFoodTotal
    : clamp01(lineage.trophicLevel ?? 0.5);
  return Object.freeze({ plantMatterAffinity, livePreyAffinity, carrionAffinity, trophicLevel });
}

function ensureFeedingProfile(lineage) {
  const profile = feedingProfileForLineage(lineage);
  lineage.plantMatterAffinity ??= profile.plantMatterAffinity;
  lineage.livePreyAffinity ??= profile.livePreyAffinity;
  lineage.carrionAffinity ??= profile.carrionAffinity;
  lineage.trophicLevel = feedingProfileForLineage(lineage).trophicLevel;
  return lineage;
}

function initialLineage(seed, index) {
  const trophicLevel = 0.08 + unit(seed, index, 0x9e3779b1) * 0.86;
  const bodyMassLog10Kg = -0.3 + unit(seed, index, 0x85ebca77) * 3.7;
  const dietBreadth = 0.12 + unit(seed, index, 0xb55a4f09) * 0.74;
  return {
    id: index + 1,
    parentId: null,
    birthYearBP: 777000,
    extinctionYearBP: null,
    populationIndex: 0.18 + unit(seed, index, 0xc2b2ae3d) * 0.72,
    trophicLevel,
    plantMatterAffinity: 1 - trophicLevel,
    livePreyAffinity: trophicLevel,
    carrionAffinity: trophicLevel * dietBreadth,
    bodyMassLog10Kg,
    thermalOptimumK: -2.4 + unit(seed, index, 0x27d4eb2f) * 5.5,
    mobility: 0.18 + unit(seed, index, 0x165667b1) * 0.72,
    sociality: 0.08 + unit(seed, index, 0xd3a2646c) * 0.70,
    cognition: 0.04 + unit(seed, index, 0xfd7046c5) * 0.42,
    dietBreadth,
    divergence: unit(seed, index, 0x94d049bb) * 0.25
  };
}

export const EVOLUTIONARY_ECOLOGY_POLICY = "energy-limited-open-lineage-evolution-v5";

export function initializeEvolutionaryEcology(state, seed = 777001) {
  if (!Array.isArray(state.speciesLineages)) {
    state.speciesLineages = Array.from({ length: 12 }, (_, index) => initialLineage(seed, index));
  }
  for (const lineage of state.speciesLineages) ensureFeedingProfile(lineage);
  state.nextSpeciesId ??= state.speciesLineages.reduce((max, lineage) => Math.max(max, Number(lineage.id) || 0), 0) + 1;
  state.speciesRichness ??= state.speciesLineages.length;
  state.evolutionaryNoveltyIndex ??= 0;
  state.meanSpeciesCognitionIndex ??= state.speciesLineages.reduce((sum, lineage) => sum + lineage.cognition, 0) / Math.max(1, state.speciesLineages.length);
  return state;
}

function resourceSupport(state, lineage) {
  const productivity = positive(state.productivityIndex ?? 1, 0.001);
  const feeding = feedingProfileForLineage(lineage);
  const legacyPlantBiomass = Math.max(0, Number(state.herbivoreBiomass) || 0);
  const legacyLivePreyBiomass = Math.max(0, Number(state.carnivoreBiomass) || 0);
  const legacyAnimalBiomass = ((legacyPlantBiomass + legacyLivePreyBiomass) / 2) || 1;
  const plantMatterBiomass = positive(
    state.animalPlantMatterBiomass ?? state.herbivoreBiomass ?? state.animalBiomass ?? 1,
    0.001
  );
  const animalBiomass = positive(state.animalBiomass ?? legacyAnimalBiomass, 0.001);
  const plantSupport = productivity ** (0.35 + feeding.plantMatterAffinity * 0.65);
  const preySupport = plantMatterBiomass ** (feeding.livePreyAffinity * 0.82);
  // Carrion can originate from any animal. Total animal biomass is therefore
  // the substrate proxy; carrion affinity is a resource tendency, not a
  // separate scavenger population or an implication of active pursuit.
  const carrionSupport = animalBiomass ** (feeding.carrionAffinity * 0.12);
  return plantSupport * preySupport * carrionSupport;
}

function nicheCompetition(lineage, lineages) {
  let overlap = 0;
  const feeding = feedingProfileForLineage(lineage);
  for (const other of lineages) {
    if (other === lineage || other.extinctionYearBP != null || other.populationIndex <= 1e-8) continue;
    const otherFeeding = feedingProfileForLineage(other);
    // Preserve roughly the old pure-plant ↔ pure-live-prey separation while
    // allowing carrion specialization to create an independent niche axis.
    const feedingDistance = clamp01(Math.hypot(
      otherFeeding.plantMatterAffinity - feeding.plantMatterAffinity,
      otherFeeding.livePreyAffinity - feeding.livePreyAffinity,
      otherFeeding.carrionAffinity - feeding.carrionAffinity
    ) / Math.SQRT2);
    const bodyDistance = Math.abs(other.bodyMassLog10Kg - lineage.bodyMassLog10Kg) / 2.5;
    const thermalDistance = Math.abs(other.thermalOptimumK - lineage.thermalOptimumK) / 6;
    const similarity = Math.exp(-(feedingDistance * 4 + bodyDistance * 2 + thermalDistance * 1.5));
    overlap += similarity * positive(other.populationIndex, 0);
  }
  return overlap;
}

function predationSelectionFeedback(state, lineage) {
  const currentPressure = Math.max(0, Number(state.predationPressureIndex) || 0);
  const residualExposure = Math.max(0, (Number(state.predationExposureIndex) || 0) - currentPressure);
  // FreeEarthEngine owns the lagged aggregate exposure. Evolution only reads
  // the residual while it decays, preserving the instantaneous effect while
  // avoiding a second writer or a camera-dependent history.
  const pressure = currentPressure + residualExposure * 0.35;
  if (pressure <= 0) return 1;

  const feeding = feedingProfileForLineage(lineage);
  const primaryFoodTotal = feeding.plantMatterAffinity + feeding.livePreyAffinity;
  const plantFoodDependence = primaryFoodTotal > 1e-12
    ? feeding.plantMatterAffinity / primaryFoodTotal
    : 0;
  const livePreyDependence = primaryFoodTotal > 1e-12
    ? feeding.livePreyAffinity / primaryFoodTotal
    : 0;
  // Carrion affinity is independent: scavenging alone neither creates active
  // hunting benefit nor makes a lineage prey-exposed in this aggregate term.
  const evasion = clamp01(0.18 + clamp01(lineage.mobility) * 0.35 + clamp01(lineage.sociality) * 0.27 + clamp01(lineage.cognition) * 0.20);
  const hunting = clamp01(0.20 + clamp01(lineage.mobility) * 0.45 + clamp01(lineage.cognition) * 0.35);
  const exposureCost = Math.exp(-pressure * 0.18 * (1 - evasion) * plantFoodDependence);
  const huntingBenefit = 1 + pressure * 0.09 * hunting * livePreyDependence;
  return exposureCost * huntingBenefit;
}

function mutate(parent, childId, state, random) {
  const centered = () => (random() + random() + random() - 1.5) / 1.5;
  const feeding = feedingProfileForLineage(parent);
  // Keep the existing trophic mutation random draw/order for deterministic
  // compatibility of the older traits, then add carrion variation afterward.
  const trophicShift = centered() * 0.09;
  const bodyMassLog10Kg = parent.bodyMassLog10Kg + centered() * 0.24;
  const thermalOptimumK = parent.thermalOptimumK + centered() * 0.55;
  const mobility = clamp01(parent.mobility + centered() * 0.10);
  const sociality = clamp01(parent.sociality + centered() * 0.08);
  const cognition = clamp01(parent.cognition + centered() * 0.045);
  const dietBreadth = clamp01(parent.dietBreadth + centered() * 0.11);
  const carrionShift = centered() * 0.09;
  const plantMatterAffinity = clamp01(feeding.plantMatterAffinity - trophicShift);
  const livePreyAffinity = clamp01(feeding.livePreyAffinity + trophicShift);
  const carrionAffinity = clamp01(feeding.carrionAffinity + carrionShift);
  const primaryFoodTotal = plantMatterAffinity + livePreyAffinity;
  const trophicLevel = primaryFoodTotal > 1e-12 ? livePreyAffinity / primaryFoodTotal : feeding.trophicLevel;
  return {
    id: childId,
    parentId: parent.id,
    birthYearBP: Math.round(state.yearBP),
    extinctionYearBP: null,
    populationIndex: parent.populationIndex * 0.34,
    trophicLevel,
    plantMatterAffinity,
    livePreyAffinity,
    carrionAffinity,
    bodyMassLog10Kg,
    thermalOptimumK,
    mobility,
    sociality,
    cognition,
    dietBreadth,
    divergence: 0
  };
}

export function advanceEvolutionaryEcology(state, dtYears, random = Math.random) {
  initializeEvolutionaryEcology(state, state.seed ?? 777001);
  const dt = Math.max(0, Number(dtYears) || 0);
  if (dt <= 0) return state;
  const lineages = state.speciesLineages;
  const temperature = Number(state.temperatureAnomaly ?? -1.27);
  const climateVariability = Math.min(3, Math.abs(Number(state.greenhouseForcing) || 0) * 0.14 + Math.abs((state.iceIndex ?? 0.18) - 0.18) * 1.8);
  const children = [];
  let novelty = 0;

  for (const lineage of lineages) {
    if (lineage.extinctionYearBP != null) continue;
    const thermalFitness = Math.exp(-0.09 * (temperature - lineage.thermalOptimumK) ** 2);
    const support = resourceSupport(state, lineage);
    const competition = nicheCompetition(lineage, lineages);
    const breadthBuffer = 0.62 + lineage.dietBreadth * 0.76;
    const mobilityBuffer = 0.72 + lineage.mobility * climateVariability * 0.22;
    const predationFeedback = predationSelectionFeedback(state, lineage);
    const carryingCapacity = positive(support * thermalFitness * breadthBuffer * mobilityBuffer * predationFeedback / (0.55 + competition * 0.42), 1e-8);
    const ecologicalTau = 46 + 110 * 10 ** Math.max(-0.5, lineage.bodyMassLog10Kg) / 1000;
    lineage.populationIndex = positive(relax(lineage.populationIndex, carryingCapacity, dt, ecologicalTau), 1e-12);

    const selectionRate = 1 - Math.exp(-dt / (18_000 + 9_000 * 10 ** Math.max(-0.5, lineage.bodyMassLog10Kg) / 100));
    lineage.thermalOptimumK += (temperature - lineage.thermalOptimumK) * selectionRate * 0.55;
    lineage.mobility = clamp01(lineage.mobility + (climateVariability / (1 + climateVariability) - lineage.mobility) * selectionRate * 0.22);
    const cognitionTarget = clamp01(0.08 + lineage.sociality * 0.34 + lineage.dietBreadth * 0.18 + climateVariability * 0.07);
    lineage.cognition = clamp01(lineage.cognition + (cognitionTarget - lineage.cognition) * selectionRate * 0.20);
    lineage.sociality = clamp01(lineage.sociality + (lineage.cognition * 0.62 - lineage.sociality) * selectionRate * 0.08);

    const selectionStress = Math.abs(Math.log(Math.max(1e-8, carryingCapacity / positive(lineage.populationIndex, 1e-8))));
    lineage.divergence += dt / 95_000 * (0.45 + climateVariability * 0.35 + selectionStress * 0.12);
    novelty += lineage.divergence * lineage.populationIndex;

    const speciationHazard = dt / 135_000
      * (lineage.populationIndex / (0.35 + lineage.populationIndex))
      * (0.35 + lineage.divergence)
      * (0.55 + climateVariability * 0.18);
    if (lineage.populationIndex > 0.055 && lineage.divergence > 0.35 && random() < speciationHazard) {
      const child = mutate(lineage, state.nextSpeciesId++, state, random);
      lineage.populationIndex *= 0.66;
      lineage.divergence *= 0.28;
      children.push(child);
    }

    if (lineage.populationIndex < 1e-7 && (777000 - Number(lineage.birthYearBP || 777000)) > 2_500) {
      lineage.extinctionYearBP = Math.round(state.yearBP);
      lineage.populationIndex = 0;
    }
  }

  if (children.length) lineages.push(...children);
  const living = lineages.filter((lineage) => lineage.extinctionYearBP == null && lineage.populationIndex > 0);
  state.speciesRichness = living.length;
  const totalPopulation = living.reduce((sum, lineage) => sum + lineage.populationIndex, 0);
  state.evolutionaryNoveltyIndex = totalPopulation > 0 ? novelty / totalPopulation : 0;
  state.meanSpeciesCognitionIndex = totalPopulation > 0
    ? living.reduce((sum, lineage) => sum + lineage.cognition * lineage.populationIndex, 0) / totalPopulation
    : 0;
  return state;
}
