import { CHECKPOINT_777 } from "../data/checkpoint-777.js";
import { projectAnimalPopulation } from "./AnimalPopulationProjection.js";
import { faunaPopulationAt } from "./FaunaRuntime.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 2) => Number(value.toFixed(digits));

function regionalFaunaAggregate(globalState, vegetationState, hydro, latitude, longitude) {
  const field = faunaPopulationAt({
    state: globalState,
    vegetationSample: vegetationState,
    hydrologySample: hydro,
    latitude,
    longitude,
    areaKm2: 1,
    key: "regional-aggregate"
  });
  const lineagePopulationProjection = projectAnimalPopulation(globalState);
  return Object.freeze({
    policy: field.policy,
    epistemicStatus: field.epistemicStatus,
    lineagePopulationProjection,
    herbivoreDensityAnimalsPerKm2: field.herbivoreDensityAnimalsPerKm2,
    carnivoreDensityAnimalsPerKm2: field.carnivoreDensityAnimalsPerKm2,
    meanHerdSize: field.meanHerdSize,
    meanPackSize: field.meanPackSize,
    predatorPressure: field.predatorPressure,
    aggregatePredationExposure: field.aggregatePredationExposure,
    predationExposure: field.predationExposure,
    preyPressure: field.preyPressure
  });
}

function biomeFromHydroClimate(globalState, latitude, temperatureCelsius, soilMoistureIndex) {
  if (Math.abs(latitude) > 72 - globalState.iceIndex * 8) return "polar ice / tundra";
  if (temperatureCelsius < -4) return "cold steppe";
  if (temperatureCelsius < 5) return soilMoistureIndex > 0.58 ? "boreal woodland" : "mammoth steppe";
  if (temperatureCelsius > 23) return soilMoistureIndex > 0.7 ? "tropical woodland" : "warm savanna";
  if (soilMoistureIndex > 0.68) return "temperate forest";
  if (soilMoistureIndex > 0.38) return "open woodland";
  if (soilMoistureIndex < 0.18) return "desert / semi-desert";
  return "dry grassland";
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

function fallbackRegionalState(globalState, latitude, longitude, climateLayer = null) {
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
    annualPrecipitation = Number.isFinite(checkpointClimate.precipitationMmPerYear)
      ? checkpointClimate.precipitationMmPerYear * branch.precipitationScale
      : null;
    cloudCover = Number.isFinite(checkpointClimate.cloudCoverPercent)
      ? clamp(checkpointClimate.cloudCoverPercent + Math.log(branch.precipitationScale) * 18 - branch.temperatureDelta * 0.65, 0, 100)
      : null;
    moisture = Number.isFinite(annualPrecipitation)
      ? clamp(annualPrecipitation / (annualPrecipitation + 700), 0.02, 0.995)
      : 0.5;
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

  const fauna = regionalFaunaAggregate(globalState, null, null, latitude, longitude);
  return Object.freeze({
    latitude,
    longitude,
    annualTemperature: round(annualTemperature, 1),
    annualPrecipitation: Number.isFinite(annualPrecipitation) ? round(annualPrecipitation, 0) : null,
    cloudCover: Number.isFinite(cloudCover) ? round(cloudCover, 1) : null,
    moisture: round(moisture, 2),
    biome: biomeFromHydroClimate(globalState, latitude, annualTemperature, moisture),
    fauna,
    climateSource,
    checkpointClimate: climateSource === "krapp-2021-777ka",
    confidence
  });
}

export function regionalState(
  globalState,
  latitude,
  longitude,
  { climateLayer = null, hydroClimate = null, vegetation = null, spatialDetail = 0.35, includePftDiagnostics = false } = {}
) {
  const hydro = hydroClimate?.sample?.(globalState, latitude, longitude, spatialDetail) ?? null;
  if (!hydro || !Number.isFinite(hydro.temperatureCelsius)) {
    return fallbackRegionalState(globalState, latitude, longitude, climateLayer);
  }

  const moisture = Number.isFinite(hydro.soilMoistureIndex) ? hydro.soilMoistureIndex : 0.5;
  const closedBudget = Number.isFinite(hydro.waterBalanceResidualMm);
  const vegetationState = vegetation?.sample?.(globalState, latitude, longitude, spatialDetail) ?? null;
  const pftWaterPhenology = includePftDiagnostics
    ? vegetation?.pftDiagnostics?.(globalState, latitude, longitude, spatialDetail) ?? null
    : null;
  const fallbackBiome = biomeFromHydroClimate(globalState, latitude, hydro.temperatureCelsius, moisture);
  const fauna = regionalFaunaAggregate(globalState, vegetationState, hydro, latitude, longitude);
  const soilProfileApplied = Boolean(hydro.soilProfileApplied);
  return Object.freeze({
    latitude,
    longitude,
    annualTemperature: round(hydro.temperatureCelsius, 1),
    annualPrecipitation: Number.isFinite(hydro.precipitationMmPerYear) ? round(hydro.precipitationMmPerYear, 0) : null,
    cloudCover: Number.isFinite(hydro.cloudCoverPercent) ? round(hydro.cloudCoverPercent, 1) : null,
    moisture: round(moisture, 2),
    runoffPotential: Number.isFinite(hydro.runoffMmPerYear)
      ? round(hydro.runoffMmPerYear, 0)
      : Number.isFinite(hydro.runoffPotentialMmPerYear) ? round(hydro.runoffPotentialMmPerYear, 0) : null,
    surfaceRunoff: Number.isFinite(hydro.surfaceRunoffMmPerYear) ? round(hydro.surfaceRunoffMmPerYear, 0) : null,
    deepDrainage: Number.isFinite(hydro.deepDrainageMmPerYear) ? round(hydro.deepDrainageMmPerYear, 0) : null,
    potentialEvapotranspiration: Number.isFinite(hydro.potentialEvapotranspirationMmPerYear)
      ? round(hydro.potentialEvapotranspirationMmPerYear, 0)
      : null,
    actualEvapotranspiration: Number.isFinite(hydro.actualEvapotranspirationMmPerYear)
      ? round(hydro.actualEvapotranspirationMmPerYear, 0)
      : null,
    soilWaterStorage: Number.isFinite(hydro.soilWaterStorageMm) ? round(hydro.soilWaterStorageMm, 0) : null,
    soilWaterCapacity: Number.isFinite(hydro.soilWaterCapacityMm) ? round(hydro.soilWaterCapacityMm, 0) : null,
    topSoilWaterCapacity: Number.isFinite(hydro.topSoilWaterCapacityMm) ? round(hydro.topSoilWaterCapacityMm, 1) : null,
    bottomSoilWaterCapacity: Number.isFinite(hydro.bottomSoilWaterCapacityMm) ? round(hydro.bottomSoilWaterCapacityMm, 1) : null,
    topPercolationCoefficient: Number.isFinite(hydro.topPercolationCoefficient) ? hydro.topPercolationCoefficient : null,
    bottomPercolationCoefficient: Number.isFinite(hydro.bottomPercolationCoefficient) ? hydro.bottomPercolationCoefficient : null,
    soilProfileApplied,
    soilStatus: hydro.soilStatus ?? null,
    soilSource: hydro.soilSource ?? null,
    soilPolicy: hydro.soilPolicy ?? null,
    waterBalanceResidual: Number.isFinite(hydro.waterBalanceResidualMm) ? hydro.waterBalanceResidualMm : null,
    atmospherePolicy: hydro.atmospherePolicy ?? null,
    itczLatitude: Number.isFinite(hydro.itczLatitude) ? hydro.itczLatitude : null,
    windEast: Number.isFinite(hydro.windEastMs) ? hydro.windEastMs : null,
    windNorth: Number.isFinite(hydro.windNorthMs) ? hydro.windNorthMs : null,
    windSpeed: Number.isFinite(hydro.windSpeedMs) ? hydro.windSpeedMs : null,
    oceanMoistureFetch: Number.isFinite(hydro.oceanMoistureFetch) ? hydro.oceanMoistureFetch : null,
    landMoistureRecycling: Number.isFinite(hydro.landMoistureRecycling) ? hydro.landMoistureRecycling : null,
    landSurfacePolicy: hydro.landSurfacePolicy ?? null,
    landSurfaceFeedbackActive: Boolean(hydro.landSurfaceFeedbackActive),
    estimatedVegetationLai: Number.isFinite(hydro.estimatedVegetationLai) ? hydro.estimatedVegetationLai : null,
    vegetationCoverFraction: Number.isFinite(hydro.vegetationCoverFraction) ? hydro.vegetationCoverFraction : null,
    surfaceAlbedoDelta: Number.isFinite(hydro.surfaceAlbedoDelta) ? hydro.surfaceAlbedoDelta : null,
    evaporativeFractionDelta: Number.isFinite(hydro.evaporativeFractionDelta) ? hydro.evaporativeFractionDelta : null,
    moistureRecyclingRatio: Number.isFinite(hydro.moistureRecyclingRatio) ? hydro.moistureRecyclingRatio : null,
    roughnessLogRatio: Number.isFinite(hydro.roughnessLogRatio) ? hydro.roughnessLogRatio : null,
    convectiveAscent: Number.isFinite(hydro.convectiveAscent) ? hydro.convectiveAscent : null,
    subtropicalSubsidence: Number.isFinite(hydro.subtropicalSubsidence) ? hydro.subtropicalSubsidence : null,
    orographicLift: Number.isFinite(hydro.orographicLift) ? hydro.orographicLift : null,
    rainShadow: Number.isFinite(hydro.rainShadow) ? hydro.rainShadow : null,
    wettestMonthIndex: Number.isInteger(hydro.wettestMonthIndex) ? hydro.wettestMonthIndex : null,
    biome: vegetationState?.biomeLabel ?? fallbackBiome,
    hydroclimatePotentialBiome: fallbackBiome,
    biomeCode: vegetationState?.biomeCode ?? null,
    fauna,
    npp: Number.isFinite(vegetationState?.npp) ? round(vegetationState.npp, 1) : null,
    lai: Number.isFinite(vegetationState?.lai) ? round(vegetationState.lai, 2) : null,
    vegetationProductivityFactor: Number.isFinite(vegetationState?.productivityFactor) ? vegetationState.productivityFactor : null,
    vegetationTransitionPressure: Number.isFinite(vegetationState?.transitionPressure) ? vegetationState.transitionPressure : null,
    climateEligiblePftIds: vegetationState?.climateEligiblePftIds ?? Object.freeze([]),
    climateUnresolvedPftIds: vegetationState?.climateUnresolvedPftIds ?? Object.freeze([]),
    pftClimateIndices: vegetationState?.pftClimateIndices ?? null,
    pftEligibilityPolicy: vegetationState?.pftEligibilityPolicy ?? null,
    pftWaterPhenology: pftWaterPhenology ? Object.freeze({
      status: pftWaterPhenology.status,
      candidateCount: pftWaterPhenology.candidateCount,
      resolvedCount: pftWaterPhenology.resolvedCount,
      candidatePftIds: pftWaterPhenology.candidatePftIds,
      raingreenDiscrepancyPftIds: pftWaterPhenology.raingreenDiscrepancyPftIds,
      hydrologyFeedbackEnabled: pftWaterPhenology.hydrologyFeedbackEnabled,
      candidates: Object.freeze((pftWaterPhenology.candidates ?? []).map((candidate) => Object.freeze({
        pftId: candidate.pftId,
        pftCode: candidate.pftCode,
        pftName: candidate.pftName,
        climateEligibilityStatus: candidate.climateEligibilityStatus,
        greenDays: candidate.greenDays,
        meanLeafFraction: candidate.meanLeafFraction,
        meanRootZoneWetness: candidate.meanRootZoneWetness,
        meanWaterSupplyCapacityMmPerDay: candidate.meanWaterSupplyCapacityMmPerDay,
        raingreenThresholdDiscrepancy: candidate.raingreenThresholdDiscrepancy
      }))),
      epistemicStatus: pftWaterPhenology.epistemicStatus
    }) : null,
    vegetationSource: vegetationState?.source ?? null,
    checkpointVegetation: Boolean(vegetationState) && globalState.elapsedYears <= 0,
    climateSource: closedBudget
      ? "krapp-777 + general-atmosphere + closed-water-budget"
      : "krapp-777 + general-atmosphere",
    checkpointClimate: globalState.elapsedYears <= 0,
    gridSpacingDegrees: hydro.gridSpacingDegrees,
    hydroClimatePolicy: hydro.policy,
    waterBalancePolicy: hydro.waterBalancePolicy ?? null,
    confidence: closedBudget
      ? `Krapp 777 ka calibrated climate + general orbital/land-ocean circulation at ${hydro.gridSpacingDegrees}°; moisture transport includes ITCZ/Hadley migration, thermal pressure-gradient winds, ocean fetch, recycling, subsidence and orography${hydro.landSurfaceFeedbackActive ? "; vegetation-water feedback modifies albedo, evaporative cooling, aerodynamic roughness and terrestrial moisture recycling through a deterministic two-pass solve" : ""}; Priestley–Taylor/FAO solar PET and a closed ${soilProfileApplied ? "BIOME4 two-layer" : "fallback single-layer"} water budget conserve precipitation into AET, routed runoff, and storage change${soilProfileApplied ? "; deep drainage currently joins routed runoff pending groundwater/baseflow" : ""}${vegetationState ? "; lightweight vegetation retains the published checkpoint category for fast sampling while selected-region BIOME4 competition supplies lagged categorical succession" : ""}`
      : globalState.elapsedYears > 0
        ? `Krapp 777 ka checkpoint + general intermediate-complexity atmospheric circulation at ${hydro.gridSpacingDegrees}°${hydro.landSurfaceFeedbackActive ? " + deterministic vegetation-water land-surface feedback" : ""}; moisture/runoff remain lower-fidelity diagnostics where the closed water budget is unavailable`
        : `Krapp 777 ka checkpoint on ${hydro.gridSpacingDegrees}° materialization; general atmosphere branch anomaly is zero at initialization`
  });
}
