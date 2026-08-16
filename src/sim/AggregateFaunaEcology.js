import { feedingProfileForLineage } from "./EvolutionaryEcology.js";
import { projectAnimalPopulation } from "./AnimalPopulationProjection.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const clamp01 = (value) => clamp(value, 0, 1);
const positive = (value, floor = 1e-9) => Math.max(floor, Number(value) || 0);
const relax = (current, target, dtYears, tauYears) => current + (target - current) * (1 - Math.exp(-dtYears / tauYears));

const plantMatterWeight = (lineage) => feedingProfileForLineage(lineage).plantMatterAffinity;
const livePreyWeight = (lineage) => feedingProfileForLineage(lineage).livePreyAffinity;

function livingLineages(state) {
  return (state?.speciesLineages ?? []).filter((lineage) => lineage.extinctionYearBP == null && Number(lineage.populationIndex) > 0);
}

function lineageWeight(lineage, weightForLineage) {
  return Math.max(0, Number(lineage.populationIndex) || 0) * clamp01(weightForLineage(lineage));
}

function meanLineageTrait(state, weightForLineage, key, fallback = 0.5) {
  const lineages = livingLineages(state);
  const total = lineages.reduce((sum, lineage) => sum + lineageWeight(lineage, weightForLineage), 0);
  if (total <= 0) return fallback;
  return lineages.reduce((sum, lineage) => sum
    + clamp01(lineage[key]) * lineageWeight(lineage, weightForLineage), 0) / total;
}

function meanLineageBodyMassLog10Kg(state, weightForLineage, fallback = 0.4) {
  const lineages = livingLineages(state);
  const total = lineages.reduce((sum, lineage) => sum + lineageWeight(lineage, weightForLineage), 0);
  if (total <= 0) return fallback;
  return lineages.reduce((sum, lineage) => sum
    + clamp(lineage.bodyMassLog10Kg, -0.5, 3.5) * lineageWeight(lineage, weightForLineage), 0) / total;
}

function meanLineageThermalAdaptation(state, weightForLineage, fallback = 1) {
  const temperature = Number(state?.temperatureAnomaly);
  if (!Number.isFinite(temperature)) return fallback;
  const lineages = livingLineages(state).filter((lineage) => Number.isFinite(Number(lineage.thermalOptimumK)));
  const total = lineages.reduce((sum, lineage) => sum + lineageWeight(lineage, weightForLineage), 0);
  if (total <= 0) return fallback;
  return lineages.reduce((sum, lineage) => {
    const fit = Math.exp(-0.12 * (temperature - Number(lineage.thermalOptimumK)) ** 2);
    return sum + fit * lineageWeight(lineage, weightForLineage);
  }, 0) / total;
}

export function aggregateFeedingShares(state = {}) {
  const projection = projectAnimalPopulation(state);
  if (projection.totalPopulationIndex <= 0) {
    return Object.freeze({ plantMatterShare: 0.5, livePreyShare: 0.5 });
  }
  return Object.freeze({
    plantMatterShare: projection.plantFeedingFraction,
    livePreyShare: projection.livePreyFeedingFraction
  });
}

function storedFeedingShares(state) {
  const plantMatterShare = Number(state?.animalPlantMatterShare);
  const livePreyShare = Number(state?.animalLivePreyShare);
  if (!Number.isFinite(plantMatterShare) || !Number.isFinite(livePreyShare)) return null;
  const plant = clamp01(plantMatterShare);
  const live = clamp01(livePreyShare);
  const total = plant + live;
  if (total <= 1e-12) return null;
  return { plantMatterShare: plant / total, livePreyShare: live / total };
}

function setProjectionFields(state, shares) {
  const animalBiomass = positive(state.animalBiomass, 0.001);
  state.animalPlantMatterShare = shares.plantMatterShare;
  state.animalLivePreyShare = shares.livePreyShare;
  state.animalPlantMatterBiomass = animalBiomass * shares.plantMatterShare;
  state.animalLivePreyBiomass = animalBiomass * shares.livePreyShare;

  // Compatibility projections only. These are no longer independent state
  // owners and always partition the one authoritative aggregate biomass.
  state.herbivoreBiomass = state.animalPlantMatterBiomass;
  state.carnivoreBiomass = state.animalLivePreyBiomass;
  return shares;
}

export function initializeAggregateFauna(state = {}) {
  if (!Number.isFinite(Number(state.animalBiomass))) {
    const legacyPlant = Math.max(0, Number(state.herbivoreBiomass) || 0);
    const legacyLive = Math.max(0, Number(state.carnivoreBiomass) || 0);
    const legacyTotal = legacyPlant + legacyLive;
    // Old herbivore/carnivore values were independent normalized indices, not
    // additive physical pools. Their mean preserves the old 1 + 1 baseline as
    // one normalized aggregate rather than double-counting it as 2.
    state.animalBiomass = legacyTotal > 0 ? legacyTotal / 2 : 1;
  }
  const shares = storedFeedingShares(state) ?? aggregateFeedingShares(state);
  setProjectionFields(state, shares);
  return state;
}

export function syncAggregateFaunaProjections(state = {}, { acceptLegacyInput = false, preserveShares = false } = {}) {
  // Capture compatibility fields before initialization reasserts the derived
  // projections, otherwise an intentional legacy write would be invisible.
  const incomingAnimalBiomass = Number(state.animalBiomass);
  const hadAggregateBiomass = Number.isFinite(incomingAnimalBiomass);
  const incomingLegacyPlant = Math.max(0, Number(state.herbivoreBiomass) || 0);
  const incomingLegacyLive = Math.max(0, Number(state.carnivoreBiomass) || 0);
  const incomingShares = storedFeedingShares(state);

  initializeAggregateFauna(state);
  const previousShares = incomingShares ?? storedFeedingShares(state) ?? aggregateFeedingShares(state);
  let shares = preserveShares ? previousShares : aggregateFeedingShares(state);

  if (acceptLegacyInput && hadAggregateBiomass) {
    const expectedPlant = positive(incomingAnimalBiomass, 0.001) * previousShares.plantMatterShare;
    const expectedLive = positive(incomingAnimalBiomass, 0.001) * previousShares.livePreyShare;
    const changedExternally = Math.abs(incomingLegacyPlant - expectedPlant) > 1e-9 || Math.abs(incomingLegacyLive - expectedLive) > 1e-9;
    const legacyTotal = incomingLegacyPlant + incomingLegacyLive;

    if (changedExternally && legacyTotal > 0) {
      // Transitional compatibility bridge for callers/tests that still set the
      // legacy projections directly. Once ingested, the projections immediately
      // return to being read-only views of the unified biomass.
      state.animalBiomass = legacyTotal;
      shares = { plantMatterShare: incomingLegacyPlant / legacyTotal, livePreyShare: incomingLegacyLive / legacyTotal };
    }
  }

  return setProjectionFields(state, shares);
}

export function updateAggregateGrazingPressure(state = {}) {
  syncAggregateFaunaProjections(state, { preserveShares: true });
  const plantMatterBiomass = Math.max(0, Number(state.animalPlantMatterBiomass) || 0);
  const plantDietBreadth = meanLineageTrait(state, plantMatterWeight, "dietBreadth");
  const grazingPressure = clamp(
    plantMatterBiomass / (plantMatterBiomass + 1.25) * (1 - plantDietBreadth * 0.26),
    0,
    1
  );
  state.grazingPressureIndex = grazingPressure;
  state.animalPlantDietBreadthIndex = plantDietBreadth;
  state.herbivoreDietBreadthIndex = plantDietBreadth;
  return grazingPressure;
}

function applyAggregatePredation(state, dtYears) {
  const plantMatterBiomass = Math.max(0, Number(state.animalPlantMatterBiomass) || 0);
  const livePreyBiomass = Math.max(0, Number(state.animalLivePreyBiomass) || 0);
  const predatorMobility = meanLineageTrait(state, livePreyWeight, "mobility");
  const predatorCognition = meanLineageTrait(state, livePreyWeight, "cognition");
  const predatorDietBreadth = meanLineageTrait(state, livePreyWeight, "dietBreadth");
  const preyMobility = meanLineageTrait(state, plantMatterWeight, "mobility");
  const preySociality = meanLineageTrait(state, plantMatterWeight, "sociality");
  const preyCognition = meanLineageTrait(state, plantMatterWeight, "cognition");
  const predatorBodyMassLog10Kg = meanLineageBodyMassLog10Kg(state, livePreyWeight);
  const preyBodyMassLog10Kg = meanLineageBodyMassLog10Kg(state, plantMatterWeight);
  const huntingEffectiveness = clamp(0.22 + predatorMobility * 0.46 + predatorCognition * 0.32, 0.05, 1);
  const escapeEffectiveness = clamp(0.18 + preyMobility * 0.38 + preySociality * 0.28 + preyCognition * 0.16, 0.05, 1);
  const massMismatch = Math.abs((preyBodyMassLog10Kg - predatorBodyMassLog10Kg) - 0.45);
  const massCompatibility = Math.exp(-0.55 * massMismatch * (1 - predatorDietBreadth * 0.52));
  const preyAvailability = plantMatterBiomass / (plantMatterBiomass + 0.28);
  const pressure = livePreyBiomass * preyAvailability * huntingEffectiveness * massCompatibility * (1 - escapeEffectiveness * 0.72);
  const lossRatePerYear = pressure * 0.012;
  const loss = plantMatterBiomass * (1 - Math.exp(-Math.max(0, dtYears) * lossRatePerYear));

  // Predation mortality now changes the one aggregate animal pool. Feeding
  // composition is subsequently re-projected from the evolving lineage mix.
  state.animalBiomass = positive(state.animalBiomass - loss, 0.001);
  state.predationPressureIndex = pressure;
  state.predationExposureIndex = clamp(relax(
    clamp(state.predationExposureIndex ?? 0, 0, 3),
    pressure,
    Math.max(0, dtYears),
    110
  ), 0, 3);
  state.predationMassCompatibilityIndex = massCompatibility;
  state.predationAnimalLossPerYear = loss / Math.max(1e-9, dtYears);
  state.predationHerbivoreLossPerYear = state.predationAnimalLossPerYear;
}

export function advanceAggregateFauna(state = {}, dtYears = 0, { baselineIceIndex = 0.18 } = {}) {
  const dt = Math.max(0, Number(dtYears) || 0);
  if (dt <= 0) return state;
  syncAggregateFaunaProjections(state, { preserveShares: true });

  const plantMatterShare = clamp01(state.animalPlantMatterShare ?? 0.5);
  const livePreyShare = clamp01(state.animalLivePreyShare ?? 0.5);
  const plantThermalAdaptation = meanLineageThermalAdaptation(state, plantMatterWeight);
  const livePreyThermalAdaptation = meanLineageThermalAdaptation(state, livePreyWeight);
  state.animalPlantMatterThermalAdaptationIndex = plantThermalAdaptation;
  state.animalLivePreyThermalAdaptationIndex = livePreyThermalAdaptation;
  state.herbivoreThermalAdaptationIndex = plantThermalAdaptation;
  state.carnivoreThermalAdaptationIndex = livePreyThermalAdaptation;

  const productivity = positive(state.productivityIndex, 0.01);
  const plantSupportedCapacity = positive(
    productivity * Math.exp(-0.16 * ((state.iceIndex ?? baselineIceIndex) - baselineIceIndex))
      * (0.42 + plantThermalAdaptation * 0.58),
    0.01
  );
  const livePreySupportedCapacity = positive(
    Math.max(0.001, Number(state.animalPlantMatterBiomass) || 0) ** 0.92
      * productivity ** 0.08
      * (0.42 + livePreyThermalAdaptation * 0.58),
    0.001
  );
  const aggregateCapacity = positive(
    plantMatterShare * plantSupportedCapacity + livePreyShare * livePreySupportedCapacity,
    0.001
  );
  const ecologicalTau = plantMatterShare * 34 + livePreyShare * 48;

  state.animalCarryingCapacityIndex = aggregateCapacity;
  state.animalBiomass = positive(relax(state.animalBiomass, aggregateCapacity, dt, ecologicalTau), 0.001);
  syncAggregateFaunaProjections(state, { preserveShares: true });
  applyAggregatePredation(state, dt);
  syncAggregateFaunaProjections(state, { preserveShares: true });
  return state;
}
