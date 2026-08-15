import { CHECKPOINT_777, checkpointState } from "../data/checkpoint-777.js";
import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";
import { tectonicElevationOffsetMeters } from "./DynamicLithosphere.js";

const DEG = Math.PI / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const wrapLongitude = (longitude) => ((Number(longitude) + 540) % 360) - 180;
const round = (value, digits = 4) => Number(value.toFixed(digits));
const CHECKPOINT_STATE = Object.freeze(checkpointState());

export const GENERAL_ATMOSPHERE_POLICY = "orbital-energy-moisture-circulation-v1";

function seasonAngle(monthIndex) {
  return 2 * Math.PI * ((Number(monthIndex) + 0.5) / 12);
}

function solarDeclinationRadians(state, monthIndex) {
  const obliquity = (Number(state?.obliquity) || CHECKPOINT_777.boundary.obliquity.value) * DEG;
  const angle = seasonAngle(monthIndex) - 1.82;
  return Math.asin(Math.sin(obliquity) * Math.sin(angle));
}

function orbitalDistanceFactor(state, monthIndex) {
  const eccentricity = clamp(state?.eccentricity ?? CHECKPOINT_777.boundary.eccentricity.value, 0, 0.12);
  const perihelion = (Number(state?.precession) || CHECKPOINT_777.boundary.climaticPrecession.value) * DEG;
  const trueLongitude = seasonAngle(monthIndex) + 4.76;
  const denominator = Math.max(0.72, 1 - eccentricity * eccentricity);
  return ((1 + eccentricity * Math.cos(trueLongitude - perihelion)) ** 2) / (denominator ** 2);
}

export function dailyMeanInsolationIndex(state, monthIndex, latitude) {
  const phi = clamp(latitude, -89.9, 89.9) * DEG;
  const declination = solarDeclinationRadians(state, monthIndex);
  const sunsetCos = clamp(-Math.tan(phi) * Math.tan(declination), -1, 1);
  const sunsetHourAngle = Math.acos(sunsetCos);
  const geometry = (
    sunsetHourAngle * Math.sin(phi) * Math.sin(declination)
    + Math.cos(phi) * Math.cos(declination) * Math.sin(sunsetHourAngle)
  ) / Math.PI;
  return Math.max(0, geometry * orbitalDistanceFactor(state, monthIndex));
}

export function dynamicSurfaceElevationMeters(state, latitude, longitude) {
  return bedrockElevationAt(latitude, longitude)
    + tectonicElevationOffsetMeters(state, latitude, longitude, state?.tectonicSeed);
}

function isLand(state, latitude, longitude) {
  return dynamicSurfaceElevationMeters(state, latitude, longitude) > (Number(state?.seaLevel) || 0);
}

function surfaceThermalResponse(state, monthIndex, latitude, longitude) {
  const land = isLand(state, latitude, longitude);
  const insolation = dailyMeanInsolationIndex(state, monthIndex, latitude);
  const globalDelta = (Number(state?.temperatureAnomaly) || CHECKPOINT_777.boundary.globalTemperatureAnomaly.value)
    - CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
  const oceanDelta = (Number(state?.oceanTemperatureAnomaly) || Number(state?.temperatureAnomaly)
    || CHECKPOINT_777.boundary.globalTemperatureAnomaly.value) - CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
  const elevation = dynamicSurfaceElevationMeters(state, latitude, longitude);
  const heatCapacityResponse = land ? 10.5 : 4.2;
  const thermal = insolation * heatCapacityResponse
    + (land ? globalDelta * 1.08 : oceanDelta * 0.78)
    - Math.max(0, elevation) * 0.0048;
  return { land, elevation, insolation, thermal };
}

function circulationWind(state, monthIndex, latitude, longitude) {
  const lat = clamp(latitude, -89.5, 89.5);
  const local = surfaceThermalResponse(state, monthIndex, lat, longitude);
  const declination = solarDeclinationRadians(state, monthIndex) / DEG;
  const hemisphericThermalEquator = clamp(declination * 0.82, -24, 24);
  const landHeatingDeparture = local.land ? (local.insolation - dailyMeanInsolationIndex(state, monthIndex, hemisphericThermalEquator)) : 0;
  const localThermalEquator = clamp(hemisphericThermalEquator + landHeatingDeparture * 10.5, -28, 28);

  const absLat = Math.abs(lat);
  let zonalMs;
  if (absLat < 30) zonalMs = -5.5 * Math.cos(lat * DEG);
  else if (absLat < 62) zonalMs = 7.5 + 4.5 * Math.sin(((absLat - 30) / 32) * Math.PI);
  else zonalMs = -4.2;

  const tropicalPull = Math.exp(-((absLat / 34) ** 2));
  const meridionalMs = clamp((localThermalEquator - lat) * 0.34 * tropicalPull, -8.5, 8.5);
  const seasonalJetShift = Math.sin((lat - localThermalEquator) * DEG * 2) * (absLat > 22 ? 1.8 : 0.6);
  zonalMs += seasonalJetShift;

  return { eastMs: zonalMs, northMs: meridionalMs, itczLatitude: localThermalEquator, local };
}

function offsetUpwind(latitude, longitude, eastMs, northMs, degrees) {
  const speed = Math.max(0.2, Math.hypot(eastMs, northMs));
  const northUnit = northMs / speed;
  const eastUnit = eastMs / speed;
  const lat = clamp(latitude - northUnit * degrees, -89.5, 89.5);
  const lonScale = Math.max(0.18, Math.cos(latitude * DEG));
  const lon = wrapLongitude(longitude - eastUnit * degrees / lonScale);
  return { latitude: lat, longitude: lon };
}

function moistureFetch(state, monthIndex, latitude, longitude, wind, checkpointClimate = null) {
  const sampleDistances = [1.5, 3.5, 6.5, 10.5, 15.5, 22.5];
  let oceanWeight = 0;
  let totalWeight = 0;
  let elevatedLandWeight = 0;
  for (let i = 0; i < sampleDistances.length; i += 1) {
    const point = offsetUpwind(latitude, longitude, wind.eastMs, wind.northMs, sampleDistances[i]);
    const weight = Math.exp(-i * 0.34);
    const elevation = dynamicSurfaceElevationMeters(state, point.latitude, point.longitude);
    const ocean = elevation <= (Number(state?.seaLevel) || 0);
    totalWeight += weight;
    if (ocean) oceanWeight += weight;
    else elevatedLandWeight += weight * clamp(elevation / 3500, 0, 1);
  }
  const oceanFetch = totalWeight > 0 ? oceanWeight / totalWeight : 0;
  const baselineRain = Math.max(0, Number(checkpointClimate?.precipitationMmPerYear) || 0);
  const baselineLandRecycle = baselineRain / (baselineRain + 900);
  const productivity = Math.max(0.02, Number(state?.productivityIndex) || 1);
  const landRecycle = (1 - oceanFetch) * baselineLandRecycle * (0.35 + 0.65 * Math.sqrt(productivity));
  const oceanWarmth = Math.exp(((Number(state?.oceanTemperatureAnomaly) || -1.27) - CHECKPOINT_777.boundary.globalTemperatureAnomaly.value) * 0.055);
  const humidityCapacity = Math.exp(((Number(state?.temperatureAnomaly) || -1.27) - CHECKPOINT_777.boundary.globalTemperatureAnomaly.value) * 0.055);
  return {
    oceanFetch,
    landRecycle,
    elevatedLandWeight,
    moistureSupply: Math.max(0.02, (0.12 + oceanFetch * oceanWarmth * 0.88 + landRecycle * 0.55) * humidityCapacity)
  };
}

function verticalMotion(state, monthIndex, latitude, longitude, wind) {
  const lat = Number(latitude) || 0;
  const itczDistance = lat - wind.itczLatitude;
  const convectiveAscent = Math.exp(-((itczDistance / 9.5) ** 2));
  const subtropicalNorth = wind.itczLatitude + 27;
  const subtropicalSouth = wind.itczLatitude - 27;
  const subtropicalSubsidence = Math.max(
    Math.exp(-(((lat - subtropicalNorth) / 9.5) ** 2)),
    Math.exp(-(((lat - subtropicalSouth) / 9.5) ** 2))
  );
  const frontalAscent = Math.exp(-(((Math.abs(lat) - 50) / 11.5) ** 2));

  const here = dynamicSurfaceElevationMeters(state, latitude, longitude);
  const near = offsetUpwind(latitude, longitude, wind.eastMs, wind.northMs, 2.5);
  const far = offsetUpwind(latitude, longitude, wind.eastMs, wind.northMs, 6.0);
  const nearElevation = dynamicSurfaceElevationMeters(state, near.latitude, near.longitude);
  const farElevation = dynamicSurfaceElevationMeters(state, far.latitude, far.longitude);
  const upwindBase = Math.min(nearElevation, farElevation);
  const upwindCrest = Math.max(nearElevation, farElevation);
  const orographicLift = clamp((here - upwindBase) / 1800, 0, 1.8);
  const rainShadow = clamp((upwindCrest - here) / 2200, 0, 1.5);
  return { convectiveAscent, subtropicalSubsidence, frontalAscent, orographicLift, rainShadow };
}

export function atmosphericCirculationAt(state, monthIndex, latitude, longitude, checkpointClimate = null) {
  const wind = circulationWind(state, monthIndex, latitude, longitude);
  const moisture = moistureFetch(state, monthIndex, latitude, longitude, wind, checkpointClimate);
  const vertical = verticalMotion(state, monthIndex, latitude, longitude, wind);
  const ascent = 0.18 + vertical.convectiveAscent * 1.65 + vertical.frontalAscent * 0.62 + vertical.orographicLift * 0.78;
  const drying = Math.exp(-vertical.subtropicalSubsidence * 1.05 - vertical.rainShadow * 0.68);
  const precipitationPotential = Math.max(1e-6, moisture.moistureSupply * ascent * drying);
  const pressureProxy = -wind.local.thermal * 0.11 + vertical.subtropicalSubsidence * 2.4 - vertical.convectiveAscent * 1.8;
  return Object.freeze({
    policy: GENERAL_ATMOSPHERE_POLICY,
    monthIndex: Number(monthIndex),
    latitude: Number(latitude),
    longitude: wrapLongitude(longitude),
    land: wind.local.land,
    elevationMeters: round(wind.local.elevation, 1),
    insolationIndex: round(wind.local.insolation, 6),
    thermalIndex: round(wind.local.thermal, 4),
    pressureProxy: round(pressureProxy, 4),
    itczLatitude: round(wind.itczLatitude, 3),
    windEastMs: round(wind.eastMs, 3),
    windNorthMs: round(wind.northMs, 3),
    windSpeedMs: round(Math.hypot(wind.eastMs, wind.northMs), 3),
    oceanMoistureFetch: round(moisture.oceanFetch, 4),
    landMoistureRecycling: round(moisture.landRecycle, 4),
    moistureSupplyIndex: round(moisture.moistureSupply, 5),
    convectiveAscent: round(vertical.convectiveAscent, 5),
    subtropicalSubsidence: round(vertical.subtropicalSubsidence, 5),
    frontalAscent: round(vertical.frontalAscent, 5),
    orographicLift: round(vertical.orographicLift, 5),
    rainShadow: round(vertical.rainShadow, 5),
    precipitationPotential: round(precipitationPotential, 7),
    epistemicStatus: "general intermediate-complexity atmosphere: orbital insolation, land-ocean thermal contrast, zonal/meridional circulation, moisture fetch, ascent/subsidence and orographic response; no geographic outcome is hard-coded"
  });
}

export function branchAtmosphereResponseAt(state, monthIndex, latitude, longitude, checkpointClimate = null) {
  if ((Number(state?.elapsedYears) || 0) <= 0) {
    const checkpoint = atmosphericCirculationAt(CHECKPOINT_STATE, monthIndex, latitude, longitude, checkpointClimate);
    return Object.freeze({
      current: checkpoint,
      checkpoint,
      temperatureDeltaCelsius: 0,
      precipitationScale: 1,
      cloudDeltaPercent: 0
    });
  }
  const current = atmosphericCirculationAt(state, monthIndex, latitude, longitude, checkpointClimate);
  const checkpoint = atmosphericCirculationAt(CHECKPOINT_STATE, monthIndex, latitude, longitude, checkpointClimate);
  const globalDelta = (Number(state?.temperatureAnomaly) || CHECKPOINT_777.boundary.globalTemperatureAnomaly.value)
    - CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
  const polarWeight = Math.sin(Number(latitude) * DEG) ** 2;
  const insolationDelta = current.insolationIndex - checkpoint.insolationIndex;
  const surfaceContrast = current.land ? 1.45 : 0.72;
  const temperatureDeltaCelsius = globalDelta * (0.82 + polarWeight * 0.62)
    + insolationDelta * 8.5 * surfaceContrast;
  const rawPrecipitationScale = current.precipitationPotential / Math.max(1e-7, checkpoint.precipitationPotential);
  const precipitationScale = Math.max(0.015, rawPrecipitationScale);
  const cloudDeltaPercent = Math.log(precipitationScale) * 16 - temperatureDeltaCelsius * 0.38
    + (current.convectiveAscent - checkpoint.convectiveAscent) * 15;
  return Object.freeze({ current, checkpoint, temperatureDeltaCelsius, precipitationScale, cloudDeltaPercent });
}

export function annualAtmosphereResponseAt(state, latitude, longitude, checkpointClimate = null) {
  const months = [1, 4, 7, 10].map((month) => branchAtmosphereResponseAt(state, month, latitude, longitude, checkpointClimate));
  const geometricPrecipitationScale = Math.exp(months.reduce((sum, month) => sum + Math.log(Math.max(1e-8, month.precipitationScale)), 0) / months.length);
  return Object.freeze({
    policy: GENERAL_ATMOSPHERE_POLICY,
    precipitationScale: geometricPrecipitationScale,
    temperatureDeltaCelsius: months.reduce((sum, month) => sum + month.temperatureDeltaCelsius, 0) / months.length,
    cloudDeltaPercent: months.reduce((sum, month) => sum + month.cloudDeltaPercent, 0) / months.length,
    meanItczLatitude: months.reduce((sum, month) => sum + month.current.itczLatitude, 0) / months.length,
    meanWindSpeedMs: months.reduce((sum, month) => sum + month.current.windSpeedMs, 0) / months.length
  });
}
