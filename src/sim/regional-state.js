import { regionalState as legacyRegionalState } from "./free-earth.js";

const round = (value, digits = 2) => Number(value.toFixed(digits));

function biomeFromHydroClimate(globalState, latitude, temperatureCelsius, soilMoistureIndex) {
  if (Math.abs(latitude) > 72 - globalState.iceIndex * 8) return "polar ice / tundra";
  if (temperatureCelsius < -4) return "cold steppe";
  if (temperatureCelsius < 5) return soilMoistureIndex > 0.58 ? "boreal woodland" : "mammoth steppe";
  if (temperatureCelsius > 23) return soilMoistureIndex > 0.7 ? "tropical woodland" : "warm savanna";
  if (soilMoistureIndex > 0.68) return "temperate forest";
  if (soilMoistureIndex > 0.38) return "open woodland";
  return "dry grassland";
}

export function regionalState(
  globalState,
  latitude,
  longitude,
  { climateLayer = null, hydroClimate = null, vegetation = null, spatialDetail = 0.35 } = {}
) {
  const hydro = hydroClimate?.sample?.(globalState, latitude, longitude, spatialDetail) ?? null;
  if (!hydro || !Number.isFinite(hydro.temperatureCelsius)) {
    return legacyRegionalState(globalState, latitude, longitude, climateLayer);
  }

  const moisture = Number.isFinite(hydro.soilMoistureIndex) ? hydro.soilMoistureIndex : 0.5;
  const closedBudget = Number.isFinite(hydro.waterBalanceResidualMm);
  const vegetationState = vegetation?.sample?.(globalState, latitude, longitude, spatialDetail) ?? null;
  const pftWaterPhenology = vegetation?.pftDiagnostics?.(globalState, latitude, longitude, spatialDetail) ?? null;
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
    biome: vegetationState?.biomeLabel ?? fallbackBiome,
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
      ? "krapp-777 + branch-hydroclimate + closed-water-budget"
      : "krapp-777 + branch-hydroclimate",
    checkpointClimate: globalState.elapsedYears <= 0,
    gridSpacingDegrees: hydro.gridSpacingDegrees,
    hydroClimatePolicy: hydro.policy,
    waterBalancePolicy: hydro.waterBalancePolicy ?? null,
    confidence: closedBudget
      ? `Krapp 777 ka climate + model-derived branch response at ${hydro.gridSpacingDegrees}°; Priestley–Taylor/FAO solar PET and a closed ${soilProfileApplied ? "BIOME4 two-layer" : "fallback single-layer"} water budget conserve precipitation into AET, routed runoff, and storage change${soilProfileApplied ? "; deep drainage currently joins routed runoff pending groundwater/baseflow" : ""}${vegetationState ? "; vegetation uses the published 777 ka BIOME4 category/NPP/LAI baseline with continuous hydro-CO₂ response, an independently implemented BIOME4 climate-eligibility sieve, and opt-in source-operational daily rooting/water/phenology diagnostics; those diagnostics do not feed back into hydrology and categorical transitions remain disabled" : ""}`
      : globalState.elapsedYears > 0
        ? `Krapp 777 ka checkpoint + model-derived gridded branch response at ${hydro.gridSpacingDegrees}°; moisture/runoff remain diagnostic proxies`
        : `Krapp 777 ka checkpoint on ${hydro.gridSpacingDegrees}° materialization; moisture/runoff are model-derived diagnostic proxies`
  });
}
