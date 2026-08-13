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
  { climateLayer = null, hydroClimate = null, spatialDetail = 0.35 } = {}
) {
  const hydro = hydroClimate?.sample?.(globalState, latitude, longitude, spatialDetail) ?? null;
  if (!hydro || !Number.isFinite(hydro.temperatureCelsius)) {
    return legacyRegionalState(globalState, latitude, longitude, climateLayer);
  }

  const moisture = Number.isFinite(hydro.soilMoistureIndex) ? hydro.soilMoistureIndex : 0.5;
  return Object.freeze({
    latitude,
    longitude,
    annualTemperature: round(hydro.temperatureCelsius, 1),
    annualPrecipitation: Number.isFinite(hydro.precipitationMmPerYear) ? round(hydro.precipitationMmPerYear, 0) : null,
    cloudCover: Number.isFinite(hydro.cloudCoverPercent) ? round(hydro.cloudCoverPercent, 1) : null,
    moisture: round(moisture, 2),
    runoffPotential: Number.isFinite(hydro.runoffPotentialMmPerYear) ? round(hydro.runoffPotentialMmPerYear, 0) : null,
    biome: biomeFromHydroClimate(globalState, latitude, hydro.temperatureCelsius, moisture),
    climateSource: "krapp-777 + branch-hydroclimate",
    checkpointClimate: globalState.elapsedYears <= 0,
    gridSpacingDegrees: hydro.gridSpacingDegrees,
    hydroClimatePolicy: hydro.policy,
    confidence: globalState.elapsedYears > 0
      ? `Krapp 777 ka checkpoint + model-derived gridded branch response at ${hydro.gridSpacingDegrees}°; moisture/runoff are diagnostic proxies`
      : `Krapp 777 ka checkpoint on ${hydro.gridSpacingDegrees}° materialization; moisture/runoff are model-derived diagnostic proxies`
  });
}
