import { CHECKPOINT_777 } from "../data/checkpoint-777.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const round = (value, digits = 3) => Number(value.toFixed(digits));

export const HYDROCLIMATE_POLICY = "krapp-777-branch-response-v2";

export function gridSpacingForSpatialDetail(spatialDetail = 0.35) {
  const detail = clamp(Number(spatialDetail) || 0, 0, 1);
  if (detail >= 0.82) return 0.5;
  if (detail >= 0.58) return 1;
  if (detail >= 0.32) return 2;
  return 4;
}

function wrapLongitude(longitude) { return mod(Number(longitude) + 180, 360) - 180; }

function gridCell(latitude, longitude, spacing) {
  const rows = Math.round(180 / spacing);
  const cols = Math.round(360 / spacing);
  const lat = clamp(Number(latitude), -90, 90);
  const lon = wrapLongitude(longitude);
  const row = clamp(Math.floor((90 - lat) / spacing), 0, rows - 1);
  const col = mod(Math.floor((lon + 180) / spacing), cols);
  return { row, col, rows, cols, latitude: 90 - (row + 0.5) * spacing, longitude: -180 + (col + 0.5) * spacing };
}

function responseState(globalState, latitude, longitude) {
  const checkpointTemperature = CHECKPOINT_777.boundary.globalTemperatureAnomaly.value;
  const checkpointIce = CHECKPOINT_777.boundary.iceVolumeIndex.value;
  const latitudeRadians = latitude * Math.PI / 180;
  const longitudeRadians = longitude * Math.PI / 180;
  const polarWeight = Math.sin(latitudeRadians) ** 2;
  const globalTemperatureDelta = (globalState.temperatureAnomaly ?? checkpointTemperature) - checkpointTemperature;
  const temperatureDelta = globalTemperatureDelta * (0.85 + polarWeight * 0.65);
  const iceDelta = (globalState.iceIndex ?? checkpointIce) - checkpointIce;

  const eccentricity = globalState.eccentricity ?? CHECKPOINT_777.boundary.eccentricity.value;
  const precession = (globalState.precession ?? CHECKPOINT_777.boundary.climaticPrecession.value) * Math.PI / 180;
  const checkpointPrecession = CHECKPOINT_777.boundary.climaticPrecession.value * Math.PI / 180;
  const orbitalMoistureNow = eccentricity * Math.cos(precession - longitudeRadians) * Math.cos(latitudeRadians);
  const orbitalMoistureCheckpoint = CHECKPOINT_777.boundary.eccentricity.value
    * Math.cos(checkpointPrecession - longitudeRadians) * Math.cos(latitudeRadians);
  const orbitalMoistureDelta = orbitalMoistureNow - orbitalMoistureCheckpoint;

  const precipitationLogScale = temperatureDelta * (0.018 + (1 - polarWeight) * 0.010)
    - iceDelta * polarWeight * 0.55
    + orbitalMoistureDelta * 4.0;
  const precipitationScale = Math.exp(precipitationLogScale);
  return { polarWeight, globalTemperatureDelta, temperatureDelta, iceDelta, orbitalMoistureDelta, precipitationScale };
}

function waterBalanceIndex(temperatureCelsius, precipitationMmPerYear, cloudCoverPercent) {
  if (!Number.isFinite(precipitationMmPerYear)) return null;
  const temperatureDemand = Math.exp(clamp(temperatureCelsius, -35, 50) * 0.032);
  const cloudRelief = 1 - clamp((cloudCoverPercent ?? 50) / 100, 0, 1) * 0.18;
  const atmosphericDemand = 620 * temperatureDemand * cloudRelief;
  return clamp(precipitationMmPerYear / (precipitationMmPerYear + atmosphericDemand), 0.001, 0.999);
}

function runoffPotential(precipitationMmPerYear, soilMoistureIndex) {
  if (!Number.isFinite(precipitationMmPerYear) || !Number.isFinite(soilMoistureIndex)) return null;
  const excessFraction = clamp((soilMoistureIndex - 0.34) / 0.66, 0, 1);
  return precipitationMmPerYear * excessFraction * 0.58;
}

export class SpatialHydroClimate {
  constructor(krappClimate) {
    if (!krappClimate?.annualAt || !krappClimate?.monthlyAt) {
      throw new TypeError("SpatialHydroClimate requires a Krapp climate layer with annualAt() and monthlyAt().");
    }
    this.baseline = krappClimate;
    this.cache = new Map();
    this.cacheSignature = null;
  }

  _stateSignature(globalState, spacing) {
    return [spacing, round(globalState.temperatureAnomaly ?? 0, 3), round(globalState.iceIndex ?? 0, 4),
      round(globalState.eccentricity ?? 0, 5), round(globalState.precession ?? 0, 1), round(globalState.seaLevel ?? 0, 1)].join("|");
  }

  _prepareCache(globalState, spacing) {
    const signature = this._stateSignature(globalState, spacing);
    if (signature !== this.cacheSignature) { this.cache.clear(); this.cacheSignature = signature; }
  }

  sample(globalState, latitude, longitude, spatialDetail = 0.35) {
    const spacing = gridSpacingForSpatialDetail(spatialDetail);
    this._prepareCache(globalState, spacing);
    const cell = gridCell(latitude, longitude, spacing);
    const key = `${cell.row}:${cell.col}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const checkpoint = this.baseline.annualAt(cell.latitude, cell.longitude);
    if (!checkpoint || !Number.isFinite(checkpoint.temperatureCelsius)) { this.cache.set(key, null); return null; }

    const response = responseState(globalState, cell.latitude, cell.longitude);
    const temperatureCelsius = checkpoint.temperatureCelsius + response.temperatureDelta;
    const precipitationMmPerYear = Number.isFinite(checkpoint.precipitationMmPerYear)
      ? checkpoint.precipitationMmPerYear * response.precipitationScale : null;
    const cloudCoverPercent = Number.isFinite(checkpoint.cloudCoverPercent)
      ? clamp(checkpoint.cloudCoverPercent + Math.log(response.precipitationScale) * 18 - response.temperatureDelta * 0.65, 0, 100) : null;
    const soilMoistureIndex = waterBalanceIndex(temperatureCelsius, precipitationMmPerYear, cloudCoverPercent);
    const runoffPotentialMmPerYear = runoffPotential(precipitationMmPerYear, soilMoistureIndex);

    const result = Object.freeze({
      latitude: cell.latitude, longitude: cell.longitude, gridSpacingDegrees: spacing,
      temperatureCelsius: round(temperatureCelsius, 3),
      precipitationMmPerYear: precipitationMmPerYear == null ? null : round(precipitationMmPerYear, 2),
      cloudCoverPercent: cloudCoverPercent == null ? null : round(cloudCoverPercent, 2),
      soilMoistureIndex: soilMoistureIndex == null ? null : round(soilMoistureIndex, 4),
      runoffPotentialMmPerYear: runoffPotentialMmPerYear == null ? null : round(runoffPotentialMmPerYear, 2),
      checkpointTemperatureCelsius: round(checkpoint.temperatureCelsius, 3),
      checkpointPrecipitationMmPerYear: checkpoint.precipitationMmPerYear,
      checkpointCloudCoverPercent: checkpoint.cloudCoverPercent,
      temperatureDelta: round(response.temperatureDelta, 4), precipitationScale: round(response.precipitationScale, 5),
      orbitalMoistureDelta: round(response.orbitalMoistureDelta, 6), policy: HYDROCLIMATE_POLICY,
      epistemicStatus: globalState.elapsedYears > 0
        ? "model derived branch response from study-constrained Krapp checkpoint; temperature, precipitation and cloud respond to greenhouse climate, ice and orbital seasonality"
        : "study-constrained Krapp checkpoint climate; moisture/runoff are model-derived diagnostic proxies"
    });
    this.cache.set(key, result);
    return result;
  }

  monthlyAt(globalState, month, latitude, longitude, spatialDetail = 0.35) {
    const spacing = gridSpacingForSpatialDetail(spatialDetail);
    const cell = gridCell(latitude, longitude, spacing);
    const checkpoint = this.baseline.monthlyAt(month, cell.latitude, cell.longitude);
    if (!checkpoint || !Number.isFinite(checkpoint.temperatureCelsius)) return null;
    const response = responseState(globalState, cell.latitude, cell.longitude);
    const temperatureCelsius = checkpoint.temperatureCelsius + response.temperatureDelta;
    const precipitationMmPerYear = Number.isFinite(checkpoint.precipitationMmPerYear)
      ? checkpoint.precipitationMmPerYear * response.precipitationScale : null;
    const cloudCoverPercent = Number.isFinite(checkpoint.cloudCoverPercent)
      ? clamp(checkpoint.cloudCoverPercent + Math.log(response.precipitationScale) * 18 - response.temperatureDelta * 0.65, 0, 100) : null;
    return Object.freeze({
      month: checkpoint.month, monthIndex: checkpoint.monthIndex, latitude: cell.latitude, longitude: cell.longitude,
      gridSpacingDegrees: spacing, temperatureCelsius: round(temperatureCelsius, 3),
      precipitationMmPerYear: precipitationMmPerYear == null ? null : round(precipitationMmPerYear, 2),
      precipitationMmThisMonth: precipitationMmPerYear == null ? null : round(precipitationMmPerYear / 12, 2),
      cloudCoverPercent: cloudCoverPercent == null ? null : round(cloudCoverPercent, 2),
      temperatureDelta: round(response.temperatureDelta, 4), precipitationScale: round(response.precipitationScale, 5),
      orbitalMoistureDelta: round(response.orbitalMoistureDelta, 6), policy: HYDROCLIMATE_POLICY,
      epistemicStatus: globalState.elapsedYears > 0 ? "model derived branch response from study-constrained Krapp checkpoint" : "study-constrained Krapp checkpoint climate"
    });
  }

  diagnostics(globalState, spatialDetail = 0.35) {
    return Object.freeze({
      policy: HYDROCLIMATE_POLICY, gridSpacingDegrees: gridSpacingForSpatialDetail(spatialDetail),
      spatialDetail: clamp(Number(spatialDetail) || 0, 0, 1), cachedCells: this.cache.size,
      stateSignature: this._stateSignature(globalState, gridSpacingForSpatialDetail(spatialDetail)),
      epistemicStatus: "runtime materialization policy and model-derived hydroclimate response; not an observation"
    });
  }
}
