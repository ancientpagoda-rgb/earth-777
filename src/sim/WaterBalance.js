const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 4) => Number(value.toFixed(digits));

export const PRIESTLEY_TAYLOR_ALPHA = 1.26;
export const DEFAULT_SOIL_WATER_CAPACITY_MM = 150;
export const WATER_BALANCE_POLICY = "priestley-taylor-spatial-soil-v2";
export const BIOME4_TWO_LAYER_WATER_POLICY = "biome4-two-layer-daily-water-v1";

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

function simulateSingleLayerYear(monthlyClimate, latitude, elevationMeters, startStorageMm, capacityMm) {
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
      surfaceRunoffMm: round(runoff, 4),
      deepDrainageMm: 0,
      startStorageMm: round(monthStartStorage, 4),
      endStorageMm: round(storage, 4)
    }));
  }

  const storageChange = storage - startStorage;
  const residual = totalPrecipitation - totalActualEvapotranspiration - totalRunoff - storageChange;
  return {
    policy: WATER_BALANCE_POLICY,
    startStorageMm: startStorage,
    endStorageMm: storage,
    storageChangeMm: storageChange,
    precipitationMm: totalPrecipitation,
    potentialEvapotranspirationMm: totalPotentialEvapotranspiration,
    actualEvapotranspirationMm: totalActualEvapotranspiration,
    runoffMm: totalRunoff,
    surfaceRunoffMm: totalRunoff,
    deepDrainageMm: 0,
    meanStorageMm: meanStorageAccumulator / 12,
    residualMm: residual,
    months: Object.freeze(months)
  };
}

function normalizedBiome4SoilProfile(profile) {
  if (!profile?.validSoil) return null;
  const topCapacityMm = Math.max(0, Number(profile.topWaterCapacityMm) || 0);
  const bottomCapacityMm = Math.max(0, Number(profile.bottomWaterCapacityMm) || 0);
  const topPercolationCoefficient = Math.max(0, Number(profile.topPercolationCoefficient) || 0);
  const bottomPercolationCoefficient = Math.max(0, Number(profile.bottomPercolationCoefficient) || 0);
  return Object.freeze({
    topCapacityMm,
    bottomCapacityMm,
    totalCapacityMm: topCapacityMm + bottomCapacityMm,
    topPercolationCoefficient,
    bottomPercolationCoefficient,
    source: profile.source ?? null,
    status: profile.status ?? "soil"
  });
}

function removeEvapotranspiration(topStorage, bottomStorage, demand) {
  const total = topStorage + bottomStorage;
  if (total <= 0 || demand <= 0) return { topStorage, bottomStorage, removed: 0 };
  const removed = Math.min(total, demand);
  const topShare = topStorage / total;
  const topRemoval = Math.min(topStorage, removed * topShare);
  const bottomRemoval = Math.min(bottomStorage, removed - topRemoval);
  const remainder = removed - topRemoval - bottomRemoval;
  if (remainder > 0) {
    const extraTop = Math.min(topStorage - topRemoval, remainder);
    topStorage -= extraTop;
    const extraBottom = Math.min(bottomStorage - bottomRemoval, remainder - extraTop);
    bottomStorage -= extraBottom;
  }
  return {
    topStorage: Math.max(0, topStorage - topRemoval),
    bottomStorage: Math.max(0, bottomStorage - bottomRemoval),
    removed
  };
}

function dailyPercolation(storage, capacity, coefficient) {
  if (storage <= 0 || capacity <= 0 || coefficient <= 0) return 0;
  const wetness = clamp(storage / capacity, 0, 1);
  // This follows BIOME4's operational daily form: k * wetness^4. The
  // inputdata.nc metadata says mm/hr, but the BIOME4 daily routine applies
  // the coefficient once per day without multiplying by 24.
  return Math.min(storage, coefficient * wetness ** 4);
}

function simulateTwoLayerYear(monthlyClimate, latitude, elevationMeters, start, soil, captureDailyTrace = false) {
  let topStorage = clamp(start.topStorageMm, 0, soil.topCapacityMm);
  let bottomStorage = clamp(start.bottomStorageMm, 0, soil.bottomCapacityMm);
  const yearStartTop = topStorage;
  const yearStartBottom = bottomStorage;
  let precipitationTotal = 0;
  let petTotal = 0;
  let aetTotal = 0;
  let surfaceRunoffTotal = 0;
  let deepDrainageTotal = 0;
  let meanStorageDaySum = 0;
  let simulatedDays = 0;
  const months = [];
  const dailyTrace = captureDailyTrace ? [] : null;

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const climate = climateMonthInput(monthlyClimate[monthIndex], monthIndex);
    const days = Math.max(1, Math.round(MONTH_DAYS[monthIndex]));
    const monthlyPet = monthlyPotentialEvapotranspirationMm({
      ...climate,
      latitude,
      elevationMeters
    });
    const dailyPrecipitation = climate.precipitationMm / days;
    const dailyPet = monthlyPet / days;
    const monthStartTop = topStorage;
    const monthStartBottom = bottomStorage;
    let monthAet = 0;
    let monthSurfaceRunoff = 0;
    let monthDeepDrainage = 0;

    for (let day = 0; day < days; day += 1) {
      const startTopWetness = soil.topCapacityMm > 0 ? clamp(topStorage / soil.topCapacityMm, 0, 1) : 0;
      const startBottomWetness = soil.bottomCapacityMm > 0 ? clamp(bottomStorage / soil.bottomCapacityMm, 0, 1) : 0;
      topStorage += dailyPrecipitation;

      const totalCapacity = soil.totalCapacityMm;
      const totalStorage = topStorage + bottomStorage;
      const wetness = totalCapacity > 0 ? clamp(totalStorage / totalCapacity, 0, 1) : 0;
      const aetDemand = dailyPet * (0.15 + 0.85 * Math.sqrt(wetness));
      const evap = removeEvapotranspiration(topStorage, bottomStorage, aetDemand);
      topStorage = evap.topStorage;
      bottomStorage = evap.bottomStorage;
      monthAet += evap.removed;

      // Any top-layer capacity overflow infiltrates to the lower layer before
      // the BIOME4-style wetness-dependent percolation transfer is evaluated.
      if (topStorage > soil.topCapacityMm) {
        bottomStorage += topStorage - soil.topCapacityMm;
        topStorage = soil.topCapacityMm;
      }
      const topPercolation = dailyPercolation(
        topStorage,
        soil.topCapacityMm,
        soil.topPercolationCoefficient
      );
      topStorage -= topPercolation;
      bottomStorage += topPercolation;

      if (bottomStorage > soil.bottomCapacityMm) {
        const overflow = bottomStorage - soil.bottomCapacityMm;
        monthSurfaceRunoff += overflow;
        bottomStorage = soil.bottomCapacityMm;
      }
      const deepDrainage = dailyPercolation(
        bottomStorage,
        soil.bottomCapacityMm,
        soil.bottomPercolationCoefficient
      );
      bottomStorage -= deepDrainage;
      monthDeepDrainage += deepDrainage;

      if (dailyTrace) {
        dailyTrace.push(Object.freeze({
          dayOfYear: simulatedDays + 1,
          monthIndex,
          dayOfMonth: day + 1,
          startTopWetness: round(startTopWetness, 6),
          startBottomWetness: round(startBottomWetness, 6),
          endTopWetness: round(soil.topCapacityMm > 0 ? clamp(topStorage / soil.topCapacityMm, 0, 1) : 0, 6),
          endBottomWetness: round(soil.bottomCapacityMm > 0 ? clamp(bottomStorage / soil.bottomCapacityMm, 0, 1) : 0, 6),
          startTopStorageMm: round(startTopWetness * soil.topCapacityMm, 4),
          startBottomStorageMm: round(startBottomWetness * soil.bottomCapacityMm, 4),
          endTopStorageMm: round(topStorage, 4),
          endBottomStorageMm: round(bottomStorage, 4),
          precipitationMm: round(dailyPrecipitation, 6),
          potentialEvapotranspirationMm: round(dailyPet, 6),
          actualEvapotranspirationMm: round(evap.removed, 6)
        }));
      }
      meanStorageDaySum += topStorage + bottomStorage;
      simulatedDays += 1;
    }

    precipitationTotal += climate.precipitationMm;
    petTotal += monthlyPet;
    aetTotal += monthAet;
    surfaceRunoffTotal += monthSurfaceRunoff;
    deepDrainageTotal += monthDeepDrainage;
    months.push(Object.freeze({
      monthIndex,
      precipitationMm: round(climate.precipitationMm, 4),
      potentialEvapotranspirationMm: round(monthlyPet, 4),
      actualEvapotranspirationMm: round(monthAet, 4),
      runoffMm: round(monthSurfaceRunoff + monthDeepDrainage, 4),
      surfaceRunoffMm: round(monthSurfaceRunoff, 4),
      deepDrainageMm: round(monthDeepDrainage, 4),
      startTopStorageMm: round(monthStartTop, 4),
      endTopStorageMm: round(topStorage, 4),
      startBottomStorageMm: round(monthStartBottom, 4),
      endBottomStorageMm: round(bottomStorage, 4),
      startStorageMm: round(monthStartTop + monthStartBottom, 4),
      endStorageMm: round(topStorage + bottomStorage, 4)
    }));
  }

  const startStorage = yearStartTop + yearStartBottom;
  const endStorage = topStorage + bottomStorage;
  const storageChange = endStorage - startStorage;
  const runoffTotal = surfaceRunoffTotal + deepDrainageTotal;
  const residual = precipitationTotal - aetTotal - runoffTotal - storageChange;
  return {
    policy: BIOME4_TWO_LAYER_WATER_POLICY,
    startTopStorageMm: yearStartTop,
    endTopStorageMm: topStorage,
    startBottomStorageMm: yearStartBottom,
    endBottomStorageMm: bottomStorage,
    startStorageMm: startStorage,
    endStorageMm: endStorage,
    storageChangeMm: storageChange,
    precipitationMm: precipitationTotal,
    potentialEvapotranspirationMm: petTotal,
    actualEvapotranspirationMm: aetTotal,
    runoffMm: runoffTotal,
    surfaceRunoffMm: surfaceRunoffTotal,
    deepDrainageMm: deepDrainageTotal,
    meanStorageMm: simulatedDays > 0 ? meanStorageDaySum / simulatedDays : 0,
    residualMm: residual,
    months: Object.freeze(months),
    daily: dailyTrace ? Object.freeze(dailyTrace) : null
  };
}

function closeTwoLayerWaterBalance(monthlyClimate, latitude, elevationMeters, soil, spinupYears, includeDailyTrace = false) {
  let start = {
    topStorageMm: soil.topCapacityMm * 0.5,
    bottomStorageMm: soil.bottomCapacityMm * 0.5
  };
  const cycles = Math.max(1, Math.min(50, Math.floor(spinupYears) || 1));
  let finalYear = null;
  for (let year = 0; year < cycles; year += 1) {
    finalYear = simulateTwoLayerYear(monthlyClimate, latitude, elevationMeters, start, soil, includeDailyTrace && year === cycles - 1);
    start = {
      topStorageMm: finalYear.endTopStorageMm,
      bottomStorageMm: finalYear.endBottomStorageMm
    };
  }
  return finalYear;
}

export function closeAnnualWaterBalance(
  monthlyClimate,
  {
    latitude,
    elevationMeters = 0,
    soilWaterCapacityMm = DEFAULT_SOIL_WATER_CAPACITY_MM,
    soilProfile = null,
    spinupYears = 8,
    includeDailyTrace = false
  } = {}
) {
  if (!Array.isArray(monthlyClimate) || monthlyClimate.length !== 12) {
    throw new TypeError("closeAnnualWaterBalance requires exactly 12 monthly climate records.");
  }

  const biome4Soil = normalizedBiome4SoilProfile(soilProfile);
  let finalYear;
  let capacity;
  let soilPolicy;
  if (biome4Soil) {
    capacity = biome4Soil.totalCapacityMm;
    soilPolicy = BIOME4_TWO_LAYER_WATER_POLICY;
    finalYear = closeTwoLayerWaterBalance(monthlyClimate, latitude, elevationMeters, biome4Soil, spinupYears, includeDailyTrace);
  } else {
    capacity = clamp(soilWaterCapacityMm, 25, 600);
    soilPolicy = "uniform-single-layer-fallback";
    let storage = capacity * 0.5;
    const cycles = Math.max(1, Math.min(50, Math.floor(spinupYears) || 1));
    for (let year = 0; year < cycles; year += 1) {
      finalYear = simulateSingleLayerYear(monthlyClimate, latitude, elevationMeters, storage, capacity);
      storage = finalYear.endStorageMm;
    }
  }

  const soilMoistureIndex = capacity > 0 ? clamp(finalYear.meanStorageMm / capacity, 0, 1) : 0;
  return Object.freeze({
    policy: WATER_BALANCE_POLICY,
    soilPolicy,
    soilWaterCapacityMm: round(capacity, 4),
    topSoilWaterCapacityMm: biome4Soil ? round(biome4Soil.topCapacityMm, 4) : null,
    bottomSoilWaterCapacityMm: biome4Soil ? round(biome4Soil.bottomCapacityMm, 4) : null,
    topPercolationCoefficient: biome4Soil ? round(biome4Soil.topPercolationCoefficient, 6) : null,
    bottomPercolationCoefficient: biome4Soil ? round(biome4Soil.bottomPercolationCoefficient, 6) : null,
    startStorageMm: round(finalYear.startStorageMm, 3),
    endStorageMm: round(finalYear.endStorageMm, 3),
    storageChangeMm: round(finalYear.storageChangeMm, 6),
    precipitationMmPerYear: round(finalYear.precipitationMm, 3),
    potentialEvapotranspirationMmPerYear: round(finalYear.potentialEvapotranspirationMm, 3),
    actualEvapotranspirationMmPerYear: round(finalYear.actualEvapotranspirationMm, 3),
    runoffMmPerYear: round(finalYear.runoffMm, 3),
    surfaceRunoffMmPerYear: round(finalYear.surfaceRunoffMm, 3),
    deepDrainageMmPerYear: round(finalYear.deepDrainageMm, 3),
    meanSoilWaterStorageMm: round(finalYear.meanStorageMm, 3),
    soilMoistureIndex: round(soilMoistureIndex, 4),
    massBalanceResidualMm: round(finalYear.residualMm, 9),
    months: finalYear.months,
    daily: finalYear.daily ?? null,
    epistemicStatus: biome4Soil
      ? "model-derived closed daily two-layer water budget using study-constrained BIOME4 static WHC/percolation inputs; PET uses Priestley-Taylor/FAO solar geometry; BIOME4 percolation coefficients follow the source model's once-per-day k × wetness^4 operational semantics; deep drainage is routed immediately as runoff until groundwater/baseflow is implemented"
      : "model-derived closed single-layer fallback water budget; PET uses Priestley-Taylor energy balance with FAO-56 solar geometry and a Krapp-cloud sunshine proxy"
  });
}
