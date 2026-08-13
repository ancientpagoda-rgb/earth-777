import { biome4DailyTemperatureInterpolation } from "./Biome4PftEligibility.js";

export const BIOME4_SNOW_POLICY = "biome4-4.1-degree-day-snow-independent-v1";
const AVERAGE_DAYS_PER_MONTH = 365 / 12;

function requireMonthlyPrecipitation(monthlyAnnualizedPrecipitationMmPerYear) {
  if (!Array.isArray(monthlyAnnualizedPrecipitationMmPerYear) || monthlyAnnualizedPrecipitationMmPerYear.length !== 12) {
    throw new TypeError("BIOME4 snow requires exactly 12 annualized monthly precipitation rates.");
  }
  const monthlyTotals = monthlyAnnualizedPrecipitationMmPerYear.map((value) => {
    const annualized = Number(value);
    return Number.isFinite(annualized) ? Math.max(0, annualized / 12) : Number.NaN;
  });
  if (monthlyTotals.some((value) => !Number.isFinite(value))) {
    throw new TypeError("BIOME4 snow requires finite precipitation rates.");
  }
  return monthlyTotals;
}

function snowForcing(monthlyTemperatureCelsius, monthlyAnnualizedPrecipitationMmPerYear, captureFinalYear) {
  const dailyTemperature = biome4DailyTemperatureInterpolation(monthlyTemperatureCelsius);
  const monthlyTotals = requireMonthlyPrecipitation(monthlyAnnualizedPrecipitationMmPerYear);
  const dailyInterpolatedMonthlyTotal = biome4DailyTemperatureInterpolation(monthlyTotals);
  const daily = captureFinalYear ? [] : null;

  let snowpack = 0;
  let maximumSnowDepth = 0;
  let finalYearStartSnowpack = 0;
  let finalYearRawPrecipitation = 0;
  let finalYearLiquidPrecipitation = 0;
  let finalYearMelt = 0;
  for (let year = 0; year < 2; year += 1) {
    if (year === 1) finalYearStartSnowpack = snowpack;
    for (let day = 0; day < 365; day += 1) {
      const dailyWater = dailyInterpolatedMonthlyTotal[day] / AVERAGE_DAYS_PER_MONTH;
      const temperature = dailyTemperature[day];
      const snowfall = temperature < -1 ? dailyWater : 0;
      const liquidPrecipitation = temperature < -1 ? 0 : dailyWater;
      let melt = temperature < -1 ? 0 : 0.7 * (temperature + 1);
      if (melt > snowpack) melt = snowpack;
      snowpack += snowfall - melt;
      if (snowpack > maximumSnowDepth) maximumSnowDepth = snowpack;

      if (year === 1) {
        finalYearRawPrecipitation += dailyWater;
        finalYearLiquidPrecipitation += liquidPrecipitation;
        finalYearMelt += melt;
        if (daily) {
          daily.push(Object.freeze({
            dayOfYear: day + 1,
            temperatureCelsius: temperature,
            rawPrecipitationMm: dailyWater,
            snowfallMm: snowfall,
            liquidPrecipitationMm: liquidPrecipitation,
            snowMeltMm: melt,
            soilWaterInputMm: liquidPrecipitation + melt,
            snowpackMm: snowpack
          }));
        }
      }
    }
  }

  return {
    dailyTemperature,
    daily,
    maximumSnowDepth,
    finalYearStartSnowpack,
    finalYearEndSnowpack: snowpack,
    finalYearRawPrecipitation,
    finalYearLiquidPrecipitation,
    finalYearMelt
  };
}

// BIOME4's monthly-to-daily interpolation is generic; reuse the temperature
// interpolation because the source applies the same midpoint interpolation to
// precipitation before dividing the monthly total by 365/12.
export function biome4MaximumSnowDepth(
  monthlyTemperatureCelsius,
  monthlyAnnualizedPrecipitationMmPerYear
) {
  const forcing = snowForcing(monthlyTemperatureCelsius, monthlyAnnualizedPrecipitationMmPerYear, false);
  return Object.freeze({
    policy: BIOME4_SNOW_POLICY,
    maximumSnowDepthModelUnits: forcing.maximumSnowDepth,
    endSnowpackModelUnits: forcing.finalYearEndSnowpack,
    epistemicStatus: "independent reproduction of the BIOME4 4.1 degree-day snow eligibility driver from monthly Krapp temperature and precipitation; precipitation rates are divided by 12 to monthly totals before BIOME4-style daily interpolation"
  });
}

export function biome4DailySnowWaterForcing(
  monthlyTemperatureCelsius,
  monthlyAnnualizedPrecipitationMmPerYear
) {
  const forcing = snowForcing(monthlyTemperatureCelsius, monthlyAnnualizedPrecipitationMmPerYear, true);
  const snowStorageChange = forcing.finalYearEndSnowpack - forcing.finalYearStartSnowpack;
  return Object.freeze({
    policy: BIOME4_SNOW_POLICY,
    daily: Object.freeze(forcing.daily),
    maximumSnowDepthModelUnits: forcing.maximumSnowDepth,
    startSnowpackMm: forcing.finalYearStartSnowpack,
    endSnowpackMm: forcing.finalYearEndSnowpack,
    snowStorageChangeMm: snowStorageChange,
    rawPrecipitationMmPerYear: forcing.finalYearRawPrecipitation,
    liquidPrecipitationMmPerYear: forcing.finalYearLiquidPrecipitation,
    snowMeltMmPerYear: forcing.finalYearMelt,
    epistemicStatus: "independent BIOME4 4.1 two-year degree-day snow forcing; final-year liquid precipitation and melt feed candidate PFT soil hydrology while snowpack storage remains explicit in the annual water closure"
  });
}
