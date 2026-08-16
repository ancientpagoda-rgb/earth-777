import { checkpointState, CHECKPOINT_777 } from "../data/checkpoint-777.js";
import { paleoForcingAt } from "../data/paleo-forcing.js";
import { AdaptiveFidelityController } from "./AdaptiveFidelityController.js";
import {
  BIOGEOCHEMISTRY_BASELINE,
  advanceCarbonCycle,
  advanceMethaneCycle,
  advanceNitrogenCycle,
  initializeBiogeochemistry,
  syncAtmosphereFromReservoirs
} from "./EarthBiogeochemistry.js";
import { advanceGeologicActivity, advanceLithosphere, initializeLithosphere } from "./DynamicLithosphere.js";
import { advanceOceanCirculation, initializeOceanCirculation } from "./SpatialOceanCirculation.js";
import { advanceEvolutionaryEcology, initializeEvolutionaryEcology } from "./EvolutionaryEcology.js";
import { advanceHomininLineages, initializeHomininLineages } from "./HomininLineages.js";
import { createRandom, gaussian } from "./random.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const positive = (value, floor = 1e-9) => Math.max(floor, Number(value) || 0);
const round = (value, digits = 4) => Number(value.toFixed(digits));
const relax = (current, target, dtYears, tauYears) => current + (target - current) * (1 - Math.exp(-dtYears / tauYears));

function meanLineageTrait(state, predicate, key, fallback = 0.5) {
  const lineages = (state.speciesLineages ?? []).filter((lineage) => lineage.extinctionYearBP == null && predicate(lineage));
  const total = lineages.reduce((sum, lineage) => sum + Math.max(0, Number(lineage.populationIndex) || 0), 0);
  if (total <= 0) return fallback;
  return lineages.reduce((sum, lineage) => sum + clamp(Number(lineage[key]) || 0, 0, 1) * Math.max(0, Number(lineage.populationIndex) || 0), 0) / total;
}

function meanLineageBodyMassLog10Kg(state, predicate, fallback = 0.4) {
  const lineages = (state.speciesLineages ?? []).filter((lineage) => lineage.extinctionYearBP == null && predicate(lineage));
  const total = lineages.reduce((sum, lineage) => sum + Math.max(0, Number(lineage.populationIndex) || 0), 0);
  if (total <= 0) return fallback;
  return lineages.reduce((sum, lineage) => sum + clamp(Number(lineage.bodyMassLog10Kg) || 0, -0.5, 3.5) * Math.max(0, Number(lineage.populationIndex) || 0), 0) / total;
}

function applyAggregatePredation(state, dtYears) {
  const herbivoreBiomass = positive(state.herbivoreBiomass, 0.001);
  const carnivoreBiomass = positive(state.carnivoreBiomass, 0.001);
  const predatorMobility = meanLineageTrait(state, (lineage) => Number(lineage.trophicLevel) >= 0.55, "mobility");
  const predatorCognition = meanLineageTrait(state, (lineage) => Number(lineage.trophicLevel) >= 0.55, "cognition");
  const preyMobility = meanLineageTrait(state, (lineage) => Number(lineage.trophicLevel) < 0.55, "mobility");
  const preySociality = meanLineageTrait(state, (lineage) => Number(lineage.trophicLevel) < 0.55, "sociality");
  const preyCognition = meanLineageTrait(state, (lineage) => Number(lineage.trophicLevel) < 0.55, "cognition");
  const predatorBodyMassLog10Kg = meanLineageBodyMassLog10Kg(state, (lineage) => Number(lineage.trophicLevel) >= 0.55);
  const preyBodyMassLog10Kg = meanLineageBodyMassLog10Kg(state, (lineage) => Number(lineage.trophicLevel) < 0.55);
  const huntingEffectiveness = clamp(0.22 + predatorMobility * 0.46 + predatorCognition * 0.32, 0.05, 1);
  const escapeEffectiveness = clamp(0.18 + preyMobility * 0.38 + preySociality * 0.28 + preyCognition * 0.16, 0.05, 1);
  const massCompatibility = Math.exp(-0.55 * Math.abs((preyBodyMassLog10Kg - predatorBodyMassLog10Kg) - 0.45));
  const preyAvailability = herbivoreBiomass / (herbivoreBiomass + 0.28);
  const pressure = carnivoreBiomass * preyAvailability * huntingEffectiveness * massCompatibility * (1 - escapeEffectiveness * 0.72);
  const lossRatePerYear = 0.003 + pressure * 0.012;
  const loss = herbivoreBiomass * (1 - Math.exp(-Math.max(0, dtYears) * lossRatePerYear));
  state.herbivoreBiomass = positive(herbivoreBiomass - loss, 0.001);
  state.predationPressureIndex = pressure;
  state.predationMassCompatibilityIndex = massCompatibility;
  state.predationHerbivoreLossPerYear = loss / Math.max(1e-9, dtYears);
}

export function stageForYearBP(yearBP) {
  const year = Math.max(0, Number(yearBP) || 0);
  if (year > 773_900) return "Late MIS 19c";
  if (year > 756_900) return "MIS 19 transition";
  if (year > 129_000) return "Middle Pleistocene";
  if (year > 11_700) return "Late Pleistocene";
  return "Holocene";
}

function orbitalSummerIndex(state) {
  return (state.obliquity - 23.3) * 0.36
    + (state.eccentricity - 0.023) * 28 * Math.cos(state.precession * Math.PI / 180);
}

export class FreeEarthEngine {
  constructor(seed = 777001, { fidelityBudget = 1, observerRelevance = {}, fidelityRefreshYears = 250 } = {}) {
    this.seed = Number(seed) >>> 0;
    this.fidelity = new AdaptiveFidelityController({ budget: fidelityBudget, observerRelevance, refreshYears: fidelityRefreshYears });
    this._resetRandomStreams();
    this.state = initializeBiogeochemistry(checkpointState());
    this.state.seed = this.seed;
    this.state.oceanTemperatureAnomaly = this.state.temperatureAnomaly;
    initializeLithosphere(this.state, this.seed);
    initializeOceanCirculation(this.state);
    initializeEvolutionaryEcology(this.state, this.seed);
    initializeHomininLineages(this.state, this.seed);
    this.state.stage = stageForYearBP(this.state.yearBP);
    this.events = [];
  }

  _resetRandomStreams() {
    this.biogeochemicalRandom = createRandom((this.seed ^ 0x9e3779b9) >>> 0);
    this.geologyRandom = createRandom((this.seed ^ 0x4cf5ad43) >>> 0);
    this.magneticRandom = createRandom((this.seed ^ 0x6a09e667) >>> 0);
    this.evolutionRandom = createRandom((this.seed ^ 0xbb67ae85) >>> 0);
    this.homininRandom = createRandom((this.seed ^ 0x3c6ef372) >>> 0);
  }

  reset(seed = this.seed) {
    this.seed = Number(seed) >>> 0;
    this._resetRandomStreams();
    this.fidelity.reset();
    this.state = initializeBiogeochemistry(checkpointState());
    this.state.seed = this.seed;
    this.state.oceanTemperatureAnomaly = this.state.temperatureAnomaly;
    initializeLithosphere(this.state, this.seed);
    initializeOceanCirculation(this.state);
    initializeEvolutionaryEcology(this.state, this.seed);
    initializeHomininLineages(this.state, this.seed);
    this.state.stage = stageForYearBP(this.state.yearBP);
    this.events = [];
    return this.snapshot();
  }

  setFidelityBudget(budget) { this.fidelity.setBudget(budget); return this.fidelityDiagnostics(); }
  setObserverRelevance(observerRelevance = {}) { this.fidelity.setObserverRelevance(observerRelevance); return this.fidelityDiagnostics(); }
  fidelityDiagnostics() { return this.fidelity.diagnostics(); }

  advance(years) {
    const target = clamp(Number(years) || 0, 0, CHECKPOINT_777.yearsBeforePresent);
    let remaining = target;
    while (remaining > 0) {
      const step = Math.min(25, remaining);
      this._step(step);
      remaining -= step;
    }
    return this.snapshot();
  }

  seek(elapsedYears) {
    const target = clamp(Math.round(elapsedYears), 0, CHECKPOINT_777.yearsBeforePresent);
    if (target < this.state.elapsedYears) this.reset(this.seed);
    return this.advance(target - this.state.elapsedYears);
  }

  _step(dt) {
    const state = this.state;
    state.elapsedYears = Math.min(CHECKPOINT_777.yearsBeforePresent, state.elapsedYears + dt);
    state.yearBP = CHECKPOINT_777.yearsBeforePresent - state.elapsedYears;
    state.stage = stageForYearBP(state.yearBP);

    const forcing = paleoForcingAt(state.yearBP);
    state.eccentricity = forcing.eccentricity;
    state.obliquity = forcing.obliquity;
    state.precession = forcing.precession;
    state.seaLevelReference = forcing.seaLevel;
    state.seaLevelUncertainty = forcing.seaLevelSigma;
    state.seaLevelLower95 = forcing.seaLevelLower95;
    state.seaLevelUpper95 = forcing.seaLevelUpper95;

    advanceGeologicActivity(state, dt, this.geologyRandom);
    this.fidelity.update(state);
    this.fidelity.recordExecution("orbit", 1);
    this.fidelity.recordExecution("geology", 1);
    this.fidelity.execute("tectonics", dt, (subDt) => advanceLithosphere(state, subDt));

    this.fidelity.execute("carbon", dt, (subDt) => advanceCarbonCycle(state, subDt, { perturbation: gaussian(this.biogeochemicalRandom) }));
    this.fidelity.execute("methane", dt, (subDt) => advanceMethaneCycle(state, subDt));
    this.fidelity.execute("nitrogen", dt, (subDt) => advanceNitrogenCycle(state, subDt));
    syncAtmosphereFromReservoirs(state);

    const orbitalSummer = orbitalSummerIndex(state);
    this.fidelity.execute("climate", dt, (subDt) => {
      const iceAlbedoFeedback = (CHECKPOINT_777.boundary.iceVolumeIndex.value - state.iceIndex) * 2.2;
      const temperatureTarget = CHECKPOINT_777.boundary.globalTemperatureAnomaly.value
        + state.greenhouseForcing * 0.78
        + orbitalSummer * 0.9
        + iceAlbedoFeedback;
      state.temperatureAnomaly = relax(state.temperatureAnomaly, temperatureTarget, subDt, 380);
      state.oceanTemperatureAnomaly = relax(state.oceanTemperatureAnomaly, state.temperatureAnomaly, subDt, 1_250);
    });
    this.fidelity.execute("ocean", dt, (subDt) => advanceOceanCirculation(state, subDt));

    this.fidelity.execute("ice", dt, (subDt) => {
      const checkpointTemperature = CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
      const thermalDeparture = state.temperatureAnomaly - checkpointTemperature;
      const iceTarget = clamp(CHECKPOINT_777.boundary.iceVolumeIndex.value - thermalDeparture * 0.135 - orbitalSummer * 0.18, 0, 1);
      state.iceIndex = clamp(relax(state.iceIndex, iceTarget, subDt, 2_800), 0, 1);
    });

    this.fidelity.execute("seaLevel", dt, (subDt) => {
      const iceDeparture = state.iceIndex - CHECKPOINT_777.boundary.iceVolumeIndex.value;
      const oceanHeatDeparture = state.oceanTemperatureAnomaly - CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
      const seaLevelTarget = CHECKPOINT_777.boundary.seaLevelAnomaly.value - iceDeparture * 128 + oceanHeatDeparture * 0.72;
      state.seaLevel = relax(state.seaLevel, seaLevelTarget, subDt, 700);
    });

    const b = BIOGEOCHEMISTRY_BASELINE;
    const co2Saturation = (state.co2 / (state.co2 + 180)) / (b.co2Ppm / (b.co2Ppm + 180));
    const temperatureSuitability = Math.exp(-0.035 * ((state.temperatureAnomaly - 0.4) ** 2 - (b.temperatureAnomalyK - 0.4) ** 2));
    const nitrogenAvailability = positive(state.terrestrialReactiveNitrogenTgN) / b.nitrogen.terrestrialReactiveTgN;
    const iceAvailability = Math.exp(-0.72 * (state.iceIndex - b.iceIndex));
    const productivityTarget = positive(co2Saturation ** 0.48 * temperatureSuitability * nitrogenAvailability ** 0.16 * iceAvailability, 0.01);
    state.productivityIndex = positive(relax(state.productivityIndex, productivityTarget, dt, 55), 0.01);
    this.fidelity.recordExecution("vegetation", 1);

    this.fidelity.execute("herbivores", dt, (subDt) => {
      const carryingCapacity = positive(state.productivityIndex * Math.exp(-0.16 * (state.iceIndex - b.iceIndex)), 0.01);
      state.herbivoreBiomass = positive(relax(state.herbivoreBiomass, carryingCapacity, subDt, 34), 0.001);
    });

    this.fidelity.execute("carnivores", dt, (subDt) => {
      applyAggregatePredation(state, subDt);
      const preySupportedCapacity = positive(state.herbivoreBiomass ** 0.92 * state.productivityIndex ** 0.08, 0.001);
      state.carnivoreBiomass = positive(relax(state.carnivoreBiomass, preySupportedCapacity, subDt, 48), 0.001);
    });

    const animalLineagesBefore = new Set((state.speciesLineages ?? [])
      .filter((lineage) => lineage.extinctionYearBP == null && lineage.populationIndex > 0)
      .map((lineage) => lineage.id));
    const homininLineagesBefore = new Set((state.homininLineages ?? [])
      .filter((lineage) => lineage.extinctionYearBP == null && lineage.populationIndex > 0)
      .map((lineage) => lineage.id));
    this.fidelity.execute("evolution", dt, (subDt) => advanceEvolutionaryEcology(state, subDt, this.evolutionRandom));
    this.fidelity.execute("hominins", dt, (subDt) => advanceHomininLineages(state, subDt, this.homininRandom));
    this._recordLineageEvents(animalLineagesBefore, homininLineagesBefore);

    this.fidelity.execute("magnetism", dt, (subDt) => {
      if (state.yearBP <= 773_000 && state.magneticPolarity < 0) {
        state.magneticStrength = Math.max(0.04, state.magneticStrength - subDt / 18_000);
        if (state.yearBP <= 772_500) {
          state.magneticPolarity = 1;
          this._recordEvent("The Matuyama–Brunhes transition resolves into normal polarity.");
        }
      } else if (state.magneticPolarity > 0) {
        const secularNoise = gaussian(this.magneticRandom) * 0.00045 * Math.sqrt(subDt);
        state.magneticStrength = Math.max(0.04, relax(state.magneticStrength, 1, subDt, 4_500) + secularNoise);
      }
    });
  }

  _recordLineageEvents(animalLineagesBefore, homininLineagesBefore) {
    for (const lineage of this.state.speciesLineages ?? []) {
      const living = lineage.extinctionYearBP == null && lineage.populationIndex > 0;
      const wasLiving = animalLineagesBefore.has(lineage.id);
      if (!wasLiving && living && lineage.parentId != null) {
        this._recordEvent(`Animal lineage ${lineage.id} branches from lineage ${lineage.parentId}.`);
      } else if (wasLiving && !living) {
        this._recordEvent(`Animal lineage ${lineage.id} becomes extinct.`);
      }
    }
    for (const lineage of this.state.homininLineages ?? []) {
      const living = lineage.extinctionYearBP == null && lineage.populationIndex > 0;
      const wasLiving = homininLineagesBefore.has(lineage.id);
      if (!wasLiving && living && lineage.parentId != null) {
        this._recordEvent(`Hominin lineage ${lineage.id} branches from ${lineage.parentId}.`);
      } else if (wasLiving && !living) {
        this._recordEvent(`Hominin lineage ${lineage.id} becomes extinct.`);
      }
    }
  }

  _recordEvent(text) {
    const duplicate = this.events.at(-1);
    if (duplicate?.text === text && Math.abs(duplicate.yearBP - this.state.yearBP) < 1_000) return;
    this.events.push({ yearBP: Math.round(this.state.yearBP), text });
    if (this.events.length > 40) this.events.shift();
  }

  snapshot() {
    const speciesLineages = Object.freeze((this.state.speciesLineages ?? []).map((lineage) => Object.freeze({ ...lineage })));
    const homininLineages = Object.freeze((this.state.homininLineages ?? []).map((lineage) => Object.freeze({ ...lineage })));
    return Object.freeze({
      ...this.state,
      seed: this.seed,
      eccentricity: round(this.state.eccentricity, 6), obliquity: round(this.state.obliquity, 4), precession: round(this.state.precession, 3),
      co2: round(this.state.co2, 2), methane: round(this.state.methane, 2), nitrousOxide: round(this.state.nitrousOxide, 2),
      greenhouseForcing: round(this.state.greenhouseForcing, 4), temperatureAnomaly: round(this.state.temperatureAnomaly, 3),
      oceanTemperatureAnomaly: round(this.state.oceanTemperatureAnomaly, 3), seaLevel: round(this.state.seaLevel, 2),
      oceanOverturningIndex: round(this.state.oceanOverturningIndex, 4), oceanVentilationIndex: round(this.state.oceanVentilationIndex, 4),
      oceanMeanSalinityPsu: round(this.state.oceanMeanSalinityPsu, 4), oceanOxygenIndex: round(this.state.oceanOxygenIndex, 4),
      seaLevelReference: round(this.state.seaLevelReference, 2), seaLevelUncertainty: round(this.state.seaLevelUncertainty, 2),
      seaLevelLower95: round(this.state.seaLevelLower95, 2), seaLevelUpper95: round(this.state.seaLevelUpper95, 2),
      iceIndex: round(this.state.iceIndex, 4), magneticStrength: round(this.state.magneticStrength, 4),
      geologicActivityIndex: round(this.state.geologicActivityIndex, 4), tectonicTimeMyr: round(this.state.tectonicTimeMyr, 6),
      tectonicBoundaryActivity: round(this.state.tectonicBoundaryActivity, 4), mantleHeatIndex: round(this.state.mantleHeatIndex, 4),
      productivityIndex: round(this.state.productivityIndex, 4),
      herbivoreBiomass: round(this.state.herbivoreBiomass, 4), carnivoreBiomass: round(this.state.carnivoreBiomass, 4),
      predationPressureIndex: round(this.state.predationPressureIndex ?? 0, 4),
      predationMassCompatibilityIndex: round(this.state.predationMassCompatibilityIndex ?? 0, 4),
      predationHerbivoreLossPerYear: round(this.state.predationHerbivoreLossPerYear ?? 0, 6),
      speciesRichness: this.state.speciesRichness, evolutionaryNoveltyIndex: round(this.state.evolutionaryNoveltyIndex, 4),
      meanSpeciesCognitionIndex: round(this.state.meanSpeciesCognitionIndex, 4),
      homininPopulationIndex: round(this.state.homininPopulationIndex, 4), homininSpeciesRichness: this.state.homininSpeciesRichness,
      cognitionIndex: round(this.state.cognitionIndex, 4), cultureIndex: round(this.state.cultureIndex, 4),
      technologyIndex: round(this.state.technologyIndex, 4), communicationIndex: round(this.state.communicationIndex, 4),
      fireUseIndex: round(this.state.fireUseIndex ?? 0, 4), atmosphericCarbonPgC: round(this.state.atmosphericCarbonPgC, 3),
      oceanSurfaceCarbonPgC: round(this.state.oceanSurfaceCarbonPgC, 3), oceanDeepCarbonPgC: round(this.state.oceanDeepCarbonPgC, 3),
      terrestrialCarbonPgC: round(this.state.terrestrialCarbonPgC, 3), sedimentCarbonPgC: round(this.state.sedimentCarbonPgC, 3),
      methaneCarbonPgC: round(this.state.methaneCarbonPgC, 5), terrestrialReactiveNitrogenTgN: round(this.state.terrestrialReactiveNitrogenTgN, 3),
      oceanReactiveNitrogenTgN: round(this.state.oceanReactiveNitrogenTgN, 3), atmosphericN2ONitrogenTgN: round(this.state.atmosphericN2ONitrogenTgN, 3),
      speciesLineages,
      homininLineages,
      carbonFluxes: Object.freeze({ ...this.state.carbonFluxes }), methaneFluxes: Object.freeze({ ...this.state.methaneFluxes }),
      nitrogenFluxes: Object.freeze({ ...this.state.nitrogenFluxes }), events: Object.freeze(this.events.map((event) => Object.freeze({ ...event })))
    });
  }
}
