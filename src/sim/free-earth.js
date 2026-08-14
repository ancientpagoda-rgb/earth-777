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
import { advanceLithosphere, initializeLithosphere } from "./DynamicLithosphere.js";
import { advanceOceanCirculation, initializeOceanCirculation } from "./SpatialOceanCirculation.js";
import { advanceEvolutionaryEcology, initializeEvolutionaryEcology } from "./EvolutionaryEcology.js";
import { advanceHomininLineages, initializeHomininLineages } from "./HomininLineages.js";
import { createRandom, gaussian } from "./random.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const positive = (value, floor = 1e-9) => Math.max(floor, Number(value) || 0);
const round = (value, digits = 4) => Number(value.toFixed(digits));
const relax = (current, target, dtYears, tauYears) => current + (target - current) * (1 - Math.exp(-dtYears / tauYears));

const EVENTS = Object.freeze([
  { key: "dry", threshold: 0.14, text: "A multi-decadal dry phase shifts grazing pressure toward river corridors." },
  { key: "cold", threshold: 0.10, text: "Cool summers preserve seasonal snow across northern uplands." },
  { key: "fire", threshold: 0.08, text: "Lightning ignites a regional grassland fire mosaic." },
  { key: "migration", threshold: 0.12, text: "Large herbivore ranges reorganize along a changing forage frontier." },
  { key: "hominin", threshold: 0.055, text: "A hominin population establishes a new persistent seasonal range." }
]);

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

function updateGeologicActivity(state, dt, random) {
  const reversion = 1 - Math.exp(-dt / 65_000);
  const stochastic = gaussian(random) * 0.0016 * Math.sqrt(dt);
  state.geologicActivityIndex = Math.max(
    0.08,
    positive(state.geologicActivityIndex ?? 1, 0.08) + (1 - state.geologicActivityIndex) * reversion + stochastic
  );
}

export class FreeEarthEngine {
  constructor(seed = 777001, { fidelityBudget = 1, observerRelevance = {}, fidelityRefreshYears = 250 } = {}) {
    this.seed = Number(seed) >>> 0;
    this.fidelity = new AdaptiveFidelityController({ budget: fidelityBudget, observerRelevance, refreshYears: fidelityRefreshYears });
    this._resetRandomStreams();
    this.state = initializeBiogeochemistry(checkpointState());
    this.state.seed = this.seed;
    this.state.oceanTemperatureAnomaly = this.state.temperatureAnomaly;
    this.state.geologicActivityIndex = 1;
    initializeLithosphere(this.state, this.seed);
    initializeOceanCirculation(this.state);
    initializeEvolutionaryEcology(this.state, this.seed);
    initializeHomininLineages(this.state, this.seed);
    this.state.stage = stageForYearBP(this.state.yearBP);
    this.events = [];
    this._eventAccumulator = 0;
  }

  _resetRandomStreams() {
    this.biogeochemicalRandom = createRandom((this.seed ^ 0x9e3779b9) >>> 0);
    this.geologyRandom = createRandom((this.seed ^ 0x4cf5ad43) >>> 0);
    this.magneticRandom = createRandom((this.seed ^ 0x6a09e667) >>> 0);
    this.evolutionRandom = createRandom((this.seed ^ 0xbb67ae85) >>> 0);
    this.homininRandom = createRandom((this.seed ^ 0x3c6ef372) >>> 0);
    this.eventRandom = createRandom((this.seed ^ 0x85ebca6b) >>> 0);
  }

  reset(seed = this.seed) {
    this.seed = Number(seed) >>> 0;
    this._resetRandomStreams();
    this.fidelity.reset();
    this.state = initializeBiogeochemistry(checkpointState());
    this.state.seed = this.seed;
    this.state.oceanTemperatureAnomaly = this.state.temperatureAnomaly;
    this.state.geologicActivityIndex = 1;
    initializeLithosphere(this.state, this.seed);
    initializeOceanCirculation(this.state);
    initializeEvolutionaryEcology(this.state, this.seed);
    initializeHomininLineages(this.state, this.seed);
    this.state.stage = stageForYearBP(this.state.yearBP);
    this.events = [];
    this._eventAccumulator = 0;
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

    updateGeologicActivity(state, dt, this.geologyRandom);
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
      const preySupportedCapacity = positive(state.herbivoreBiomass ** 0.92 * state.productivityIndex ** 0.08, 0.001);
      state.carnivoreBiomass = positive(relax(state.carnivoreBiomass, preySupportedCapacity, subDt, 48), 0.001);
    });

    this.fidelity.execute("evolution", dt, (subDt) => advanceEvolutionaryEcology(state, subDt, this.evolutionRandom));
    this.fidelity.execute("hominins", dt, (subDt) => advanceHomininLineages(state, subDt, this.homininRandom));
    this.fidelity.recordExecution("culture", 1);

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

    this._eventAccumulator += dt;
    if (this._eventAccumulator >= 250) {
      this._eventAccumulator %= 250;
      for (const event of EVENTS) if (this.eventRandom() < event.threshold) this._recordEvent(event.text);
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

function branchHydrologyResponse(globalState, latitude, longitude) {
  const checkpointTemperature = CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
  const lat = latitude * Math.PI / 180;
  const lon = longitude * Math.PI / 180;
  const polarWeight = Math.sin(lat) ** 2;
  const temperatureDelta = (globalState.temperatureAnomaly - checkpointTemperature) * (0.85 + polarWeight * 0.65);
  const iceDelta = globalState.iceIndex - CHECKPOINT_777.boundary.iceVolumeIndex.value;
  const precessionPhase = globalState.precession * Math.PI / 180;
  const orbitalMoisture = globalState.eccentricity * 7.5 * Math.cos(precessionPhase - lon) * Math.cos(lat);
  const precipitationScale = Math.exp(temperatureDelta * (0.018 + (1 - polarWeight) * 0.010) - iceDelta * polarWeight * 0.55 + orbitalMoisture * 0.10);
  return { temperatureDelta, precipitationScale };
}

export function regionalState(globalState, latitude, longitude, climateLayer = null) {
  const checkpointClimate = climateLayer?.annualAt?.(latitude, longitude) ?? null;
  let annualTemperature;
  let moisture;
  let annualPrecipitation = null;
  let cloudCover = null;
  let confidence = "model-derived regional estimate";
  let climateSource = "regional-emulator";

  const branch = branchHydrologyResponse(globalState, latitude, longitude);
  if (checkpointClimate && Number.isFinite(checkpointClimate.temperatureCelsius)) {
    annualTemperature = checkpointClimate.temperatureCelsius + branch.temperatureDelta;
    annualPrecipitation = Number.isFinite(checkpointClimate.precipitationMmPerYear) ? checkpointClimate.precipitationMmPerYear * branch.precipitationScale : null;
    cloudCover = Number.isFinite(checkpointClimate.cloudCoverPercent)
      ? clamp(checkpointClimate.cloudCoverPercent + Math.log(branch.precipitationScale) * 18 - branch.temperatureDelta * 0.65, 0, 100) : null;
    moisture = Number.isFinite(annualPrecipitation) ? clamp(annualPrecipitation / (annualPrecipitation + 700), 0.02, 0.995) : 0.5;
    climateSource = globalState.elapsedYears > 0 ? "krapp-2021-777ka + branch-response" : "krapp-2021-777ka";
    confidence = globalState.elapsedYears > 0
      ? "Krapp 777 ka 0.5° checkpoint pattern + model-derived temperature, orbital, ice and hydrological response"
      : "Krapp 777 ka 0.5° published reconstruction";
  } else {
    const lat = latitude * Math.PI / 180;
    const lon = longitude * Math.PI / 180;
    const seasonality = Math.abs(Math.sin(lat));
    const continentality = 0.55 + 0.45 * Math.sin(lon * 2.7 + lat) ** 2;
    annualTemperature = 27 - seasonality * 43 + globalState.temperatureAnomaly * (1 + seasonality * 0.8) - continentality * seasonality * 5;
    moisture = clamp(0.64 + Math.cos(lat * 2.7) * 0.22 + Math.sin(lon * 1.7 - lat) * 0.16 - globalState.iceIndex * seasonality * 0.2, 0.02, 0.995);
  }

  const biome = Math.abs(latitude) > 72 - globalState.iceIndex * 8
    ? "polar ice / tundra"
    : annualTemperature < -4 ? "cold steppe"
      : annualTemperature < 5 ? (moisture > 0.58 ? "boreal woodland" : "mammoth steppe")
        : annualTemperature > 23 ? (moisture > 0.7 ? "tropical woodland" : "warm savanna")
          : moisture > 0.68 ? "temperate forest" : moisture > 0.38 ? "open woodland" : "dry grassland";

  return {
    latitude, longitude, annualTemperature: round(annualTemperature, 1),
    annualPrecipitation: Number.isFinite(annualPrecipitation) ? round(annualPrecipitation, 0) : null,
    cloudCover: Number.isFinite(cloudCover) ? round(cloudCover, 1) : null, moisture: round(moisture, 2), biome,
    climateSource, checkpointClimate: climateSource === "krapp-2021-777ka", confidence
  };
}
