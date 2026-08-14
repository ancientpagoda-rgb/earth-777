const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const relax = (current, target, dtYears, tauYears) => current + (target - current) * (1 - Math.exp(-dtYears / tauYears));
const wrapLongitude = (longitude) => ((Number(longitude) + 540) % 360) - 180;

export const SPATIAL_OCEAN_POLICY = "branch-coupled-overturning-carbonate-ocean-v1";

export function initializeOceanCirculation(state) {
  state.oceanOverturningIndex ??= 1;
  state.oceanVentilationIndex ??= 1;
  state.oceanMeanSalinityPsu ??= 34.7;
  state.oceanOxygenIndex ??= 1;
  state.oceanAcidityIndex ??= 1;
  state.oceanCirculationCarbonFluxPgCPerYear ??= 0;
  return state;
}

function exchangeCarbon(state, dtYears) {
  const surface = Math.max(0, Number(state.oceanSurfaceCarbonPgC) || 0);
  const deep = Math.max(0, Number(state.oceanDeepCarbonPgC) || 0);
  if (surface <= 0 || deep <= 0) {
    state.oceanCirculationCarbonFluxPgCPerYear = 0;
    return;
  }
  const overturning = Math.max(0.02, Number(state.oceanOverturningIndex) || 1);
  const referencedSurface = 900 * (deep / 37100);
  const fluxPgCPerYear = (surface - referencedSurface) / (650 / overturning);
  const requested = fluxPgCPerYear * dtYears;
  if (requested >= 0) {
    const moved = Math.min(surface, requested);
    state.oceanSurfaceCarbonPgC = surface - moved;
    state.oceanDeepCarbonPgC = deep + moved;
    state.oceanCirculationCarbonFluxPgCPerYear = moved / Math.max(dtYears, 1e-9);
  } else {
    const moved = Math.min(deep, -requested);
    state.oceanDeepCarbonPgC = deep - moved;
    state.oceanSurfaceCarbonPgC = surface + moved;
    state.oceanCirculationCarbonFluxPgCPerYear = -moved / Math.max(dtYears, 1e-9);
  }
}

export function advanceOceanCirculation(state, dtYears) {
  initializeOceanCirculation(state);
  const dt = Math.max(0, Number(dtYears) || 0);
  const temperature = Number(state.oceanTemperatureAnomaly ?? state.temperatureAnomaly ?? 0);
  const ice = clamp(state.iceIndex ?? 0.18, 0, 1);
  const seaLevel = Number(state.seaLevel ?? -13);
  const warmingPenalty = Math.exp(-0.085 * Math.max(-2, temperature + 1.27));
  const densitySupport = 0.78 + ice * 0.72;
  const shelfConnection = Math.exp(-Math.max(0, -seaLevel - 80) / 260);
  const overturningTarget = Math.max(0.08, warmingPenalty * densitySupport * shelfConnection);
  state.oceanOverturningIndex = relax(state.oceanOverturningIndex, overturningTarget, dt, 1_800);

  const ventilationTarget = Math.sqrt(Math.max(0.02, state.oceanOverturningIndex)) * Math.exp(-0.035 * Math.max(0, temperature));
  state.oceanVentilationIndex = relax(state.oceanVentilationIndex, ventilationTarget, dt, 950);
  state.oceanOxygenIndex = relax(state.oceanOxygenIndex, Math.max(0.02, state.oceanVentilationIndex * Math.exp(-0.018 * temperature)), dt, 420);

  const iceFreshwater = (0.18 - ice) * 0.22;
  const salinityTarget = 34.7 + iceFreshwater + Math.max(-0.25, Math.min(0.25, -seaLevel / 600));
  state.oceanMeanSalinityPsu = relax(state.oceanMeanSalinityPsu, salinityTarget, dt, 2_100);

  const co2 = Math.max(1, Number(state.co2) || 245);
  const acidityTarget = Math.max(0.1, Math.log(co2 / 245 + 1));
  state.oceanAcidityIndex = relax(state.oceanAcidityIndex, acidityTarget, dt, 160);
  exchangeCarbon(state, dt);
  return state;
}

function oceanTemperatureCelsius(state, latitude, longitude) {
  const absLat = Math.abs(latitude);
  const globalAnomaly = Number(state.oceanTemperatureAnomaly ?? state.temperatureAnomaly ?? 0);
  const seasonalMean = 27.2 - absLat * 0.49 - Math.max(0, absLat - 55) * 0.19;
  const gyre = Math.sin((longitude + Math.sign(latitude || 1) * 22) * Math.PI / 90) * Math.cos(latitude * Math.PI / 180) * 1.6;
  return seasonalMean + globalAnomaly + gyre;
}

export function spatialOceanState(state, latitude, longitude, elevationMeters = -1000) {
  initializeOceanCirculation(state);
  const lat = clamp(latitude, -89.9, 89.9);
  const lon = wrapLongitude(longitude);
  const seaLevel = Number(state.seaLevel ?? 0);
  if (Number.isFinite(elevationMeters) && elevationMeters > seaLevel) {
    return Object.freeze({ isOcean: false, policy: SPATIAL_OCEAN_POLICY });
  }

  const temperatureCelsius = oceanTemperatureCelsius(state, lat, lon);
  const salinity = state.oceanMeanSalinityPsu
    + Math.sin(Math.abs(lat) * Math.PI / 90) * 0.35
    + Math.sin((lon - 15) * Math.PI / 70) * 0.22;
  const overturning = Math.max(0.01, Number(state.oceanOverturningIndex) || 1);
  const ventilation = Math.max(0.01, Number(state.oceanVentilationIndex) || 1);
  const co2 = Math.max(1, Number(state.co2) || 245);
  const surfaceCarbonRatio = Math.max(0.05, (Number(state.oceanSurfaceCarbonPgC) || 900) / 900);
  const dissolvedInorganicCarbonUmolKg = 2050 * surfaceCarbonRatio * Math.exp(-0.006 * (temperatureCelsius - 12));
  const alkalinityUmolKg = 2310 * (salinity / 34.7) ** 0.72;
  const pH = 8.24 - 0.74 * Math.log10(co2 / 280) - 0.012 * (temperatureCelsius - 15) + 0.035 * Math.log(overturning);
  const oxygenUmolKg = Math.max(5, 265 * ventilation * Math.exp(-0.018 * Math.max(-2, temperatureCelsius - 8)));

  const latitudeRadians = lat * Math.PI / 180;
  const longitudeRadians = lon * Math.PI / 180;
  const gyreStrength = Math.cos(latitudeRadians) * Math.sin(latitudeRadians * 2);
  const eastwardCurrentMps = 0.22 * gyreStrength * Math.cos(longitudeRadians * 1.35) * Math.sqrt(overturning);
  const northwardCurrentMps = 0.11 * gyreStrength * Math.sin(longitudeRadians * 1.1) * Math.sqrt(overturning);

  const carbonateSaturationIndex = Math.max(0.02, (alkalinityUmolKg / dissolvedInorganicCarbonUmolKg) * Math.exp((pH - 8.1) * 1.7));
  return Object.freeze({
    isOcean: true,
    temperatureCelsius,
    salinityPsu: salinity,
    dissolvedInorganicCarbonUmolKg,
    alkalinityUmolKg,
    pH,
    oxygenUmolKg,
    carbonateSaturationIndex,
    eastwardCurrentMps,
    northwardCurrentMps,
    currentSpeedMps: Math.hypot(eastwardCurrentMps, northwardCurrentMps),
    overturningIndex: overturning,
    ventilationIndex: ventilation,
    circulationCarbonFluxPgCPerYear: Number(state.oceanCirculationCarbonFluxPgCPerYear) || 0,
    policy: SPATIAL_OCEAN_POLICY,
    epistemicStatus: "intermediate-complexity spatial ocean materialization coupled to branch heat, salinity, carbon reservoirs and overturning; overturning exchanges surface/deep carbon but this is not a full primitive-equation ocean GCM"
  });
}
