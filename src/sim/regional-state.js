import { regionalState as legacyRegionalState } from "./free-earth.js";

const round = (value, digits = 2) => Number(value.toFixed(digits));

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

export function regionalState(
  globalState,
  latitude,
  longitude,
  { climateLayer = null, hydroClimate = null, vegetation = null, spatialDetail = 0.35, includePftDiagnostics = false } = {}
) {
  const hydro = hydroClimate?.sample?.(globalState, latitude, longitude, spatialDetail) ?? null;
  if (!hydro || !Number.isFinite(hydro.temperatureCelsius)) {
    return legacyRegionalState(globalState, latitude, longitude, climateLayer);
  }

  const moisture = Number.isFinite(hydro.soilMoistureIndex) ? hydro.soilMoistureIndex : 0.5;
  const closedBudget = Number.isFinite(hydro.waterBalanceResidualMm);
  const vegetationState = vegetation?.sample?.(globalState, latitude, longitude, spatialDetail) ?? null;
  const pftWaterPhenology = includePftDiagnostics
    ? vegetation?.pftDiagnostics?.(globalState, latitude, longitude, spatialDetail) ?? null
    : null;
  const fallbackBiome = biomeFromHydroClimate(globalState, latitude, hydro.temperatureCelsius, moisture);
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
    convectiveAscent: Number.isFinite(hydro.convectiveAscent) ? hydro.convectiveAscent : null,
    subtropicalSubsidence: Number.isFinite(hydro.subtropicalSubsidence) ? hydro.subtropicalSubsidence : null,
    orographicLift: Number.isFinite(hydro.orographicLift) ? hydro.orographicLift : null,
    rainShadow: Number.isFinite(hydro.rainShadow) ? hydro.rainShadow : null,
    wettestMonthIndex: Number.isInteger(hydro.wettestMonthIndex) ? hydro.wettestMonthIndex : null,
    biome: vegetationState?.biomeLabel ?? fallbackBiome,
    hydroclimatePotentialBiome: fallbackBiome,
    biomeCode: vegetationState?.biomeCode ?? null,
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
      ? `Krapp 777 ka calibrated climate + general orbital/land-ocean circulation at ${hydro.gridSpacingDegrees}°; moisture transport includes ITCZ/Hadley migration, thermal pressure-gradient winds, ocean fetch, recycling, subsidence and orography; Priestley–Taylor/FAO solar PET and a closed ${soilProfileApplied ? "BIOME4 two-layer" : "fallback single-layer"} water budget conserve precipitation into AET, routed runoff, and storage change${soilProfileApplied ? "; deep drainage currently joins routed runoff pending groundwater/baseflow" : ""}${vegetationState ? "; lightweight vegetation retains the published checkpoint category for fast sampling while selected-region BIOME4 competition supplies lagged categorical succession" : ""}`
      : globalState.elapsedYears > 0
        ? `Krapp 777 ka checkpoint + general intermediate-complexity atmospheric circulation at ${hydro.gridSpacingDegrees}°; moisture/runoff remain lower-fidelity diagnostics where the closed water budget is unavailable`
        : `Krapp 777 ka checkpoint on ${hydro.gridSpacingDegrees}° materialization; general atmosphere branch anomaly is zero at initialization`
  });
}
