import { CHECKPOINT_777 } from "../data/checkpoint-777.js";
import {
  GENERAL_ATMOSPHERE_POLICY,
  branchAtmosphereResponseAt
} from "./GeneralAtmosphereCirculation.js";
import {
  LAND_SURFACE_FEEDBACK_POLICY,
  landSurfaceFeedbackAt
} from "./LandSurfaceFeedback.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const round = (value, digits = 3) => Number(value.toFixed(digits));

export const HYDROCLIMATE_POLICY = "krapp-777-general-circulation-land-surface-branch-v4";

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

function meanFinite(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export class SpatialHydroClimate {
  constructor(krappClimate) {
    if (!krappClimate?.annualAt || !krappClimate?.monthlyAt) {
      throw new TypeError("SpatialHydroClimate requires a Krapp climate layer with annualAt() and monthlyAt().");
    }
    this.baseline = krappClimate;
    this.checkpointVegetation = null;
    this.cache = new Map();
    this.monthlyCache = new Map();
    this.cacheSignature = null;
  }

  setCheckpointVegetation(vegetationLayer) {
    if (vegetationLayer != null && !vegetationLayer?.annualAt) {
      throw new TypeError("Checkpoint vegetation coupling requires an annualAt() source.");
    }
    this.checkpointVegetation = vegetationLayer ?? null;
    this.cache.clear();
    this.monthlyCache.clear();
    this.cacheSignature = null;
    return Boolean(this.checkpointVegetation);
  }

  _stateSignature(globalState, spacing) {
    return [
      spacing,
      round(globalState.temperatureAnomaly ?? 0, 3),
      round(globalState.oceanTemperatureAnomaly ?? globalState.temperatureAnomaly ?? 0, 3),
      round(globalState.iceIndex ?? 0, 4),
      round(globalState.eccentricity ?? 0, 6),
      round(globalState.obliquity ?? 0, 4),
      round(globalState.precession ?? 0, 2),
      round(globalState.seaLevel ?? 0, 1),
      round(globalState.tectonicTimeMyr ?? 0, 5),
      round(globalState.tectonicBoundaryActivity ?? 1, 3),
      round(globalState.productivityIndex ?? 1, 3),
      this.checkpointVegetation ? LAND_SURFACE_FEEDBACK_POLICY : "no-land-surface-vegetation"
    ].join("|");
  }

  _prepareCache(globalState, spacing) {
    const signature = this._stateSignature(globalState, spacing);
    if (signature !== this.cacheSignature) {
      this.cache.clear();
      this.monthlyCache.clear();
      this.cacheSignature = signature;
    }
  }

  _monthly(globalState, month, cell, spacing) {
    const monthIndex = mod(Math.floor(Number(month) || 0), 12);
    const key = `${cell.row}:${cell.col}:${monthIndex}`;
    if (this.monthlyCache.has(key)) return this.monthlyCache.get(key);
    const checkpoint = this.baseline.monthlyAt(monthIndex, cell.latitude, cell.longitude);
    if (!checkpoint || !Number.isFinite(checkpoint.temperatureCelsius)) {
      this.monthlyCache.set(key, null);
      return null;
    }

    const firstPass = branchAtmosphereResponseAt(globalState, monthIndex, cell.latitude, cell.longitude, checkpoint);
    let response = firstPass;
    let landSurface = null;
    if ((globalState.elapsedYears ?? 0) > 0 && this.checkpointVegetation) {
      const checkpointVegetation = this.checkpointVegetation.annualAt(cell.latitude, cell.longitude);
      if (checkpointVegetation) {
        const firstPassClimate = {
          temperatureCelsius: checkpoint.temperatureCelsius + firstPass.temperatureDeltaCelsius,
          precipitationMmPerYear: Number.isFinite(checkpoint.precipitationMmPerYear)
            ? checkpoint.precipitationMmPerYear * firstPass.precipitationScale
            : null,
          cloudCoverPercent: Number.isFinite(checkpoint.cloudCoverPercent)
            ? clamp(checkpoint.cloudCoverPercent + firstPass.cloudDeltaPercent, 0, 100)
            : null
        };
        landSurface = landSurfaceFeedbackAt(globalState, checkpointVegetation, checkpoint, firstPassClimate);
        if (landSurface?.active) {
          response = branchAtmosphereResponseAt(
            globalState,
            monthIndex,
            cell.latitude,
            cell.longitude,
            checkpoint,
            landSurface
          );
        }
      }
    }

    const temperatureCelsius = checkpoint.temperatureCelsius + response.temperatureDeltaCelsius;
    const precipitationMmPerYear = Number.isFinite(checkpoint.precipitationMmPerYear)
      ? checkpoint.precipitationMmPerYear * response.precipitationScale
      : null;
    const cloudCoverPercent = Number.isFinite(checkpoint.cloudCoverPercent)
      ? clamp(checkpoint.cloudCoverPercent + response.cloudDeltaPercent, 0, 100)
      : null;
    const result = Object.freeze({
      month: checkpoint.month,
      monthIndex,
      latitude: cell.latitude,
      longitude: cell.longitude,
      gridSpacingDegrees: spacing,
      temperatureCelsius: round(temperatureCelsius, 3),
      precipitationMmPerYear: precipitationMmPerYear == null ? null : round(precipitationMmPerYear, 2),
      precipitationMmThisMonth: precipitationMmPerYear == null ? null : round(precipitationMmPerYear / 12, 2),
      cloudCoverPercent: cloudCoverPercent == null ? null : round(cloudCoverPercent, 2),
      temperatureDelta: round(response.temperatureDeltaCelsius, 4),
      precipitationScale: round(response.precipitationScale, 6),
      atmospherePolicy: GENERAL_ATMOSPHERE_POLICY,
      itczLatitude: response.current.itczLatitude,
      windEastMs: response.current.windEastMs,
      windNorthMs: response.current.windNorthMs,
      windSpeedMs: response.current.windSpeedMs,
      oceanMoistureFetch: response.current.oceanMoistureFetch,
      landMoistureRecycling: response.current.landMoistureRecycling,
      moistureSupplyIndex: response.current.moistureSupplyIndex,
      convectiveAscent: response.current.convectiveAscent,
      subtropicalSubsidence: response.current.subtropicalSubsidence,
      orographicLift: response.current.orographicLift,
      rainShadow: response.current.rainShadow,
      landSurfacePolicy: landSurface?.policy ?? null,
      landSurfaceFeedbackActive: Boolean(landSurface?.active),
      estimatedVegetationLai: landSurface?.estimatedLai ?? null,
      vegetationCoverFraction: landSurface?.vegetationCover ?? null,
      surfaceAlbedoDelta: landSurface?.surfaceAlbedoDelta ?? 0,
      evaporativeFractionDelta: landSurface?.evaporativeFractionDelta ?? 0,
      moistureRecyclingRatio: landSurface?.moistureRecyclingRatio ?? 1,
      roughnessLogRatio: landSurface?.roughnessLogRatio ?? 0,
      policy: HYDROCLIMATE_POLICY,
      epistemicStatus: (globalState.elapsedYears ?? 0) > 0
        ? `study-constrained Krapp checkpoint evolved by a general atmosphere response${landSurface?.active ? " with deterministic two-pass vegetation-water land-surface feedback" : ""}: orbital-seasonal insolation, land-ocean thermal contrast, winds, moisture transport, ascent/subsidence and orography`
        : "study-constrained Krapp checkpoint climate; general atmosphere diagnostics are initialized but contribute zero branch anomaly"
    });
    this.monthlyCache.set(key, result);
    return result;
  }

  sample(globalState, latitude, longitude, spatialDetail = 0.35) {
    const spacing = gridSpacingForSpatialDetail(spatialDetail);
    this._prepareCache(globalState, spacing);
    const cell = gridCell(latitude, longitude, spacing);
    const key = `${cell.row}:${cell.col}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const checkpoint = this.baseline.annualAt(cell.latitude, cell.longitude);
    if (!checkpoint || !Number.isFinite(checkpoint.temperatureCelsius)) {
      this.cache.set(key, null);
      return null;
    }

    if ((globalState.elapsedYears ?? 0) <= 0) {
      const moisture = waterBalanceIndex(checkpoint.temperatureCelsius, checkpoint.precipitationMmPerYear, checkpoint.cloudCoverPercent);
      const runoff = runoffPotential(checkpoint.precipitationMmPerYear, moisture);
      const january = this._monthly(globalState, 0, cell, spacing);
      const result = Object.freeze({
        latitude: cell.latitude,
        longitude: cell.longitude,
        gridSpacingDegrees: spacing,
        temperatureCelsius: round(checkpoint.temperatureCelsius, 3),
        precipitationMmPerYear: checkpoint.precipitationMmPerYear,
        cloudCoverPercent: checkpoint.cloudCoverPercent,
        soilMoistureIndex: moisture == null ? null : round(moisture, 4),
        runoffPotentialMmPerYear: runoff == null ? null : round(runoff, 2),
        checkpointTemperatureCelsius: round(checkpoint.temperatureCelsius, 3),
        checkpointPrecipitationMmPerYear: checkpoint.precipitationMmPerYear,
        checkpointCloudCoverPercent: checkpoint.cloudCoverPercent,
        temperatureDelta: 0,
        precipitationScale: 1,
        atmospherePolicy: GENERAL_ATMOSPHERE_POLICY,
        itczLatitude: january?.itczLatitude ?? null,
        windEastMs: january?.windEastMs ?? null,
        windNorthMs: january?.windNorthMs ?? null,
        windSpeedMs: january?.windSpeedMs ?? null,
        oceanMoistureFetch: january?.oceanMoistureFetch ?? null,
        convectiveAscent: january?.convectiveAscent ?? null,
        subtropicalSubsidence: january?.subtropicalSubsidence ?? null,
        orographicLift: january?.orographicLift ?? null,
        rainShadow: january?.rainShadow ?? null,
        landSurfacePolicy: null,
        landSurfaceFeedbackActive: false,
        policy: HYDROCLIMATE_POLICY,
        epistemicStatus: "study-constrained Krapp checkpoint climate; general atmosphere diagnostics are initialized but contribute zero branch anomaly"
      });
      this.cache.set(key, result);
      return result;
    }

    const months = Array.from({ length: 12 }, (_, month) => this._monthly(globalState, month, cell, spacing)).filter(Boolean);
    const temperatureCelsius = meanFinite(months.map((month) => month.temperatureCelsius));
    const precipitationMmPerYear = meanFinite(months.map((month) => month.precipitationMmPerYear));
    const cloudCoverPercent = meanFinite(months.map((month) => month.cloudCoverPercent));
    const soilMoistureIndex = waterBalanceIndex(temperatureCelsius, precipitationMmPerYear, cloudCoverPercent);
    const runoffPotentialMmPerYear = runoffPotential(precipitationMmPerYear, soilMoistureIndex);
    const precipitationScale = Number.isFinite(checkpoint.precipitationMmPerYear) && checkpoint.precipitationMmPerYear > 0
      ? precipitationMmPerYear / checkpoint.precipitationMmPerYear
      : meanFinite(months.map((month) => month.precipitationScale));
    const wettest = [...months].filter((month) => Number.isFinite(month.precipitationMmPerYear)).sort((a, b) => b.precipitationMmPerYear - a.precipitationMmPerYear)[0] ?? months[0];

    const result = Object.freeze({
      latitude: cell.latitude,
      longitude: cell.longitude,
      gridSpacingDegrees: spacing,
      temperatureCelsius: temperatureCelsius == null ? null : round(temperatureCelsius, 3),
      precipitationMmPerYear: precipitationMmPerYear == null ? null : round(precipitationMmPerYear, 2),
      cloudCoverPercent: cloudCoverPercent == null ? null : round(cloudCoverPercent, 2),
      soilMoistureIndex: soilMoistureIndex == null ? null : round(soilMoistureIndex, 4),
      runoffPotentialMmPerYear: runoffPotentialMmPerYear == null ? null : round(runoffPotentialMmPerYear, 2),
      checkpointTemperatureCelsius: round(checkpoint.temperatureCelsius, 3),
      checkpointPrecipitationMmPerYear: checkpoint.precipitationMmPerYear,
      checkpointCloudCoverPercent: checkpoint.cloudCoverPercent,
      temperatureDelta: temperatureCelsius == null ? null : round(temperatureCelsius - checkpoint.temperatureCelsius, 4),
      precipitationScale: precipitationScale == null ? null : round(precipitationScale, 6),
      atmospherePolicy: GENERAL_ATMOSPHERE_POLICY,
      itczLatitude: wettest?.itczLatitude ?? null,
      windEastMs: wettest?.windEastMs ?? null,
      windNorthMs: wettest?.windNorthMs ?? null,
      windSpeedMs: wettest?.windSpeedMs ?? null,
      oceanMoistureFetch: wettest?.oceanMoistureFetch ?? null,
      landMoistureRecycling: wettest?.landMoistureRecycling ?? null,
      moistureSupplyIndex: wettest?.moistureSupplyIndex ?? null,
      convectiveAscent: wettest?.convectiveAscent ?? null,
      subtropicalSubsidence: wettest?.subtropicalSubsidence ?? null,
      orographicLift: wettest?.orographicLift ?? null,
      rainShadow: wettest?.rainShadow ?? null,
      wettestMonthIndex: wettest?.monthIndex ?? null,
      landSurfacePolicy: wettest?.landSurfacePolicy ?? null,
      landSurfaceFeedbackActive: months.some((month) => month.landSurfaceFeedbackActive),
      estimatedVegetationLai: wettest?.estimatedVegetationLai ?? null,
      vegetationCoverFraction: wettest?.vegetationCoverFraction ?? null,
      surfaceAlbedoDelta: wettest?.surfaceAlbedoDelta ?? 0,
      evaporativeFractionDelta: wettest?.evaporativeFractionDelta ?? 0,
      moistureRecyclingRatio: wettest?.moistureRecyclingRatio ?? 1,
      roughnessLogRatio: wettest?.roughnessLogRatio ?? 0,
      policy: HYDROCLIMATE_POLICY,
      epistemicStatus: `study-constrained Krapp checkpoint evolved by a general atmosphere response${months.some((month) => month.landSurfaceFeedbackActive) ? " with deterministic two-pass vegetation-water land-surface feedback" : ""}: orbital-seasonal insolation, land-ocean thermal contrast, winds, moisture transport, ascent/subsidence and orography`
    });
    this.cache.set(key, result);
    return result;
  }

  monthlyAt(globalState, month, latitude, longitude, spatialDetail = 0.35) {
    const spacing = gridSpacingForSpatialDetail(spatialDetail);
    this._prepareCache(globalState, spacing);
    const cell = gridCell(latitude, longitude, spacing);
    return this._monthly(globalState, month, cell, spacing);
  }

  diagnostics(globalState, spatialDetail = 0.35) {
    return Object.freeze({
      policy: HYDROCLIMATE_POLICY,
      atmospherePolicy: GENERAL_ATMOSPHERE_POLICY,
      landSurfacePolicy: this.checkpointVegetation ? LAND_SURFACE_FEEDBACK_POLICY : null,
      landSurfaceFeedbackEnabled: Boolean(this.checkpointVegetation),
      landSurfaceSolvePasses: this.checkpointVegetation ? 2 : 1,
      gridSpacingDegrees: gridSpacingForSpatialDetail(spatialDetail),
      spatialDetail: clamp(Number(spatialDetail) || 0, 0, 1),
      cachedCells: this.cache.size,
      cachedMonthlyCells: this.monthlyCache.size,
      stateSignature: this._stateSignature(globalState, gridSpacingForSpatialDetail(spatialDetail)),
      mechanisms: Object.freeze([
        "orbital-seasonal insolation",
        "land-ocean heat-capacity contrast",
        "Hadley/ITCZ migration",
        "trade/westerly/polar wind regimes",
        "upwind ocean moisture fetch",
        this.checkpointVegetation ? "vegetation-water evapotranspiration and moisture recycling" : "land moisture recycling proxy",
        this.checkpointVegetation ? "vegetation-dependent albedo and aerodynamic roughness" : "baseline surface thermal response",
        "subtropical subsidence",
        "frontal ascent",
        "orographic lift and rain shadow",
        "dynamic tectonic elevation"
      ]),
      geographicSpecialCases: 0,
      epistemicStatus: `runtime materialization policy and general intermediate-complexity atmospheric response${this.checkpointVegetation ? " with deterministic two-pass land-surface coupling" : ""}; not a primitive-equation GCM or an observation`
    });
  }
}
