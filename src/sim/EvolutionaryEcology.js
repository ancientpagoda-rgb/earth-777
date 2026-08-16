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

function initialLineage(seed, index) {
  const trophicLevel = 0.08 + unit(seed, index, 0x9e3779b1) * 0.86;
  const bodyMassLog10Kg = -0.3 + unit(seed, index, 0x85ebca77) * 3.7;
  return {
    id: index + 1,
    parentId: null,
    birthYearBP: 777000,
    extinctionYearBP: null,
    populationIndex: 0.18 + unit(seed, index, 0xc2b2ae3d) * 0.72,
    trophicLevel,
    bodyMassLog10Kg,
    thermalOptimumK: -2.4 + unit(seed, index, 0x27d4eb2f) * 5.5,
    mobility: 0.18 + unit(seed, index, 0x165667b1) * 0.72,
    sociality: 0.08 + unit(seed, index, 0xd3a2646c) * 0.70,
    cognition: 0.04 + unit(seed, index, 0xfd7046c5) * 0.42,
    dietBreadth: 0.12 + unit(seed, index, 0xb55a4f09) * 0.74,
    divergence: unit(seed, index, 0x94d049bb) * 0.25
  };
}

export const EVOLUTIONARY_ECOLOGY_POLICY = "energy-limited-open-lineage-evolution-v4";

export function initializeEvolutionaryEcology(state, seed = 777001) {
  if (!Array.isArray(state.speciesLineages)) {
    state.speciesLineages = Array.from({ length: 12 }, (_, index) => initialLineage(seed, index));
  }
  state.nextSpeciesId ??= state.speciesLineages.reduce((max, lineage) => Math.max(max, Number(lineage.id) || 0), 0) + 1;
  state.speciesRichness ??= state.speciesLineages.length;
  state.evolutionaryNoveltyIndex ??= 0;
  state.meanSpeciesCognitionIndex ??= state.speciesLineages.reduce((sum, lineage) => sum + lineage.cognition, 0) / Math.max(1, state.speciesLineages.length);
  return state;
}

function resourceSupport(state, lineage) {
  const productivity = positive(state.productivityIndex ?? 1, 0.001);
  const herbivory = 1 - lineage.trophicLevel;
  const predation = lineage.trophicLevel;
  const plantSupport = productivity ** (0.35 + herbivory * 0.65);
  const preySupport = positive(state.herbivoreBiomass ?? 1, 0.001) ** (predation * 0.82);
  const carrionSupport = positive(state.carnivoreBiomass ?? 1, 0.001) ** (predation * 0.12 * lineage.dietBreadth);
  return plantSupport * preySupport * carrionSupport;
}

function nicheCompetition(lineage, lineages) {
  let overlap = 0;
  for (const other of lineages) {
    if (other === lineage || other.extinctionYearBP != null || other.populationIndex <= 1e-8) continue;
    const trophicDistance = Math.abs(other.trophicLevel - lineage.trophicLevel);
    const bodyDistance = Math.abs(other.bodyMassLog10Kg - lineage.bodyMassLog10Kg) / 2.5;
    const thermalDistance = Math.abs(other.thermalOptimumK - lineage.thermalOptimumK) / 6;
    const similarity = Math.exp(-(trophicDistance * 4 + bodyDistance * 2 + thermalDistance * 1.5));
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

  // Trophic level is a continuous feeding phenotype, not a predator/prey class.
  // Low-trophic lineages experience more exposure to predation, while higher-
  // trophic lineages gain more from hunting capability. Intermediate feeders
  // can experience both effects without crossing an arbitrary role threshold.
  const animalFoodDependence = clamp01(lineage.trophicLevel);
  const plantFoodDependence = 1 - animalFoodDependence;
  const evasion = clamp01(0.18 + clamp01(lineage.mobility) * 0.35 + clamp01(lineage.sociality) * 0.27 + clamp01(lineage.cognition) * 0.20);
  const hunting = clamp01(0.20 + clamp01(lineage.mobility) * 0.45 + clamp01(lineage.cognition) * 0.35);
  const exposureCost = Math.exp(-pressure * 0.18 * (1 - evasion) * plantFoodDependence);
  const huntingBenefit = 1 + pressure * 0.09 * hunting * animalFoodDependence;
  return exposureCost * huntingBenefit;
}

function mutate(parent, childId, state, random) {
  const centered = () => (random() + random() + random() - 1.5) / 1.5;
  return {
    id: childId,
    parentId: parent.id,
    birthYearBP: Math.round(state.yearBP),
    extinctionYearBP: null,
    populationIndex: parent.populationIndex * 0.34,
    trophicLevel: clamp01(parent.trophicLevel + centered() * 0.09),
    bodyMassLog10Kg: parent.bodyMassLog10Kg + centered() * 0.24,
    thermalOptimumK: parent.thermalOptimumK + centered() * 0.55,
    mobility: clamp01(parent.mobility + centered() * 0.10),
    sociality: clamp01(parent.sociality + centered() * 0.08),
    cognition: clamp01(parent.cognition + centered() * 0.045),
    dietBreadth: clamp01(parent.dietBreadth + centered() * 0.11),
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
