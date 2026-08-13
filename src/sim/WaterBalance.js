const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 4) => Number(value.toFixed(digits));

export const PRIESTLEY_TAYLOR_ALPHA = 1.26;
export const DEFAULT_SOIL_WATER_CAPACITY_MM = 150;
export const WATER_BALANCE_POLICY = "priestley-taylor-soil-bucket-v1";

const SOLAR_CONSTANT_MJ_M2_MIN = 0.0820;
const LATENT_HEAT_MJ_KG = 2.45;
const MONTH_DAYS = Object.freeze([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
const MID_MONTH_DAY = Object.freeze([15, 45, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349]);

function pressureKPa(elevationMeters = 0) {
  const elevation = clamp(elevationMeters, -500, 9000);
  return 101.3 * ((293 - 0.0065 * elevation) / 293) ** 5.26;
}

function saturationVapourPressureSlope(temperatureCelsius) {
  const t = clamp(temperatureCelsius, -50, 60);
  const es = 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
  return 4098 * es / (t + 237.3) ** 2;
}

export function extraterrestrialRadiationMjM2Day(latitude, dayOfYear) {
  const phi = clamp(latitude, -89.999, 89.999) * Math.PI / 180;
  const j = clamp(dayOfYear, 1, 366);
  const inverseDistance = 1 + 0.033 * Math.cos((2 * Math.PI / 365) * j);
  const declination = 0.409 * Math.sin((2 * Math.PI / 365) * j - 1.39);
  const sunsetArgument = clamp(-Math.tan(phi) * Math.tan(declination), -1, 1);
  const sunsetHourAngle = Math.acos(sunsetArgument);
  const geometry =
    sunsetHourAngle * Math.sin(phi) * Math.sin(declination) +
    Math.cos(phi) * Math.cos(declination) * Math.sin(sunsetHourAngle);
  return Math.max(
    0,
    (24 * 60 / Math.PI) * SOLAR_CONSTANT_MJ_M2_MIN * inverseDistance * geometry
  );
}

export function monthlyPotentialEvapotranspirationMm({
  temperatureCelsius,
  cloudCoverPercent,
  latitude,
  elevationMeters = 0,
  monthIndex
}) {
  const month = clamp(Math.floor(monthIndex), 0, 11);
  const temperature = clamp(temperatureCelsius, -50, 60);
  const cloudFraction = clamp((cloudCoverPercent ?? 50) / 100, 0, 1);
  const ra = extraterrestrialRadiationMjM2Day(latitude, MID_MONTH_DAY[month]);

  // FAO-56 Angstrom defaults a_s=0.25, b_s=0.50. In the absence of a
  // sunshine-duration reconstruction, Krapp cloud fraction supplies a
  // transparent model-derived proxy for n/N. This is not an observation.
  const sunshineFractionProxy = 1 - cloudFraction;
  const incomingShortwave = (0.25 + 0.50 * sunshineFractionProxy) * ra;
  const netShortwave = 0.77 * incomingShortwave; // reference-surface albedo 0.23

  // Priestley-Taylor equilibrium evaporation. We deliberately use the
  // available net-shortwave estimate rather than fabricate humidity/wind
  // required by a full Penman-Monteith calculation.
  const delta = saturationVapourPressureSlope(temperature);
  const gamma = 0.000665 * pressureKPa(elevationMeters);
  const equilibriumFraction = delta / Math.max(1e-9, delta + gamma);
  const potentialMmPerDay =
    PRIESTLEY_TAYLOR_ALPHA * equilibriumFraction * netShortwave / LATENT_HEAT_MJ_KG;
  return round(Math.max(0, potentialMmPerDay) * MONTH_DAYS[month], 4);
}

function climateMonthInput(entry, monthIndex) {
  const precipitationAnnualized = Number(entry?.precipitationMmPerYear);
  return {
    temperatureCelsius: Number(entry?.temperatureCelsius),
    cloudCoverPercent: Number(entry?.cloudCoverPercent),
    precipitationMm: Number.isFinite(precipitationAnnualized)
      ? Math.max(0, precipitationAnnualized / 12)
      : 0,
    monthIndex
  };
}

function simulateYear(monthlyClimate, latitude, elevationMeters, startStorageMm, capacityMm) {
  let storage = clamp(startStorageMm, 0, capacityMm);
  const startStorage = storage;
  let totalPrecipitation = 0;
  let totalPotentialEvapotranspiration = 0;
  let totalActualEvapotranspiration = 0;
  let totalRunoff = 0;
  let meanStorageAccumulator = 0;
  const months = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const climate = climateMonthInput(monthlyClimate[monthIndex], monthIndex);
    const monthStartStorage = storage;
    const potentialEvapotranspiration = monthlyPotentialEvapotranspirationMm({
      ...climate,
      latitude,
      elevationMeters
    });
    const availableWater = storage + climate.precipitationMm;
    const wetness = clamp(availableWater / Math.max(1, capacityMm), 0, 1);
    const actualDemand = potentialEvapotranspiration * (0.15 + 0.85 * Math.sqrt(wetness));
    const actualEvapotranspiration = Math.min(availableWater, actualDemand);
    const afterEvapotranspiration = availableWater - actualEvapotranspiration;
    const runoff = Math.max(0, afterEvapotranspiration - capacityMm);
    storage = clamp(afterEvapotranspiration - runoff, 0, capacityMm);

    totalPrecipitation += climate.precipitationMm;
    totalPotentialEvapotranspiration += potentialEvapotranspiration;
    totalActualEvapotranspiration += actualEvapotranspiration;
    totalRunoff += runoff;
    meanStorageAccumulator += (monthStartStorage + storage) * 0.5;

    months.push(Object.freeze({
      monthIndex,
      precipitationMm: round(climate.precipitationMm, 4),
      potentialEvapotranspirationMm: round(potentialEvapotranspiration, 4),
      actualEvapotranspirationMm: round(actualEvapotranspiration, 4),
      runoffMm: round(runoff, 4),
      startStorageMm: round(monthStartStorage, 4),
      endStorageMm: round(storage, 4)
    }));
  }

  const storageChange = storage - startStorage;
  const residual = totalPrecipitation - totalActualEvapotranspiration - totalRunoff - storageChange;
  return {
    startStorageMm: startStorage,
    endStorageMm: storage,
    storageChangeMm: storageChange,
    precipitationMm: totalPrecipitation,
    potentialEvapotranspirationMm: totalPotentialEvapotranspiration,
    actualEvapotranspirationMm: totalActualEvapotranspiration,
    runoffMm: totalRunoff,
    meanStorageMm: meanStorageAccumulator / 12,
    residualMm: residual,
    months: Object.freeze(months)
  };
}

export function closeAnnualWaterBalance(
  monthlyClimate,
  {
    latitude,
    elevationMeters = 0,
    soilWaterCapacityMm = DEFAULT_SOIL_WATER_CAPACITY_MM,
    spinupYears = 8
  } = {}
) {
  if (!Array.isArray(monthlyClimate) || monthlyClimate.length !== 12) {
    throw new TypeError("closeAnnualWaterBalance requires exactly 12 monthly climate records.");
  }
  const capacity = clamp(soilWaterCapacityMm, 25, 600);
  let storage = capacity * 0.5;
  const cycles = Math.max(1, Math.min(50, Math.floor(spinupYears) || 1));
  let finalYear = null;
  for (let year = 0; year < cycles; year += 1) {
    finalYear = simulateYear(monthlyClimate, latitude, elevationMeters, storage, capacity);
    storage = finalYear.endStorageMm;
  }

  const soilMoistureIndex = clamp(finalYear.meanStorageMm / capacity, 0, 1);
  return Object.freeze({
    policy: WATER_BALANCE_POLICY,
    soilWaterCapacityMm: capacity,
    startStorageMm: round(finalYear.startStorageMm, 3),
    endStorageMm: round(finalYear.endStorageMm, 3),
    storageChangeMm: round(finalYear.storageChangeMm, 6),
    precipitationMmPerYear: round(finalYear.precipitationMm, 3),
    potentialEvapotranspirationMmPerYear: round(finalYear.potentialEvapotranspirationMm, 3),
    actualEvapotranspirationMmPerYear: round(finalYear.actualEvapotranspirationMm, 3),
    runoffMmPerYear: round(finalYear.runoffMm, 3),
    meanSoilWaterStorageMm: round(finalYear.meanStorageMm, 3),
    soilMoistureIndex: round(soilMoistureIndex, 4),
    massBalanceResidualMm: round(finalYear.residualMm, 9),
    months: finalYear.months,
    epistemicStatus: "model derived closed soil-water bucket; PET uses Priestley-Taylor energy balance with FAO-56 solar geometry and a Krapp-cloud sunshine proxy"
  });
}
