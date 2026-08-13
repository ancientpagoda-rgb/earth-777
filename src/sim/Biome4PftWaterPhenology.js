import { BIOME4_PFTS, biome4DailyTemperatureInterpolation } from "./Biome4PftEligibility.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 4) => Number(value.toFixed(digits));
const DAYS_IN_MONTH = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
const MID_MONTH_DAYS = Object.freeze([16, 44, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350]);
const GRASS_CASE_PFT_IDS = new Set([8, 9, 12]);

export const BIOME4_PFT_WATER_PHENOLOGY_POLICY = "biome4-4.1-pft-water-phenology-diagnostic-v1";
export const BIOME4_RAINGREEN_THRESHOLD_DISCREPANCY = Object.freeze({
  declared: "BIOME4 PFT parameter 4 is leaf-drop wetness and parameter 5 is leaf-on wetness.",
  operational: "BIOME4 4.1 hydrology assigns parameter 4 to both offw and onnw; parameter 5 is not used by the executable leaf-switching logic.",
  earth777Policy: "Earth 777 reports both values and reproduces the source-operational parameter-4 behavior by default."
});

function pftById(id) {
  return BIOME4_PFTS.find((entry) => entry.id === Number(id)) ?? null;
}

function requirePft(pftOrId) {
  const pft = typeof pftOrId === "object" && pftOrId ? pftOrId : pftById(pftOrId);
  if (!pft) throw new RangeError(`Unknown BIOME4 PFT ${pftOrId}.`);
  return pft;
}

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

export function biome4DailyMidmonthInterpolation(monthlyValues) {
  const monthly = requireMonthly(monthlyValues, "BIOME4 daily interpolation");
  const daily = new Float64Array(365);
  const wrapIncrement = (monthly[0] - monthly[11]) / 31;
  daily[349] = monthly[11];
  for (let day = 351; day <= 365; day += 1) daily[day - 1] = daily[day - 2] + wrapIncrement;
  daily[0] = daily[364] + wrapIncrement;
  for (let day = 2; day <= 15; day += 1) daily[day - 1] = daily[day - 2] + wrapIncrement;
  for (let month = 0; month < 11; month += 1) {
    const startDay = MID_MONTH_DAYS[month];
    const endDay = MID_MONTH_DAYS[month + 1];
    const increment = (monthly[month + 1] - monthly[month]) / (endDay - startDay);
    daily[startDay - 1] = monthly[month];
    for (let day = startDay + 1; day < endDay; day += 1) daily[day - 1] = daily[day - 2] + increment;
  }
  return daily;
}

export function biome4EffectiveDaylengthHours({
  latitude,
  dayOfYear,
  temperatureCelsius,
  cloudCoverPercent
}) {
  const pi = Math.PI;
  const deg = pi / 180;
  const lat = clamp(latitude, -90, 90);
  const day = clamp(Math.floor(dayOfYear), 1, 365);
  const temperature = Number(temperatureCelsius) || 0;
  const cloud = clamp(cloudCoverPercent, 0, 100) / 100;

  // Exact BIOME4 4.1 ppeett operational constants. Its "daylength" is the
  // interval of positive net radiation, not a purely astronomical sunrise /
  // sunset duration. Radiation-anomaly multipliers cancel from u/v here.
  const b = 0.2;
  const radup = 107;
  const qoo = 1360;
  const d = 0.5;
  const c = 0.25;
  const albedo = 0.17;
  const longwave = (b + (1 - b) * cloud) * (radup - temperature);
  const qo = qoo * (1 + 2 * 0.01675 * Math.cos(deg * (360 * day) / 365));
  const shortwave = qo * (c + d * cloud) * (1 - albedo);
  const declination = -deg * 23.4 * Math.cos(deg * 360 * (day + 10) / 365);
  const cla = Math.cos(lat * deg) * Math.cos(declination);
  const sla = Math.sin(lat * deg) * Math.sin(declination);
  const u = shortwave * sla - longwave;
  const v = shortwave * cla;
  let hourAngle;
  if (u >= v) hourAngle = pi;
  else if (u <= -v) hourAngle = 0;
  else hourAngle = Math.acos(clamp(-u / v, -1, 1));
  return 24 * (hourAngle / pi);
}

export function biome4RootZoneWaterState(pftOrId, topWetness, bottomWetness) {
  const pft = requirePft(pftOrId);
  const rootTopFraction = clamp(pft.parameters.topSoilRootFraction, 0, 1);
  const top = clamp(topWetness, 0, 1);
  const bottom = clamp(bottomWetness, 0, 1);
  const effectiveRootZoneWetness = rootTopFraction * top + (1 - rootTopFraction) * bottom;
  let topExtractionShare = 0;
  let bottomExtractionShare = 0;
  if (effectiveRootZoneWetness > 0) {
    topExtractionShare = rootTopFraction * (top / effectiveRootZoneWetness);
    bottomExtractionShare = (1 - rootTopFraction) * (bottom / effectiveRootZoneWetness);
  }
  const maximumDailyTranspirationMm = Math.max(0, Number(pft.parameters.maximumDailyTranspiration) || 0);
  return Object.freeze({
    rootTopFraction,
    topWetness: top,
    bottomWetness: bottom,
    effectiveRootZoneWetness: round(effectiveRootZoneWetness, 6),
    topExtractionShare: round(topExtractionShare, 6),
    bottomExtractionShare: round(bottomExtractionShare, 6),
    maximumDailyTranspirationMm,
    waterSupplyCapacityMmPerDay: round(maximumDailyTranspirationMm * effectiveRootZoneWetness, 6)
  });
}

function coldAndHotMonths(monthlyTemperatureCelsius) {
  const coldest = Math.min(...monthlyTemperatureCelsius);
  let coldMonth = 0;
  let warm = coldest;
  let hotMonth = null;
  for (let month = 0; month < 12; month += 1) {
    if (monthlyTemperatureCelsius[month] === coldest) coldMonth = month;
    if (monthlyTemperatureCelsius[month] > warm) {
      warm = monthlyTemperatureCelsius[month];
      hotMonth = month;
    }
  }
  // The Fortran source leaves hotm undefined for a perfectly isothermal year.
  // Earth 777 cannot reproduce undefined memory, so it uses month zero as a
  // deterministic guard and reports this case in diagnostics.
  const isothermalGuardUsed = hotMonth == null;
  if (hotMonth == null) hotMonth = 0;
  const previousCold = (coldMonth + 11) % 12;
  const nextCold = (coldMonth + 1) % 12;
  return { coldest, coldMonth, hotMonth, coldMonths: new Set([previousCold, coldMonth, nextCold]), isothermalGuardUsed };
}

export function biome4SummergreenPhenologyFraction(
  pftOrId,
  monthlyTemperatureCelsius,
  dailyDaylengthHours
) {
  const pft = requirePft(pftOrId);
  const monthly = requireMonthly(monthlyTemperatureCelsius, "BIOME4 summergreen phenology");
  if (!(dailyDaylengthHours instanceof Float64Array || Array.isArray(dailyDaylengthHours)) || dailyDaylengthHours.length !== 365) {
    throw new TypeError("BIOME4 summergreen phenology requires 365 daily daylength values.");
  }
  const dailyTemperature = biome4DailyTemperatureInterpolation(monthly);
  const grassCase = GRASS_CASE_PFT_IDS.has(pft.id);
  const rampRaw = grassCase ? pft.parameters.leafOutGdd0 : pft.parameters.leafOutGdd5;
  const ramp = Number.isFinite(Number(rampRaw)) ? Number(rampRaw) : -99;
  const onsetTemperature = pft.id === 7 ? 0 : 5;
  const { coldMonths, hotMonth, isothermalGuardUsed } = coldAndHotMonths(monthly);
  const fraction = new Float64Array(365);
  fraction.fill(1);
  let gdd = 0;
  let flip = 0;

  for (let spinup = 0; spinup < 2; spinup += 1) {
    let dayIndex = 0;
    for (let month = 0; month < 12; month += 1) {
      for (let dayOfMonth = 0; dayOfMonth < DAYS_IN_MONTH[month]; dayOfMonth += 1) {
        const temperature = dailyTemperature[dayIndex];
        if (temperature > onsetTemperature) {
          if (!coldMonths.has(month)) {
            gdd += Math.max(0, temperature); // BIOME4 source operational form, not T - threshold.
            fraction[dayIndex] = gdd === 0 ? 0 : gdd / ramp;
            if (gdd >= ramp) fraction[dayIndex] = 1;
            flip = 1;
          } else {
            gdd = 0;
            fraction[dayIndex] = 0;
            flip = 0;
          }
        }

        if (!grassCase) {
          // Source converts December hotm to 0; with zero-based months this is
          // naturally represented by hotMonth=0 when December is warmest.
          const sourceHotThreshold = hotMonth === 11 ? 0 : hotMonth;
          if (month >= sourceHotThreshold) {
            if (temperature < -10 || Number(dailyDaylengthHours[dayIndex]) < 10) fraction[dayIndex] = 0;
          } else if (month === [...coldMonths][0]) {
            fraction[dayIndex] = 0;
          }
        } else if (temperature < -5) {
          fraction[dayIndex] = 0;
        }
        dayIndex += 1;
      }
    }
    void flip; // retained to mirror the two-year source-state structure.
  }

  return Object.freeze({
    fraction,
    ramp,
    onsetTemperatureCelsius: onsetTemperature,
    grassCase,
    isothermalHotMonthGuardUsed: isothermalGuardUsed,
    sourceOperationalGddNote: "BIOME4 gates accumulation by onset temperature but adds full positive daily temperature to the canopy ramp."
  });
}

function raingreenFraction(pft, baseFraction, rootWetness) {
  const declaredOff = Number(pft.parameters.raingreenLeafDropWetness);
  const declaredOn = Number(pft.parameters.raingreenLeafOutWetness);
  const operationalOff = Number.isFinite(declaredOff) ? declaredOff : null;
  const operationalOn = operationalOff; // BIOME4 4.1 executable assigns pft parameter 4 to both.
  if (operationalOff == null) return baseFraction;
  if (baseFraction > 0.01 && rootWetness > operationalOff) return baseFraction;
  if (baseFraction < 0.01 && rootWetness > operationalOn) return baseFraction;
  return 0;
}

export function evaluateBiome4PftWaterPhenology(
  pftOrId,
  {
    latitude,
    monthlyTemperatureCelsius,
    monthlyCloudCoverPercent,
    dailyWaterTrace
  }
) {
  const pft = requirePft(pftOrId);
  const monthlyTemperature = requireMonthly(monthlyTemperatureCelsius, "BIOME4 PFT water/phenology temperature");
  const monthlyCloud = requireMonthly(monthlyCloudCoverPercent, "BIOME4 PFT water/phenology cloud");
  if (!Array.isArray(dailyWaterTrace) || dailyWaterTrace.length !== 365) {
    return Object.freeze({
      pftId: pft.id,
      pftCode: pft.code,
      status: "unresolved-water-trace",
      policy: BIOME4_PFT_WATER_PHENOLOGY_POLICY,
      epistemicStatus: "PFT water access requires the opt-in daily two-layer soil trace; no monthly-storage interpolation is substituted."
    });
  }

  const dailyTemperature = biome4DailyTemperatureInterpolation(monthlyTemperature);
  const dailyCloud = biome4DailyMidmonthInterpolation(monthlyCloud);
  const dailyDaylength = new Float64Array(365);
  for (let index = 0; index < 365; index += 1) {
    dailyDaylength[index] = biome4EffectiveDaylengthHours({
      latitude,
      dayOfYear: index + 1,
      temperatureCelsius: dailyTemperature[index],
      cloudCoverPercent: dailyCloud[index]
    });
  }

  const genericPhenology = pft.parameters.phenology === "evergreen"
    ? { fraction: Float64Array.from({ length: 365 }, () => 1), grassCase: GRASS_CASE_PFT_IDS.has(pft.id), isothermalHotMonthGuardUsed: false }
    : biome4SummergreenPhenologyFraction(pft, monthlyTemperature, dailyDaylength);

  const daily = [];
  let greenDays = 0;
  let rootWetnessSum = 0;
  let supplySum = 0;
  let leafFractionSum = 0;
  let minimumRootWetness = 1;
  let maximumRootWetness = 0;
  for (let index = 0; index < 365; index += 1) {
    const waterDay = dailyWaterTrace[index];
    const rootWater = biome4RootZoneWaterState(
      pft,
      waterDay.startTopWetness,
      waterDay.startBottomWetness
    );
    let leafFraction = genericPhenology.fraction[index];
    if (pft.parameters.phenology === "raingreen") {
      leafFraction = raingreenFraction(pft, leafFraction, rootWater.effectiveRootZoneWetness);
    }
    leafFraction = clamp(leafFraction, 0, 1);
    if (leafFraction > 0) greenDays += 1;
    rootWetnessSum += rootWater.effectiveRootZoneWetness;
    supplySum += rootWater.waterSupplyCapacityMmPerDay;
    leafFractionSum += leafFraction;
    minimumRootWetness = Math.min(minimumRootWetness, rootWater.effectiveRootZoneWetness);
    maximumRootWetness = Math.max(maximumRootWetness, rootWater.effectiveRootZoneWetness);
    daily.push(Object.freeze({
      dayOfYear: index + 1,
      rootZoneWetness: rootWater.effectiveRootZoneWetness,
      waterSupplyCapacityMmPerDay: rootWater.waterSupplyCapacityMmPerDay,
      topExtractionShare: rootWater.topExtractionShare,
      bottomExtractionShare: rootWater.bottomExtractionShare,
      leafFraction: round(leafFraction, 6),
      effectiveDaylengthHours: round(dailyDaylength[index], 4)
    }));
  }

  const declaredLeafDropWetness = Number.isFinite(Number(pft.parameters.raingreenLeafDropWetness))
    ? Number(pft.parameters.raingreenLeafDropWetness) : null;
  const declaredLeafOnWetness = Number.isFinite(Number(pft.parameters.raingreenLeafOutWetness))
    ? Number(pft.parameters.raingreenLeafOutWetness) : null;
  const operationalLeafOnWetness = declaredLeafDropWetness;
  return Object.freeze({
    pftId: pft.id,
    pftCode: pft.code,
    pftName: pft.name,
    status: "resolved-diagnostic",
    rootTopFraction: pft.parameters.topSoilRootFraction,
    maximumDailyTranspirationMm: pft.parameters.maximumDailyTranspiration,
    meanRootZoneWetness: round(rootWetnessSum / 365, 4),
    minimumRootZoneWetness: round(minimumRootWetness, 4),
    maximumRootZoneWetness: round(maximumRootWetness, 4),
    meanWaterSupplyCapacityMmPerDay: round(supplySum / 365, 4),
    greenDays,
    meanLeafFraction: round(leafFractionSum / 365, 4),
    declaredLeafDropWetness,
    declaredLeafOnWetness,
    sourceOperationalLeafOnWetness: operationalLeafOnWetness,
    raingreenThresholdDiscrepancy: pft.parameters.phenology === "raingreen" && declaredLeafOnWetness !== operationalLeafOnWetness,
    raingreenDiscrepancyNote: pft.parameters.phenology === "raingreen" ? BIOME4_RAINGREEN_THRESHOLD_DISCREPANCY : null,
    isothermalHotMonthGuardUsed: Boolean(genericPhenology.isothermalHotMonthGuardUsed),
    daily: Object.freeze(daily),
    policy: BIOME4_PFT_WATER_PHENOLOGY_POLICY,
    epistemicStatus: "BIOME4-parameter-constrained diagnostic using Earth 777's conserved daily soil state; root-zone wetness, supply capacity and source-operational phenology are model derived and do not yet alter hydrology, optimize LAI/NPP, or trigger categorical biome transitions."
  });
}
