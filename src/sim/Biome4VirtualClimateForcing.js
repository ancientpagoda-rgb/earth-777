import { biome4DailyMidmonthInterpolation } from "./Biome4PftWaterPhenology.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 6) => Number(value.toFixed(digits));
const MONTH_MIDPOINT_DAY = Object.freeze([16, 44, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350]);
const MONTH_DAYS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

export const BIOME4_VIRTUAL_CLIMATE_POLICY = "biome4-4.1-virtual-pft-climate-forcing-v1";
export const BIOME4_RADIATION_ANOMALY_ASSUMPTION = "radiation-anomaly multipliers are fixed to 1 because Earth 777 does not yet carry BIOME4's separate monthly radiation-anomaly driver";

const PET_TABLE = Object.freeze([
  Object.freeze({ thresholdCelsius: -5, gamma: 64.6, lambda: 2.513 }),
  Object.freeze({ thresholdCelsius: 0, gamma: 64.9, lambda: 2.501 }),
  Object.freeze({ thresholdCelsius: 5, gamma: 65.2, lambda: 2.489 }),
  Object.freeze({ thresholdCelsius: 10, gamma: 65.6, lambda: 2.477 }),
  Object.freeze({ thresholdCelsius: 15, gamma: 65.9, lambda: 2.465 }),
  Object.freeze({ thresholdCelsius: 20, gamma: 66.1, lambda: 2.454 }),
  Object.freeze({ thresholdCelsius: 25, gamma: 66.5, lambda: 2.442 }),
  Object.freeze({ thresholdCelsius: 30, gamma: 66.8, lambda: 2.430 }),
  Object.freeze({ thresholdCelsius: 35, gamma: 67.2, lambda: 2.418 }),
  Object.freeze({ thresholdCelsius: 40, gamma: 67.5, lambda: 2.406 }),
  Object.freeze({ thresholdCelsius: 45, gamma: 67.8, lambda: 2.394 })
]);

const SOURCE_CONSTANTS = Object.freeze({
  latitudeLimitDegrees: 89.5,
  longwaveCloudBase: 0.2,
  upwardRadiationTemperatureReference: 107,
  solarConstantWm2: 1360,
  cloudShortwaveCoefficient: 0.5,
  clearShortwaveCoefficient: 0.25,
  albedo: 0.17,
  earthOrbitalEccentricity: 0.01675,
  angularVelocityRadiansPerHour: 0.261799,
  waterDensityKgM3: 1000,
  snowThresholdCelsius: -1,
  degreeDayMeltMmPerDegreeDay: 0.7,
  sourceMeanDaysPerMonth: 365 / 12
});

function requireMonthly(values, label) {
  if (!Array.isArray(values) || values.length !== 12) {
    throw new TypeError(`${label} requires exactly 12 monthly values.`);
  }
  const numbers = values.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`${label} requires finite monthly values.`);
  }
  return numbers;
}

function monthForDay(dayOfYear) {
  let remaining = clamp(Math.floor(Number(dayOfYear) || 1), 1, 365);
  for (let month = 0; month < MONTH_DAYS.length; month += 1) {
    if (remaining <= MONTH_DAYS[month]) return month;
    remaining -= MONTH_DAYS[month];
  }
  return 11;
}

function anomalyForMonth(radiationAnomaly, monthIndex) {
  if (radiationAnomaly == null) return 1;
  if (Array.isArray(radiationAnomaly)) {
    if (radiationAnomaly.length !== 12) throw new TypeError("BIOME4 radiation anomaly requires 12 monthly values.");
    const value = Number(radiationAnomaly[monthIndex]);
    if (!Number.isFinite(value)) throw new TypeError("BIOME4 radiation anomaly requires finite values.");
    return value;
  }
  const value = Number(radiationAnomaly);
  if (!Number.isFinite(value)) throw new TypeError("BIOME4 radiation anomaly must be finite.");
  return value;
}

export function biome4PetLookup(temperatureCelsius) {
  const temperature = Number(temperatureCelsius);
  if (!Number.isFinite(temperature)) throw new TypeError("BIOME4 PET lookup requires a finite temperature.");
  return PET_TABLE.find((entry) => temperature <= entry.thresholdCelsius) ?? PET_TABLE[PET_TABLE.length - 1];
}

export function biome4RadiationPetDay({
  latitude,
  dayOfYear,
  temperatureCelsius,
  cloudCoverPercent,
  radiationAnomaly = 1
}) {
  const latitudeDegrees = clamp(latitude, -SOURCE_CONSTANTS.latitudeLimitDegrees, SOURCE_CONSTANTS.latitudeLimitDegrees);
  const day = clamp(Math.floor(Number(dayOfYear) || 1), 1, 365);
  const temperature = Number(temperatureCelsius);
  const cloud = clamp(Number(cloudCoverPercent) / 100, 0, 1);
  const anomaly = Number(radiationAnomaly);
  if (!Number.isFinite(temperature) || !Number.isFinite(anomaly)) {
    throw new TypeError("BIOME4 radiation/PET requires finite temperature and radiation anomaly.");
  }

  const radians = Math.PI / 180;
  const latitudeRadians = latitudeDegrees * radians;
  const declination = -23.4 * radians * Math.cos((360 * (day + 10) / 365) * radians);
  const q0 = SOURCE_CONSTANTS.solarConstantWm2 * (
    1 + 2 * SOURCE_CONSTANTS.earthOrbitalEccentricity * Math.cos((360 * (day + 10) / 365) * radians)
  );
  const longwave = (
    SOURCE_CONSTANTS.longwaveCloudBase + (1 - SOURCE_CONSTANTS.longwaveCloudBase) * cloud
  ) * (SOURCE_CONSTANTS.upwardRadiationTemperatureReference - temperature) * anomaly;
  const shortwave = q0 * (
    SOURCE_CONSTANTS.clearShortwaveCoefficient + SOURCE_CONSTANTS.cloudShortwaveCoefficient * cloud
  ) * (1 - SOURCE_CONSTANTS.albedo) * anomaly;
  const cla = Math.cos(latitudeRadians) * Math.cos(declination);
  const sla = Math.sin(latitudeRadians) * Math.sin(declination);
  const u = shortwave * sla - longwave;
  const v = shortwave * cla;

  let positiveNetRadiationHourAngle;
  if (u >= v) positiveNetRadiationHourAngle = Math.PI;
  else if (u <= -v) positiveNetRadiationHourAngle = 0;
  else positiveNetRadiationHourAngle = Math.acos(clamp(-u / v, -1, 1));
  const effectiveDaylengthHours = 24 * positiveNetRadiationHourAngle / Math.PI;

  const { gamma, lambda, thresholdCelsius } = biome4PetLookup(temperature);
  const saturationVapourPressure = 6.108 * Math.exp((17.269 * temperature) / (237.3 + temperature));
  const slope = 4394.5 * saturationVapourPressure / (237.3 + temperature) ** 2;
  const fd = positiveNetRadiationHourAngle * u + v * Math.sin(positiveNetRadiationHourAngle);
  const potentialEvapotranspirationMm = slope > 0 && fd > 0
    ? (slope / (slope + gamma)) * (SOURCE_CONSTANTS.angularVelocityRadiansPerHour * fd) /
      (lambda * SOURCE_CONSTANTS.waterDensityKgM3)
    : 0;

  const us = shortwave * sla;
  const vs = shortwave * cla;
  let solarHourAngle;
  if (us >= vs) solarHourAngle = Math.PI;
  else if (us <= -vs) solarHourAngle = 0;
  else solarHourAngle = Math.acos(clamp(-us / vs, -1, 1));
  const incomingSolarJm2Day = Math.max(
    0,
    2 * (shortwave * sla * solarHourAngle + shortwave * cla * Math.sin(solarHourAngle)) *
      (3600 * 12 / Math.PI)
  );

  return Object.freeze({
    dayOfYear: day,
    latitudeDegrees,
    temperatureCelsius: temperature,
    cloudFraction: cloud,
    radiationAnomaly: anomaly,
    declinationRadians: declination,
    effectiveDaylengthHours: round(effectiveDaylengthHours),
    positiveNetRadiationIntegral: round(fd),
    potentialEvapotranspirationMm: round(Math.max(0, potentialEvapotranspirationMm)),
    incomingSolarJm2Day: round(incomingSolarJm2Day, 3),
    petLookupThresholdCelsius: thresholdCelsius,
    psychrometricGamma: gamma,
    latentHeatLambda: lambda,
    policy: BIOME4_VIRTUAL_CLIMATE_POLICY
  });
}

export function biome4MonthlyPhotosyntheticForcing({
  latitude,
  monthlyTemperatureCelsius,
  monthlyCloudCoverPercent,
  radiationAnomaly = null
}) {
  const temperature = requireMonthly(monthlyTemperatureCelsius, "BIOME4 monthly photosynthetic temperature");
  const cloud = requireMonthly(monthlyCloudCoverPercent, "BIOME4 monthly photosynthetic cloud");
  return Object.freeze(MONTH_MIDPOINT_DAY.map((dayOfYear, monthIndex) => {
    const sample = biome4RadiationPetDay({
      latitude,
      dayOfYear,
      temperatureCelsius: temperature[monthIndex],
      cloudCoverPercent: cloud[monthIndex],
      radiationAnomaly: anomalyForMonth(radiationAnomaly, monthIndex)
    });
    return Object.freeze({
      monthIndex,
      dayOfYear,
      incomingSolarJm2Day: sample.incomingSolarJm2Day,
      effectiveDaylengthHours: sample.effectiveDaylengthHours,
      temperatureCelsius: temperature[monthIndex],
      cloudCoverPercent: cloud[monthIndex],
      radiationAnomaly: sample.radiationAnomaly
    });
  }));
}

export function biome4VirtualDailyClimate({
  latitude,
  monthlyTemperatureCelsius,
  monthlyCloudCoverPercent,
  monthlyPrecipitationMm,
  radiationAnomaly = null,
  snowSpinupYears = 2
}) {
  const monthlyTemperature = requireMonthly(monthlyTemperatureCelsius, "BIOME4 virtual climate temperature");
  const monthlyCloud = requireMonthly(monthlyCloudCoverPercent, "BIOME4 virtual climate cloud");
  const monthlyPrecipitation = requireMonthly(monthlyPrecipitationMm, "BIOME4 virtual climate precipitation").map((value) => Math.max(0, value));
  const dailyTemperature = biome4DailyMidmonthInterpolation(monthlyTemperature);
  const dailyCloud = biome4DailyMidmonthInterpolation(monthlyCloud);
  const dailyPrecipitationField = biome4DailyMidmonthInterpolation(monthlyPrecipitation);

  let snowpackMm = 0;
  let maximumSnowpackMm = 0;
  const years = Math.max(1, Math.min(20, Math.floor(Number(snowSpinupYears)) || 1));
  let finalDaily = null;
  let finalYearStartSnowpackMm = 0;
  for (let year = 0; year < years; year += 1) {
    if (year === years - 1) finalYearStartSnowpackMm = snowpackMm;
    const days = [];
    for (let index = 0; index < 365; index += 1) {
      const dayOfYear = index + 1;
      const monthIndex = monthForDay(dayOfYear);
      const temperature = dailyTemperature[index];
      const cloud = dailyCloud[index];
      const totalPrecipitationMm = Math.max(0, dailyPrecipitationField[index] / SOURCE_CONSTANTS.sourceMeanDaysPerMonth);
      let snowfallMm = 0;
      let snowmeltMm = 0;
      if (temperature < SOURCE_CONSTANTS.snowThresholdCelsius) {
        snowfallMm = totalPrecipitationMm;
      } else {
        snowmeltMm = Math.min(
          snowpackMm,
          SOURCE_CONSTANTS.degreeDayMeltMmPerDegreeDay * (temperature - SOURCE_CONSTANTS.snowThresholdCelsius)
        );
      }
      const liquidPrecipitationMm = totalPrecipitationMm - snowfallMm;
      snowpackMm = Math.max(0, snowpackMm + snowfallMm - snowmeltMm);
      maximumSnowpackMm = Math.max(maximumSnowpackMm, snowpackMm);
      const forcing = biome4RadiationPetDay({
        latitude,
        dayOfYear,
        temperatureCelsius: temperature,
        cloudCoverPercent: cloud,
        radiationAnomaly: anomalyForMonth(radiationAnomaly, monthIndex)
      });
      days.push(Object.freeze({
        dayOfYear,
        monthIndex,
        temperatureCelsius: round(temperature, 5),
        cloudCoverPercent: round(cloud, 5),
        totalPrecipitationMm: round(totalPrecipitationMm),
        liquidPrecipitationMm: round(liquidPrecipitationMm),
        snowfallMm: round(snowfallMm),
        snowmeltMm: round(snowmeltMm),
        snowpackMm: round(snowpackMm),
        potentialEvapotranspirationMm: forcing.potentialEvapotranspirationMm,
        effectiveDaylengthHours: forcing.effectiveDaylengthHours,
        incomingSolarJm2Day: forcing.incomingSolarJm2Day,
        radiationAnomaly: forcing.radiationAnomaly
      }));
    }
    finalDaily = days;
  }

  const precipitationInputMm = finalDaily.reduce((sum, day) => sum + day.totalPrecipitationMm, 0);
  const liquidToSoilMm = finalDaily.reduce((sum, day) => sum + day.liquidPrecipitationMm + day.snowmeltMm, 0);
  const snowfallMm = finalDaily.reduce((sum, day) => sum + day.snowfallMm, 0);
  const snowmeltMm = finalDaily.reduce((sum, day) => sum + day.snowmeltMm, 0);
  const snowStorageChangeMm = snowpackMm - finalYearStartSnowpackMm;
  return Object.freeze({
    policy: BIOME4_VIRTUAL_CLIMATE_POLICY,
    latitude: clamp(latitude, -SOURCE_CONSTANTS.latitudeLimitDegrees, SOURCE_CONSTANTS.latitudeLimitDegrees),
    days: Object.freeze(finalDaily),
    monthlyPhotosyntheticForcing: biome4MonthlyPhotosyntheticForcing({
      latitude,
      monthlyTemperatureCelsius: monthlyTemperature,
      monthlyCloudCoverPercent: monthlyCloud,
      radiationAnomaly
    }),
    precipitationInputMm: round(precipitationInputMm),
    liquidToSoilMm: round(liquidToSoilMm),
    snowfallMm: round(snowfallMm),
    snowmeltMm: round(snowmeltMm),
    finalYearStartSnowpackMm: round(finalYearStartSnowpackMm),
    finalSnowpackMm: round(snowpackMm),
    snowStorageChangeMm: round(snowStorageChangeMm),
    snowMassBalanceResidualMm: round(precipitationInputMm - liquidToSoilMm - snowStorageChangeMm, 9),
    maximumSnowpackModelUnits: round(maximumSnowpackMm),
    radiationAnomalyAssumption: radiationAnomaly == null ? BIOME4_RADIATION_ANOMALY_ASSUMPTION : null,
    epistemicStatus: "independent BIOME4 4.1 daily radiation/PET/snow forcing; monthly precipitation is supplied as monthly total and the source 365/12 daily conversion is preserved; radiation anomaly defaults to 1 when absent"
  });
}
