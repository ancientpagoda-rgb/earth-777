import { checkpointState, CHECKPOINT_777 } from "../data/checkpoint-777.js";
import { paleoForcingAt } from "../data/paleo-forcing.js";
import { AdaptiveFidelityController } from "./AdaptiveFidelityController.js";
import { createRandom, gaussian } from "./random.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 4) => Number(value.toFixed(digits));

const EVENTS = Object.freeze([
  { key: "dry", threshold: 0.14, text: "A multi-decadal dry phase shifts grazing pressure toward river corridors." },
  { key: "cold", threshold: 0.10, text: "Cool summers preserve seasonal snow across northern uplands." },
  { key: "fire", threshold: 0.08, text: "Lightning ignites a regional grassland fire mosaic." },
  { key: "migration", threshold: 0.12, text: "Large herbivore ranges reorganize along a changing forage frontier." },
  { key: "hominin", threshold: 0.055, text: "A hominin population establishes a new persistent seasonal range." }
]);

export class FreeEarthEngine {
  constructor(seed = 777001, { fidelityBudget = 1, observerRelevance = {}, fidelityRefreshYears = 250 } = {}) {
    this.seed = Number(seed) >>> 0;
    this.fidelity = new AdaptiveFidelityController({
      budget: fidelityBudget,
      observerRelevance,
      refreshYears: fidelityRefreshYears
    });
    this._resetRandomStreams();
    this.state = checkpointState();
    this.events = [];
    this._eventAccumulator = 0;
  }

  _resetRandomStreams() {
    this.carbonRandom = createRandom((this.seed ^ 0x9e3779b9) >>> 0);
    this.eventRandom = createRandom((this.seed ^ 0x85ebca6b) >>> 0);
  }

  reset(seed = this.seed) {
    this.seed = Number(seed) >>> 0;
    this._resetRandomStreams();
    this.fidelity.reset();
    this.state = checkpointState();
    this.events = [];
    this._eventAccumulator = 0;
    return this.snapshot();
  }

  setFidelityBudget(budget) {
    this.fidelity.setBudget(budget);
    return this.fidelityDiagnostics();
  }

  setObserverRelevance(observerRelevance = {}) {
    this.fidelity.setObserverRelevance(observerRelevance);
    return this.fidelityDiagnostics();
  }

  fidelityDiagnostics() {
    return this.fidelity.diagnostics();
  }

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

    const forcing = paleoForcingAt(state.yearBP);
    state.eccentricity = forcing.eccentricity;
    state.obliquity = forcing.obliquity;
    state.precession = forcing.precession;
    state.seaLevelReference = forcing.seaLevel;
    state.seaLevelUncertainty = forcing.seaLevelSigma;
    state.seaLevelLower95 = forcing.seaLevelLower95;
    state.seaLevelUpper95 = forcing.seaLevelUpper95;
    this.fidelity.update(state);
    this.fidelity.recordExecution("orbit", 1);

    const orbitalSummer =
      (state.obliquity - 23.3) * 0.36 +
      (state.eccentricity - 0.023) * 28 * Math.cos(state.precession * Math.PI / 180);

    this.fidelity.execute("carbon", dt, (subDt) => {
      const carbonNoise = gaussian(this.carbonRandom) * 0.015 * Math.sqrt(subDt);
      const carbonEquilibrium = 245 + 42 * (1 - state.iceIndex) + orbitalSummer * 5;
      state.co2 += (carbonEquilibrium - state.co2) * (subDt / 12_000) + carbonNoise;
      state.co2 = clamp(state.co2, 170, 330);
    });

    this.fidelity.execute("climate", dt, (subDt) => {
      const radiative = 3.7 * Math.log(state.co2 / 245) / Math.log(2);
      const temperatureTarget = -1.27 + radiative * 0.72 + orbitalSummer * 0.9;
      state.temperatureAnomaly += (temperatureTarget - state.temperatureAnomaly) * (subDt / 380);
    });

    this.fidelity.execute("ice", dt, (subDt) => {
      const reconstructedIce = clamp((8.96 - state.seaLevelReference) / 120, 0.03, 1);
      const climateIce = clamp(0.18 - state.temperatureAnomaly * 0.13 - orbitalSummer * 0.18, 0.03, 1);
      const iceTarget = clamp(climateIce * 0.55 + reconstructedIce * 0.45, 0.03, 1);
      state.iceIndex += (iceTarget - state.iceIndex) * (subDt / 2_800);
    });

    this.fidelity.execute("seaLevel", dt, (subDt) => {
      const reconstructedIce = clamp((8.96 - state.seaLevelReference) / 120, 0.03, 1);
      const branchedSeaLevel = state.seaLevelReference - (state.iceIndex - reconstructedIce) * 116;
      state.seaLevel += (branchedSeaLevel - state.seaLevel) * (subDt / 1_900);
    });

    state.productivityIndex = clamp(
      1 + (state.co2 - 245) * 0.0017 + state.temperatureAnomaly * 0.055 - state.iceIndex * 0.12,
      0.42,
      1.45
    );
    this.fidelity.recordExecution("vegetation", 1);

    this.fidelity.execute("herbivores", dt, (subDt) => {
      const herbivoreTarget = clamp(state.productivityIndex * (1 - state.iceIndex * 0.18), 0.25, 1.6);
      state.herbivoreBiomass += (herbivoreTarget - state.herbivoreBiomass) * (subDt / 34);
    });

    this.fidelity.execute("carnivores", dt, (subDt) => {
      const carnivoreTarget = clamp(state.herbivoreBiomass * 0.94, 0.2, 1.5);
      state.carnivoreBiomass += (carnivoreTarget - state.carnivoreBiomass) * (subDt / 48);
    });

    this.fidelity.execute("hominins", dt, (subDt) => {
      const homininClimate = clamp(1 - Math.abs(state.temperatureAnomaly + 0.6) * 0.08, 0.5, 1.1);
      const homininTarget = clamp(state.productivityIndex * homininClimate, 0.25, 1.8);
      state.homininPopulationIndex += (homininTarget - state.homininPopulationIndex) * (subDt / 85);
    });

    this.fidelity.execute("magnetism", dt, (subDt) => {
      if (state.yearBP <= 773_000 && state.magneticPolarity < 0) {
        state.magneticStrength = Math.max(0.16, state.magneticStrength - subDt / 18_000);
        if (state.yearBP <= 772_500) {
          state.magneticPolarity = 1;
          this._recordEvent("The Matuyama–Brunhes transition resolves into normal polarity.");
        }
      } else if (state.magneticPolarity > 0) {
        state.magneticStrength += (0.78 - state.magneticStrength) * (subDt / 4_500);
      }
    });

    this._eventAccumulator += dt;
    if (this._eventAccumulator >= 250) {
      this._eventAccumulator %= 250;
      for (const event of EVENTS) {
        if (this.eventRandom() < event.threshold) this._recordEvent(event.text);
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
    return Object.freeze({
      ...this.state,
      eccentricity: round(this.state.eccentricity, 6),
      obliquity: round(this.state.obliquity, 4),
      precession: round(this.state.precession, 3),
      co2: round(this.state.co2, 2),
      temperatureAnomaly: round(this.state.temperatureAnomaly, 3),
      seaLevel: round(this.state.seaLevel, 2),
      seaLevelReference: round(this.state.seaLevelReference, 2),
      seaLevelUncertainty: round(this.state.seaLevelUncertainty, 2),
      seaLevelLower95: round(this.state.seaLevelLower95, 2),
      seaLevelUpper95: round(this.state.seaLevelUpper95, 2),
      iceIndex: round(this.state.iceIndex, 4),
      magneticStrength: round(this.state.magneticStrength, 4),
      productivityIndex: round(this.state.productivityIndex, 4),
      herbivoreBiomass: round(this.state.herbivoreBiomass, 4),
      carnivoreBiomass: round(this.state.carnivoreBiomass, 4),
      homininPopulationIndex: round(this.state.homininPopulationIndex, 4),
      events: Object.freeze(this.events.map((event) => Object.freeze({ ...event })))
    });
  }
}

export function regionalState(globalState, latitude, longitude, climateLayer = null) {
  const checkpointClimate = climateLayer?.annualAt?.(latitude, longitude) ?? null;
  let annualTemperature;
  let moisture;
  let annualPrecipitation = null;
  let cloudCover = null;
  let confidence = "modeled regional estimate";
  let climateSource = "regional-emulator";

  if (checkpointClimate && Number.isFinite(checkpointClimate.temperatureCelsius)) {
    const checkpointGlobalAnomaly = CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
    const freeEarthTemperatureDelta = (globalState.temperatureAnomaly ?? checkpointGlobalAnomaly) - checkpointGlobalAnomaly;
    annualTemperature = checkpointClimate.temperatureCelsius + freeEarthTemperatureDelta;
    annualPrecipitation = checkpointClimate.precipitationMmPerYear;
    cloudCover = checkpointClimate.cloudCoverPercent;
    moisture = Number.isFinite(annualPrecipitation)
      ? clamp(annualPrecipitation / (annualPrecipitation + 700), 0.05, 1)
      : 0.5;
    climateSource = "krapp-2021-777ka";
    confidence = globalState.elapsedYears > 0
      ? "Krapp 777 ka 0.5° checkpoint + model-derived Free Earth temperature anomaly; precipitation/cloud held at checkpoint baseline"
      : "Krapp 777 ka 0.5° published reconstruction";
  } else {
    const lat = latitude * Math.PI / 180;
    const lon = longitude * Math.PI / 180;
    const seasonality = Math.abs(Math.sin(lat));
    const continentality = 0.55 + 0.45 * Math.sin(lon * 2.7 + lat) ** 2;
    annualTemperature =
      27 - seasonality * 43 + globalState.temperatureAnomaly * (1 + seasonality * 0.8) - continentality * seasonality * 5;
    moisture = clamp(
      0.64 + Math.cos(lat * 2.7) * 0.22 + Math.sin(lon * 1.7 - lat) * 0.16 - globalState.iceIndex * seasonality * 0.2,
      0.05,
      1
    );
  }

  const biome = Math.abs(latitude) > 72 - globalState.iceIndex * 8
    ? "polar ice / tundra"
    : annualTemperature < -4
      ? "cold steppe"
      : annualTemperature < 5
        ? moisture > 0.58 ? "boreal woodland" : "mammoth steppe"
        : annualTemperature > 23
          ? moisture > 0.7 ? "tropical woodland" : "warm savanna"
          : moisture > 0.68
            ? "temperate forest"
            : moisture > 0.38 ? "open woodland" : "dry grassland";

  return {
    latitude,
    longitude,
    annualTemperature: round(annualTemperature, 1),
    annualPrecipitation: Number.isFinite(annualPrecipitation) ? round(annualPrecipitation, 0) : null,
    cloudCover: Number.isFinite(cloudCover) ? round(cloudCover, 1) : null,
    moisture: round(moisture, 2),
    biome,
    climateSource,
    checkpointClimate: climateSource === "krapp-2021-777ka",
    confidence
  };
}
