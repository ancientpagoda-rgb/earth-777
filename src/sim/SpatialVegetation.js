import { checkpointState, CHECKPOINT_777 } from "../data/checkpoint-777.js";
import { evaluateBiome4PftClimateEligibility } from "./Biome4PftEligibility.js";
import { biome4MaximumSnowDepth } from "./Biome4Snow.js";
import { evaluateBiome4PftWaterPhenology } from "./Biome4PftWaterPhenology.js";
import { runBiome4VirtualPftHydrologyTrial } from "./Biome4VirtualPftHydrology.js";
import { optimizeBiome4PftLaiNpp } from "./Biome4PftGrowth.js";
import { biome4PftCompetitionDiagnostic } from "./Biome4PftCompetition.js";
import { deriveCompetitiveBiomeSuccession } from "./BiomeSuccession.js";
import { MassConservingHydrology } from "./MassConservingHydrology.js";
import { BIOGEOCHEMISTRY_BASELINE } from "./EarthBiogeochemistry.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const positive = (value, floor = 1e-9) => Math.max(floor, Number(value) || 0);
const round = (value, digits = 4) => Number(value.toFixed(digits));

export const SPATIAL_VEGETATION_POLICY = "biome4-checkpoint-hydro-co2-n-competition-v3";

function saturatingSupply(value, halfSaturation) {
  const amount = Math.max(0, Number(value) || 0);
  return amount / (amount + halfSaturation);
}

function responseFactor(globalState, currentHydrology, checkpointHydrology) {
  let waterRatio = 1;
  const currentAet = currentHydrology?.actualEvapotranspirationMmPerYear;
  const checkpointAet = checkpointHydrology?.actualEvapotranspirationMmPerYear;
  if (Number.isFinite(currentAet) && Number.isFinite(checkpointAet) && checkpointAet > 5) {
    const currentSupply = saturatingSupply(currentAet, 650);
    const checkpointSupply = saturatingSupply(checkpointAet, 650);
    waterRatio = positive(currentSupply) / positive(checkpointSupply);
  } else {
    const currentMoisture = currentHydrology?.soilMoistureIndex;
    const checkpointMoisture = checkpointHydrology?.soilMoistureIndex;
    if (Number.isFinite(currentMoisture) && Number.isFinite(checkpointMoisture) && checkpointMoisture > 0.02) {
      waterRatio = Math.sqrt(positive(currentMoisture) / positive(checkpointMoisture));
    }
  }

  const co2 = positive(globalState.co2 ?? CHECKPOINT_777.boundary.co2.value);
  const checkpointCo2 = CHECKPOINT_777.boundary.co2.value;
  const co2Assimilation = saturatingSupply(co2, 180);
  const checkpointCo2Assimilation = saturatingSupply(checkpointCo2, 180);
  const co2Response = (co2Assimilation / checkpointCo2Assimilation) ** 0.65;

  const nitrogenBaseline = BIOGEOCHEMISTRY_BASELINE.nitrogen.terrestrialReactiveTgN;
  const nitrogenAvailability = positive(globalState.terrestrialReactiveNitrogenTgN ?? nitrogenBaseline) / nitrogenBaseline;
  return positive(waterRatio ** 0.65 * co2Response * nitrogenAvailability ** 0.16, 0.001);
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

function annualizedMonthlyMean(values) {
  if (!values || typeof values[Symbol.iterator] !== "function") return null;
  const finite = Array.from(values, Number).filter(Number.isFinite);
  if (finite.length !== 12) return null;
  return finite.reduce((sum, value) => sum + value, 0) / 12;
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
      round(globalState.terrestrialReactiveNitrogenTgN ?? BIOGEOCHEMISTRY_BASELINE.nitrogen.terrestrialReactiveTgN, 0),
      round(spatialDetail, 2)
    ].join("|");
  }

  _pftDiagnosticSignature(globalState, spatialDetail) {
    return [
      round(globalState.temperatureAnomaly ?? 0, 1),
      round(globalState.iceIndex ?? 0, 2),
      round(globalState.co2 ?? CHECKPOINT_777.boundary.co2.value, 0),
      round(globalState.terrestrialReactiveNitrogenTgN ?? BIOGEOCHEMISTRY_BASELINE.nitrogen.terrestrialReactiveTgN, 0),
      round(globalState.elapsedYears ?? 0, -2),
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
    const lai = Number.isFinite(published.lai) ? published.lai * factor ** 0.55 : null;
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
        ? "study-constrained published BIOME4 model output at 777 ka; BIOME4-parameter PFT climate eligibility is independently recomputed"
        : "published BIOME4 777 ka NPP/LAI reference + branch hydroclimate, saturating CO2 assimilation and reactive-nitrogen productivity response; selected-region diagnostics run optimized PFT competition and lagged succession"
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
        laiNppOptimizationEnabled: false,
        competitiveOccupancyEnabled: false,
        categoricalBiomeTransitionsEnabled: false,
        competition: null,
        succession: null,
        candidateCount: candidateIds.length,
        resolvedCount: 0,
        candidatePftIds: Object.freeze(candidateIds),
        candidates: Object.freeze([]),
        raingreenDiscrepancyPftIds: Object.freeze([]),
        soilStatus: trace?.soilStatus ?? null,
        epistemicStatus: trace?.epistemicStatus ?? "PFT competition requires a valid BIOME4 two-layer daily water trace; no monthly soil approximation is substituted."
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
      let laiNppOptimization = null;
      const isClimateEligible = climateEligible.has(pftId);
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
        if (isClimateEligible) {
          laiNppOptimization = optimizeBiome4PftLaiNpp({
            pftId,
            soilProfile,
            latitude: trace.latitude,
            monthlyTemperatureCelsius: trace.monthlyTemperatureCelsius,
            monthlyCloudCoverPercent: trace.monthlyCloudCoverPercent,
            monthlyPrecipitationMmPerYear: trace.monthlyPrecipitationMmPerYear,
            elevationMeters: trace.elevationMeters,
            co2Ppm: globalState.co2
          });
        }
      }
      const fireDryness = laiNppOptimization?.fireDryness ?? null;
      const fireDrynessStatus = fireDryness ? "resolved" : laiNppOptimization ? "nonproductive-no-optimum" : "not-optimized";
      return Object.freeze({
        ...diagnostic,
        climateEligibilityStatus: isClimateEligible ? "eligible" : climateUnresolved.has(pftId) ? "unresolved" : "unknown",
        virtualHydrology,
        laiNppOptimization,
        fireDryness,
        fireDrynessStatus
      });
    });

    const annualPrecipitationMm = annualizedMonthlyMean(trace.monthlyPrecipitationMmPerYear);
    let competition = null;
    if (annual.pftClimateIndices && Number.isFinite(annualPrecipitationMm)) {
      competition = biome4PftCompetitionDiagnostic({
        candidates,
        climateIndices: annual.pftClimateIndices,
        annualPrecipitationMm
      });
    }
    const succession = competition
      ? deriveCompetitiveBiomeSuccession({
          elapsedYears: globalState.elapsedYears,
          checkpointBiomeLabel: annual.biomeLabel,
          competition,
          climateIndices: annual.pftClimateIndices,
          annualPrecipitationMm,
          transitionPressure: annual.transitionPressure
        })
      : null;

    const raingreenDiscrepancyPftIds = candidates.filter((candidate) => candidate.raingreenThresholdDiscrepancy).map((candidate) => candidate.pftId);
    const result = Object.freeze({
      status: "resolved",
      latitude: annual.latitude,
      longitude: annual.longitude,
      gridSpacingDegrees: annual.gridSpacingDegrees,
      biomeCode: annual.biomeCode,
      biomeLabel: succession?.biomeLabel ?? annual.biomeLabel,
      checkpointBiomeLabel: annual.biomeLabel,
      checkpointCategoryRetained: (globalState.elapsedYears ?? 0) <= 0,
      hydrologyFeedbackEnabled: false,
      parallelVirtualHydrologyEnabled: true,
      laiNppOptimizationEnabled: true,
      fireDrynessDiagnosticsEnabled: true,
      competitiveOccupancyEnabled: Boolean(competition),
      categoricalBiomeTransitionsEnabled: Boolean(succession?.status === "resolved"),
      competition,
      succession,
      optimizedCandidateCount: candidates.filter((candidate) => candidate.laiNppOptimization).length,
      fireDrynessResolvedCount: candidates.filter((candidate) => candidate.fireDrynessStatus === "resolved").length,
      nonproductiveOptimizedCandidateCount: candidates.filter((candidate) => candidate.fireDrynessStatus === "nonproductive-no-optimum").length,
      candidateCount: candidates.length,
      resolvedCount: candidates.filter((candidate) => candidate.status === "resolved-diagnostic").length,
      candidatePftIds: Object.freeze(candidateIds),
      candidates: Object.freeze(candidates),
      raingreenDiscrepancyPftIds: Object.freeze(raingreenDiscrepancyPftIds),
      waterBalanceResidualMm: trace.waterBalanceResidualMm,
      soilSource: trace.soilSource,
      epistemicStatus: "BIOME4 climate eligibility, daily rooting/phenology, parallel candidate water trials, optimized LAI/NPP and fire dryness feed the independently reproduced competition2 selector; its selected PFT drives a lagged broad biome succession state while shared hydrology feedback remains future work."
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
      pftLaiNppOptimizationIntegrated: true,
      pftFireDrynessDiagnosticsIntegrated: true,
      pftCompetitionEnabled: true,
      categoricalBiomeTransitionsEnabled: true,
      snowConstraintState: "BIOME4-compatible two-year degree-day snow diagnostic integrated",
      absoluteMinimumTemperatureDriverIntegrated: Boolean(this.pftDrivers),
      epistemicStatus: "published BIOME4 checkpoint with branch hydroclimate/CO2/reactive-N productivity response plus selected-region PFT competition and lagged broad biome succession; shared PFT-specific hydrology feedback and the historical BIOME4 categorical classifier remain explicitly incomplete"
    });
  }
}
