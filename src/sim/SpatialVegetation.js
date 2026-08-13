import { checkpointState, CHECKPOINT_777 } from "../data/checkpoint-777.js";
import { evaluateBiome4PftClimateEligibility } from "./Biome4PftEligibility.js";
import { biome4MaximumSnowDepth } from "./Biome4Snow.js";
import { evaluateBiome4PftWaterPhenology } from "./Biome4PftWaterPhenology.js";
import { runBiome4VirtualPftHydrologyTrial } from "./Biome4VirtualPftHydrology.js";
import { MassConservingHydrology } from "./MassConservingHydrology.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 4) => Number(value.toFixed(digits));

export const SPATIAL_VEGETATION_POLICY = "biome4-checkpoint-hydro-co2-response-v1";

function responseFactor(globalState, currentHydrology, checkpointHydrology) {
  let waterRatio = 1;
  const currentAet = currentHydrology?.actualEvapotranspirationMmPerYear;
  const checkpointAet = checkpointHydrology?.actualEvapotranspirationMmPerYear;
  if (Number.isFinite(currentAet) && Number.isFinite(checkpointAet) && checkpointAet > 5) {
    waterRatio = clamp(currentAet / checkpointAet, 0.15, 4);
  } else {
    const currentMoisture = currentHydrology?.soilMoistureIndex;
    const checkpointMoisture = checkpointHydrology?.soilMoistureIndex;
    if (Number.isFinite(currentMoisture) && Number.isFinite(checkpointMoisture) && checkpointMoisture > 0.02) {
      waterRatio = clamp(currentMoisture / checkpointMoisture, 0.15, 4);
    }
  }

  const co2 = clamp(globalState.co2 ?? CHECKPOINT_777.boundary.co2.value, 120, 600);
  const checkpointCo2 = CHECKPOINT_777.boundary.co2.value;
  const co2Ratio = clamp((co2 / checkpointCo2) ** 0.25, 0.75, 1.35);
  return clamp(waterRatio ** 0.65 * co2Ratio, 0.15, 2.5);
}

function climateEligibility(hydrology, pftDrivers, globalState, latitude, longitude, detail) {
  const climate = hydrology?.climate;
  if (!climate?.monthlyAt) return null;
  const monthlyTemperatures = [];
  const monthlyPrecipitation = [];
  for (let month = 0; month < 12; month += 1) {
    const sample = climate.monthlyAt(globalState, month, latitude, longitude, detail);
    if (!Number.isFinite(sample?.temperatureCelsius) || !Number.isFinite(sample?.precipitationMmPerYear)) return null;
    monthlyTemperatures.push(sample.temperatureCelsius);
    monthlyPrecipitation.push(sample.precipitationMmPerYear);
  }
  const tmin = pftDrivers?.absoluteMinimumTemperatureAt?.(latitude, longitude) ?? null;
  const snow = biome4MaximumSnowDepth(monthlyTemperatures, monthlyPrecipitation);
  const result = evaluateBiome4PftClimateEligibility(monthlyTemperatures, {
    absoluteMinimumTemperatureCelsius: tmin?.temperatureCelsius ?? null,
    maximumSnowDepthModelUnits: snow.maximumSnowDepthModelUnits
  });
  return Object.freeze({
    ...result,
    sourceAbsoluteMinimumTemperatureCelsius: tmin?.temperatureCelsius ?? null,
    absoluteMinimumDriverSource: tmin?.source ?? null,
    snow
  });
}

export class SpatialVegetation {
  constructor(checkpointVegetation, hydrology, pftDrivers = null) {
    if (!checkpointVegetation?.annualAt || !checkpointVegetation?.monthlyNppAt) {
      throw new TypeError("SpatialVegetation requires a Krapp777VegetationLayer-like checkpoint source.");
    }
    if (!hydrology?.sample) {
      throw new TypeError("SpatialVegetation requires a MassConservingHydrology-like source.");
    }
    this.checkpoint = checkpointVegetation;
    this.hydrology = hydrology;
    this.pftDrivers = pftDrivers;
    this.checkpointHydrology = hydrology instanceof MassConservingHydrology
      ? new MassConservingHydrology(hydrology.climate, hydrology.soil)
      : hydrology;
    this.checkpointState = checkpointState();
    this.cache = new Map();
    this.pftDiagnosticCache = new Map();
    this.cacheSignature = null;
  }

  _signature(globalState, spatialDetail) {
    return [
      round(globalState.temperatureAnomaly ?? 0, 3),
      round(globalState.iceIndex ?? 0, 4),
      round(globalState.co2 ?? CHECKPOINT_777.boundary.co2.value, 2),
      round(spatialDetail, 2)
    ].join("|");
  }

  _pftDiagnosticSignature(globalState, spatialDetail) {
    return [
      round(globalState.temperatureAnomaly ?? 0, 1),
      round(globalState.iceIndex ?? 0, 2),
      round(globalState.co2 ?? CHECKPOINT_777.boundary.co2.value, 0),
      round(spatialDetail, 1)
    ].join("|");
  }

  _prepare(globalState, spatialDetail) {
    const signature = this._signature(globalState, spatialDetail);
    if (signature !== this.cacheSignature) {
      this.cache.clear();
      this.cacheSignature = signature;
    }
  }

  sample(globalState, latitude, longitude, spatialDetail = 0.35) {
    const detail = clamp(spatialDetail, 0, 1);
    this._prepare(globalState, detail);
    const currentHydrology = this.hydrology.sample(globalState, latitude, longitude, detail);
    const sampleLatitude = currentHydrology?.latitude ?? latitude;
    const sampleLongitude = currentHydrology?.longitude ?? longitude;
    const spacing = currentHydrology?.gridSpacingDegrees ?? this.checkpoint.meta?.spacingDegrees ?? 0.5;
    const key = `${sampleLatitude}:${sampleLongitude}:${spacing}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const published = this.checkpoint.annualAt(sampleLatitude, sampleLongitude);
    if (!published || !Number.isFinite(published.npp)) return null;

    const isCheckpoint = (globalState.elapsedYears ?? 0) <= 0;
    let factor = 1;
    let checkpointHydrology = null;
    if (!isCheckpoint) {
      checkpointHydrology = this.checkpointHydrology.sample(this.checkpointState, sampleLatitude, sampleLongitude, detail);
      factor = responseFactor(globalState, currentHydrology, checkpointHydrology);
    }

    const pftClimate = climateEligibility(this.hydrology, this.pftDrivers, globalState, sampleLatitude, sampleLongitude, detail);
    const npp = published.npp * factor;
    const lai = Number.isFinite(published.lai)
      ? published.lai * clamp(factor ** 0.55, 0.25, 1.8)
      : null;
    const transitionPressure = isCheckpoint ? 0 : clamp(Math.abs(Math.log(Math.max(1e-6, factor))) / Math.log(2.5), 0, 1);
    const result = Object.freeze({
      latitude: sampleLatitude,
      longitude: sampleLongitude,
      gridSpacingDegrees: spacing,
      biomeCode: published.biomeCode,
      biomeLabel: published.biomeLabel,
      npp: round(npp, 2),
      lai: Number.isFinite(lai) ? round(lai, 3) : null,
      checkpointNpp: round(published.npp, 2),
      checkpointLai: Number.isFinite(published.lai) ? round(published.lai, 3) : null,
      productivityFactor: round(factor, 4),
      transitionPressure: round(transitionPressure, 4),
      checkpointCategoryRetained: true,
      climateEligiblePftIds: pftClimate?.eligiblePftIds ?? Object.freeze([]),
      climateUnresolvedPftIds: pftClimate?.unresolvedPftIds ?? Object.freeze([]),
      climateDisabledPftIds: pftClimate?.disabledPftIds ?? Object.freeze([]),
      pftClimateIndices: pftClimate?.indices ?? null,
      pftAbsoluteMinimumDriverSource: pftClimate?.absoluteMinimumDriverSource ?? null,
      pftMaximumSnowDepthModelUnits: pftClimate?.snow?.maximumSnowDepthModelUnits ?? null,
      pftEligibilityPolicy: pftClimate?.policy ?? null,
      source: published.source,
      policy: SPATIAL_VEGETATION_POLICY,
      epistemicStatus: isCheckpoint
        ? "study-constrained published BIOME4 model output at 777 ka; BIOME4-parameter PFT climate eligibility is independently recomputed as a diagnostic only"
        : "published BIOME4 777 ka category/NPP/LAI baseline + model-derived hydroclimate and CO2 productivity response; independently recomputed BIOME4-parameter climate eligibility identifies candidate PFTs, but NPP/LAI competition and categorical biome transitions are not yet simulated"
    });
    this.cache.set(key, result);
    return result;
  }

  pftDiagnostics(globalState, latitude, longitude, spatialDetail = 0.35) {
    const detail = clamp(spatialDetail, 0, 1);
    this._prepare(globalState, detail);
    const annual = this.sample(globalState, latitude, longitude, detail);
    if (!annual) return null;
    const key = `${this._pftDiagnosticSignature(globalState, detail)}|${annual.latitude}:${annual.longitude}:${annual.gridSpacingDegrees}`;
    if (this.pftDiagnosticCache.has(key)) return this.pftDiagnosticCache.get(key);

    const trace = this.hydrology.dailyWaterTrace?.(globalState, annual.latitude, annual.longitude, detail) ?? null;
    const climateEligible = new Set(annual.climateEligiblePftIds);
    const climateUnresolved = new Set(annual.climateUnresolvedPftIds);
    const candidateIds = [...new Set([...annual.climateEligiblePftIds, ...annual.climateUnresolvedPftIds])].sort((a, b) => a - b);

    if (!trace?.dailyWaterTrace) {
      const unresolved = Object.freeze({
        status: "unresolved-water-trace",
        latitude: annual.latitude,
        longitude: annual.longitude,
        gridSpacingDegrees: annual.gridSpacingDegrees,
        biomeCode: annual.biomeCode,
        biomeLabel: annual.biomeLabel,
        checkpointCategoryRetained: true,
        hydrologyFeedbackEnabled: false,
        parallelVirtualHydrologyEnabled: false,
        candidateCount: candidateIds.length,
        resolvedCount: 0,
        candidatePftIds: Object.freeze(candidateIds),
        candidates: Object.freeze([]),
        raingreenDiscrepancyPftIds: Object.freeze([]),
        soilStatus: trace?.soilStatus ?? null,
        epistemicStatus: trace?.epistemicStatus ?? "PFT daily rooting and phenology diagnostics require a valid BIOME4 two-layer soil trace; no monthly soil approximation is substituted."
      });
      this.pftDiagnosticCache.set(key, unresolved);
      if (this.pftDiagnosticCache.size > 24) this.pftDiagnosticCache.delete(this.pftDiagnosticCache.keys().next().value);
      return unresolved;
    }

    const soilProfile = this.hydrology.soil?.profileAt?.(trace.latitude, trace.longitude) ?? null;
    const candidates = candidateIds.map((pftId) => {
      const diagnostic = evaluateBiome4PftWaterPhenology(pftId, {
        latitude: trace.latitude,
        monthlyTemperatureCelsius: trace.monthlyTemperatureCelsius,
        monthlyCloudCoverPercent: trace.monthlyCloudCoverPercent,
        dailyWaterTrace: trace.dailyWaterTrace
      });
      let virtualHydrology = null;
      if (diagnostic.status === "resolved-diagnostic" && soilProfile?.validSoil) {
        virtualHydrology = runBiome4VirtualPftHydrologyTrial({
          pftId,
          lai: annual.lai ?? annual.checkpointLai ?? 0,
          soilProfile,
          baselineDailyWaterTrace: trace.dailyWaterTrace,
          phenologyDaily: diagnostic.daily,
          latitude: trace.latitude,
          monthlyTemperatureCelsius: trace.monthlyTemperatureCelsius,
          monthlyCloudCoverPercent: trace.monthlyCloudCoverPercent,
          monthlyPrecipitationMmPerYear: trace.monthlyPrecipitationMmPerYear,
          elevationMeters: trace.elevationMeters,
          co2Ppm: globalState.co2
        });
      }
      return Object.freeze({
        ...diagnostic,
        climateEligibilityStatus: climateEligible.has(pftId) ? "eligible" : climateUnresolved.has(pftId) ? "unresolved" : "unknown",
        virtualHydrology
      });
    });
    const raingreenDiscrepancyPftIds = candidates
      .filter((candidate) => candidate.raingreenThresholdDiscrepancy)
      .map((candidate) => candidate.pftId);
    const result = Object.freeze({
      status: "resolved",
      latitude: annual.latitude,
      longitude: annual.longitude,
      gridSpacingDegrees: annual.gridSpacingDegrees,
      biomeCode: annual.biomeCode,
      biomeLabel: annual.biomeLabel,
      checkpointCategoryRetained: true,
      hydrologyFeedbackEnabled: false,
      parallelVirtualHydrologyEnabled: true,
      candidateCount: candidates.length,
      resolvedCount: candidates.filter((candidate) => candidate.status === "resolved-diagnostic").length,
      candidatePftIds: Object.freeze(candidateIds),
      candidates: Object.freeze(candidates),
      raingreenDiscrepancyPftIds: Object.freeze(raingreenDiscrepancyPftIds),
      waterBalanceResidualMm: trace.waterBalanceResidualMm,
      soilSource: trace.soilSource,
      epistemicStatus: "BIOME4-parameter daily rooting/phenology diagnostics plus independent parallel PFT water trials over the same climate and soil forcing; each candidate closes its own water budget and cannot alter shared Earth hydrology before competition selects occupancy. LAI/NPP optimization, competition, and categorical biome transitions remain disabled."
    });
    this.pftDiagnosticCache.set(key, result);
    if (this.pftDiagnosticCache.size > 24) this.pftDiagnosticCache.delete(this.pftDiagnosticCache.keys().next().value);
    return result;
  }

  monthlyAt(globalState, month, latitude, longitude, spatialDetail = 0.35) {
    const annual = this.sample(globalState, latitude, longitude, spatialDetail);
    if (!annual) return null;
    const checkpointNpp = this.checkpoint.monthlyNppAt(month, annual.latitude, annual.longitude);
    if (!Number.isFinite(checkpointNpp)) return null;
    return Object.freeze({
      month,
      npp: round(checkpointNpp * annual.productivityFactor, 2),
      checkpointNpp: round(checkpointNpp, 2),
      productivityFactor: annual.productivityFactor,
      source: annual.source,
      policy: SPATIAL_VEGETATION_POLICY,
      epistemicStatus: annual.epistemicStatus
    });
  }

  diagnostics(globalState, spatialDetail = 0.35) {
    return Object.freeze({
      policy: SPATIAL_VEGETATION_POLICY,
      stateSignature: this._signature(globalState, spatialDetail),
      cachedCells: this.cache.size,
      cachedPftDiagnostics: this.pftDiagnosticCache.size,
      checkpointSource: this.checkpoint.meta?.id ?? null,
      checkpointResolutionDegrees: this.checkpoint.meta?.spacingDegrees ?? null,
      pftClimateEligibilityIntegrated: true,
      pftWaterPhenologyIntegrated: true,
      pftHydrologyFeedbackEnabled: false,
      pftParallelVirtualHydrologyIntegrated: true,
      snowConstraintState: "BIOME4-compatible two-year degree-day snow diagnostic integrated",
      absoluteMinimumTemperatureDriverIntegrated: Boolean(this.pftDrivers),
      epistemicStatus: "published BIOME4 checkpoint with continuous branch productivity response, independently implemented BIOME4 climate candidate sieve, daily PFT rooting/phenology diagnostics, and parallel BIOME4 conductance/equilibrium-demand candidate water trials; shared hydrology feedback, LAI/NPP competition and categorical biome transitions remain disabled"
    });
  }
}
