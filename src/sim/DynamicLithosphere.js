import { gaussian } from "./random.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const wrapLongitude = (longitude) => ((Number(longitude) + 540) % 360) - 180;
const relax = (current, target, dtYears, tauYears) => current + (target - current) * (1 - Math.exp(-dtYears / tauYears));

const PLATE_COUNT = 14;
const KM_PER_DEGREE = 111.32;

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

function plateDefinition(seed, index) {
  const latitude = -68 + unit(seed, index, 0x9e3779b1) * 136;
  const longitude = -180 + unit(seed, index, 0x85ebca77) * 360;
  const heading = unit(seed, index, 0xc2b2ae3d) * Math.PI * 2;
  const speedDegPerMyr = 0.22 + unit(seed, index, 0x27d4eb2f) * 1.55;
  return Object.freeze({
    id: index + 1,
    latitude,
    longitude,
    velocityEastDegPerMyr: Math.cos(heading) * speedDegPerMyr,
    velocityNorthDegPerMyr: Math.sin(heading) * speedDegPerMyr
  });
}

function movedPlate(seed, index, timeMyr) {
  const plate = plateDefinition(seed, index);
  const latitude = clamp(plate.latitude + plate.velocityNorthDegPerMyr * timeMyr, -82, 82);
  const longitudeScale = Math.max(0.22, Math.cos(plate.latitude * Math.PI / 180));
  const longitude = wrapLongitude(plate.longitude + plate.velocityEastDegPerMyr * timeMyr / longitudeScale);
  return { ...plate, latitude, longitude };
}

function localDeltaDegrees(latitude, longitude, plate) {
  const dLat = plate.latitude - latitude;
  const dLon = wrapLongitude(plate.longitude - longitude) * Math.cos((latitude + plate.latitude) * Math.PI / 360);
  return { x: dLon, y: dLat, distance: Math.hypot(dLon, dLat) };
}

export function initializeLithosphere(state, seed = 777001) {
  state.tectonicSeed ??= Number(seed) >>> 0;
  state.tectonicTimeMyr ??= (Number(state.elapsedYears) || 0) / 1_000_000;
  state.geologicActivityIndex ??= 1;
  state.tectonicBoundaryActivity ??= 1;
  state.mantleHeatIndex ??= 1;
  state.meanDynamicTopographyMeters ??= 0;
  return state;
}

export function advanceGeologicActivity(state, dtYears, random = Math.random) {
  initializeLithosphere(state, state.tectonicSeed);
  const dt = Math.max(0, Number(dtYears) || 0);
  const reversion = 1 - Math.exp(-dt / 65_000);
  const stochastic = gaussian(random) * 0.0016 * Math.sqrt(dt);
  const raw = Number(state.geologicActivityIndex ?? 1);
  const current = Math.max(0.08, raw || 0);
  state.geologicActivityIndex = Math.max(0.08, current + (1 - raw) * reversion + stochastic);
  return state;
}

export function advanceLithosphere(state, dtYears) {
  initializeLithosphere(state, state.tectonicSeed);
  const dt = Math.max(0, Number(dtYears) || 0);
  state.tectonicTimeMyr = (Number(state.elapsedYears) || 0) / 1_000_000;
  const geologic = Math.max(0.05, Number(state.geologicActivityIndex) || 1);
  const thermalTarget = 0.82 + 0.18 * geologic;
  state.mantleHeatIndex = relax(state.mantleHeatIndex, thermalTarget, dt, 180_000);
  const boundaryTarget = Math.sqrt(geologic * state.mantleHeatIndex);
  state.tectonicBoundaryActivity = relax(state.tectonicBoundaryActivity, boundaryTarget, dt, 45_000);
  return state;
}

export function tectonicSampleAt(state, latitude, longitude, seed = state?.tectonicSeed ?? 777001) {
  const lat = clamp(latitude, -89.9, 89.9);
  const lon = wrapLongitude(longitude);
  const timeMyr = Math.max(0, Number(state?.tectonicTimeMyr ?? state?.elapsedYears / 1_000_000) || 0);
  const nearest = [];
  for (let index = 0; index < PLATE_COUNT; index += 1) {
    const plate = movedPlate(seed, index, timeMyr);
    const delta = localDeltaDegrees(lat, lon, plate);
    nearest.push({ plate, ...delta });
  }
  nearest.sort((a, b) => a.distance - b.distance);
  const first = nearest[0];
  const second = nearest[1];
  const boundaryGapDegrees = Math.max(0, second.distance - first.distance);
  const boundaryWeight = Math.exp(-((boundaryGapDegrees / 2.6) ** 2));

  const between = localDeltaDegrees(first.plate.latitude, first.plate.longitude, second.plate);
  const length = Math.max(1e-6, between.distance);
  const nx = between.x / length;
  const ny = between.y / length;
  const relativeEast = second.plate.velocityEastDegPerMyr - first.plate.velocityEastDegPerMyr;
  const relativeNorth = second.plate.velocityNorthDegPerMyr - first.plate.velocityNorthDegPerMyr;
  const separationDegPerMyr = relativeEast * nx + relativeNorth * ny;
  const convergenceCmPerYear = -separationDegPerMyr * KM_PER_DEGREE * 0.1;
  const activity = Math.max(0.05, Number(state?.tectonicBoundaryActivity) || 1);
  const convergence = Math.max(0, convergenceCmPerYear);
  const divergence = Math.max(0, -convergenceCmPerYear);
  const upliftRateMmPerYear = boundaryWeight * activity * (convergence * 0.075 - divergence * 0.042);
  const transformRate = boundaryWeight * activity * Math.abs(relativeEast * ny - relativeNorth * nx) * KM_PER_DEGREE * 0.1;
  const hotspotPhase = (first.plate.id * 1.713 + lat * 0.037 + lon * 0.021 + timeMyr * 0.91);
  const hotspotRateMmPerYear = Math.max(0, Math.sin(hotspotPhase) - 0.78) * 0.18 * activity;
  const netRockRateMmPerYear = upliftRateMmPerYear + hotspotRateMmPerYear;

  let boundaryType = "plate interior";
  if (boundaryWeight > 0.34) {
    if (convergenceCmPerYear > 0.35) boundaryType = "convergent";
    else if (convergenceCmPerYear < -0.35) boundaryType = "divergent";
    else boundaryType = "transform / diffuse";
  }

  return Object.freeze({
    plateId: first.plate.id,
    neighboringPlateId: second.plate.id,
    boundaryType,
    boundaryWeight,
    boundaryGapDegrees,
    convergenceCmPerYear,
    transformCmPerYear: transformRate,
    upliftRateMmPerYear: netRockRateMmPerYear,
    timeMyr
  });
}

export function tectonicElevationOffsetMeters(state, latitude, longitude, seed = state?.tectonicSeed ?? 777001) {
  const sample = tectonicSampleAt(state, latitude, longitude, seed);
  const elapsedYears = Math.max(0, Number(state?.elapsedYears) || 0);
  const erosionRetention = 1 / (1 + elapsedYears / 1_600_000);
  const longWavelength = Math.sin((longitude + sample.plateId * 19) * Math.PI / 90)
    * Math.cos(latitude * Math.PI / 120)
    * 18
    * sample.timeMyr
    * (Number(state?.mantleHeatIndex) || 1);
  return sample.upliftRateMmPerYear * elapsedYears / 1000 * erosionRetention + longWavelength;
}

export const DYNAMIC_LITHOSPHERE_POLICY = "deterministic-moving-plate-voronoi-lithosphere-v1";
