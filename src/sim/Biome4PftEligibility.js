const UNDEFINED = null;
const MID_MONTH_DAYS = Object.freeze([16, 44, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350]);

export const BIOME4_PFT_ELIGIBILITY_POLICY = "biome4-4.1-climate-eligibility-independent-v1";

const freezeLimits = (limits = {}) => Object.freeze({
  coldestMonthCelsius: Object.freeze(limits.coldestMonthCelsius ?? [UNDEFINED, UNDEFINED]),
  absoluteMinimumCelsius: Object.freeze(limits.absoluteMinimumCelsius ?? [UNDEFINED, UNDEFINED]),
  gdd5: Object.freeze(limits.gdd5 ?? [UNDEFINED, UNDEFINED]),
  gdd0: Object.freeze(limits.gdd0 ?? [UNDEFINED, UNDEFINED]),
  warmestMonthCelsius: Object.freeze(limits.warmestMonthCelsius ?? [UNDEFINED, UNDEFINED]),
  maximumSnowDepthModelUnits: Object.freeze(limits.maximumSnowDepthModelUnits ?? [UNDEFINED, UNDEFINED])
});

const pft = (id, code, name, parameters, climateLimits, options = {}) => Object.freeze({
  id,
  code,
  name,
  disabledInBiome4Version: Boolean(options.disabledInBiome4Version),
  parameters: Object.freeze({ ...parameters }),
  climateLimits: freezeLimits(climateLimits)
});

// These are factual parameter values transcribed from the official BIOME4 4.1
// distribution. The executable eligibility logic below is an independent
// implementation for Earth 777, not copied program structure.
export const BIOME4_PFTS = Object.freeze([
  pft(1, "tet", "Tropical evergreen trees", {
    phenology: "evergreen", minimumCanopyConductance: 0.5, maximumDailyTranspiration: 10,
    raingreenLeafDropWetness: null, raingreenLeafOutWetness: null, topSoilRootFraction: 0.69,
    leafLongevityMonths: 18, leafOutGdd5: null, leafOutGdd0: null, sapwoodRespiration: true, c4Capable: false
  }, { absoluteMinimumCelsius: [0, null], warmestMonthCelsius: [10, null] }, { disabledInBiome4Version: true }),
  pft(2, "trt", "Tropical raingreen trees", {
    phenology: "raingreen", minimumCanopyConductance: 0.5, maximumDailyTranspiration: 10,
    raingreenLeafDropWetness: 0.5, raingreenLeafOutWetness: 0.6, topSoilRootFraction: 0.70,
    leafLongevityMonths: 9, leafOutGdd5: null, leafOutGdd0: null, sapwoodRespiration: true, c4Capable: false
  }, { absoluteMinimumCelsius: [0, null], warmestMonthCelsius: [10, null] }),
  pft(3, "wte", "Temperate broadleaved evergreen trees", {
    phenology: "evergreen", minimumCanopyConductance: 0.2, maximumDailyTranspiration: 4.8,
    raingreenLeafDropWetness: null, raingreenLeafOutWetness: null, topSoilRootFraction: 0.67,
    leafLongevityMonths: 18, leafOutGdd5: null, leafOutGdd0: null, sapwoodRespiration: true, c4Capable: false
  }, { absoluteMinimumCelsius: [-8, 5], gdd5: [1200, null], warmestMonthCelsius: [10, null] }),
  pft(4, "tst", "Temperate summergreen trees", {
    phenology: "summergreen", minimumCanopyConductance: 0.8, maximumDailyTranspiration: 10,
    raingreenLeafDropWetness: null, raingreenLeafOutWetness: null, topSoilRootFraction: 0.65,
    leafLongevityMonths: 7, leafOutGdd5: 200, leafOutGdd0: null, sapwoodRespiration: true, c4Capable: false
  }, { coldestMonthCelsius: [-15, null], absoluteMinimumCelsius: [null, -8], gdd5: [1200, null] }),
  pft(5, "ctc", "Cool conifer trees", {
    phenology: "evergreen", minimumCanopyConductance: 0.2, maximumDailyTranspiration: 4.8,
    raingreenLeafDropWetness: null, raingreenLeafOutWetness: null, topSoilRootFraction: 0.52,
    leafLongevityMonths: 30, leafOutGdd5: null, leafOutGdd0: null, sapwoodRespiration: true, c4Capable: false
  }, { coldestMonthCelsius: [-2, null], absoluteMinimumCelsius: [null, 10], gdd5: [900, null], warmestMonthCelsius: [10, null] }),
  pft(6, "bec", "Boreal evergreen trees", {
    phenology: "evergreen", minimumCanopyConductance: 0.5, maximumDailyTranspiration: 4.5,
    raingreenLeafDropWetness: null, raingreenLeafOutWetness: null, topSoilRootFraction: 0.83,
    leafLongevityMonths: 24, leafOutGdd5: null, leafOutGdd0: null, sapwoodRespiration: true, c4Capable: false
  }, { coldestMonthCelsius: [-32.5, -2], warmestMonthCelsius: [null, 21] }),
  pft(7, "bst", "Boreal deciduous trees", {
    phenology: "summergreen", minimumCanopyConductance: 0.8, maximumDailyTranspiration: 10,
    raingreenLeafDropWetness: null, raingreenLeafOutWetness: null, topSoilRootFraction: 0.83,
    leafLongevityMonths: 24, leafOutGdd5: 200, leafOutGdd0: null, sapwoodRespiration: true, c4Capable: false
  }, { coldestMonthCelsius: [null, 5], absoluteMinimumCelsius: [null, -10], warmestMonthCelsius: [null, 21] }),
  pft(8, "tgr", "Temperate grass", {
    phenology: "raingreen", minimumCanopyConductance: 0.8, maximumDailyTranspiration: 6.5,
    raingreenLeafDropWetness: 0.2, raingreenLeafOutWetness: 0.3, topSoilRootFraction: 0.83,
    leafLongevityMonths: 8, leafOutGdd5: null, leafOutGdd0: 100, sapwoodRespiration: false, c4Capable: true
  }, { absoluteMinimumCelsius: [null, 0], gdd5: [550, null] }),
  pft(9, "wgr", "Tropical / warm-temperate grass", {
    phenology: "raingreen", minimumCanopyConductance: 0.8, maximumDailyTranspiration: 8,
    raingreenLeafDropWetness: 0.2, raingreenLeafOutWetness: 0.3, topSoilRootFraction: 0.57,
    leafLongevityMonths: 10, leafOutGdd5: null, leafOutGdd0: null, sapwoodRespiration: false, c4Capable: true
  }, { absoluteMinimumCelsius: [-3, null], warmestMonthCelsius: [10, null] }),
  pft(10, "des", "Woody desert plant type", {
    phenology: "evergreen", minimumCanopyConductance: 0.1, maximumDailyTranspiration: 1,
    raingreenLeafDropWetness: null, raingreenLeafOutWetness: null, topSoilRootFraction: 0.53,
    leafLongevityMonths: 12, leafOutGdd5: null, leafOutGdd0: null, sapwoodRespiration: true, c4Capable: true
  }, { absoluteMinimumCelsius: [-45, null], gdd5: [500, null], warmestMonthCelsius: [10, null] }),
  pft(11, "tsh", "Tundra shrub", {
    phenology: "evergreen", minimumCanopyConductance: 0.8, maximumDailyTranspiration: 1,
    raingreenLeafDropWetness: null, raingreenLeafOutWetness: null, topSoilRootFraction: 0.93,
    leafLongevityMonths: 8, leafOutGdd5: null, leafOutGdd0: null, sapwoodRespiration: true, c4Capable: false
  }, { gdd0: [50, null], warmestMonthCelsius: [null, 15], maximumSnowDepthModelUnits: [15, null] }),
  pft(12, "che", "Cold herbaceous type", {
    phenology: "summergreen", minimumCanopyConductance: 0.8, maximumDailyTranspiration: 1,
    raingreenLeafDropWetness: null, raingreenLeafOutWetness: null, topSoilRootFraction: 0.93,
    leafLongevityMonths: 8, leafOutGdd5: null, leafOutGdd0: 25, sapwoodRespiration: false, c4Capable: false
  }, { gdd0: [50, null], warmestMonthCelsius: [null, 15] }),
  pft(13, "lfo", "Lichen / forb type", {
    phenology: "evergreen", minimumCanopyConductance: 0.8, maximumDailyTranspiration: 1,
    raingreenLeafDropWetness: null, raingreenLeafOutWetness: null, topSoilRootFraction: 0.93,
    leafLongevityMonths: 8, leafOutGdd5: null, leafOutGdd0: null, sapwoodRespiration: true, c4Capable: false
  }, { warmestMonthCelsius: [null, 15] })
]);

export const BIOME4_PHOTOSYNTHESIS_MINIMUM_MONTHLY_TEMPERATURE_C = Object.freeze([
  10, 10, 5, 4, 3, 0, 0, 4.5, 10, 5, -7, -7, -12
]);

function requireMonthlyTemperatures(monthlyTemperatureCelsius) {
  if (!Array.isArray(monthlyTemperatureCelsius) || monthlyTemperatureCelsius.length !== 12) {
    throw new TypeError("BIOME4 climate eligibility requires exactly 12 monthly temperatures.");
  }
  const values = monthlyTemperatureCelsius.map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("BIOME4 climate eligibility requires finite monthly temperatures.");
  }
  return values;
}

export function biome4DailyTemperatureInterpolation(monthlyTemperatureCelsius) {
  const monthly = requireMonthlyTemperatures(monthlyTemperatureCelsius);
  const daily = new Float64Array(365);
  const decemberToJanuaryIncrement = (monthly[0] - monthly[11]) / 31;

  daily[349] = monthly[11]; // source day 350
  for (let day = 351; day <= 365; day += 1) {
    daily[day - 1] = daily[day - 2] + decemberToJanuaryIncrement;
  }
  daily[0] = daily[364] + decemberToJanuaryIncrement;
  for (let day = 2; day <= 15; day += 1) {
    daily[day - 1] = daily[day - 2] + decemberToJanuaryIncrement;
  }

  for (let month = 0; month < 11; month += 1) {
    const startDay = MID_MONTH_DAYS[month];
    const endDay = MID_MONTH_DAYS[month + 1];
    const increment = (monthly[month + 1] - monthly[month]) / (endDay - startDay);
    daily[startDay - 1] = monthly[month];
    for (let day = startDay + 1; day < endDay; day += 1) {
      daily[day - 1] = daily[day - 2] + increment;
    }
  }
  return daily;
}

export function deriveBiome4ClimateIndices(
  monthlyTemperatureCelsius,
  { absoluteMinimumTemperatureCelsius = null, maximumSnowDepthModelUnits = null } = {}
) {
  const monthly = requireMonthlyTemperatures(monthlyTemperatureCelsius);
  const coldestMonthCelsius = Math.min(...monthly);
  const warmestMonthCelsius = Math.max(...monthly);
  const suppliedMinimum = Number(absoluteMinimumTemperatureCelsius);
  const hasUsableMinimum = Number.isFinite(suppliedMinimum) && suppliedMinimum <= coldestMonthCelsius;
  const absoluteMinimumCelsius = hasUsableMinimum ? suppliedMinimum : coldestMonthCelsius - 5;
  const daily = biome4DailyTemperatureInterpolation(monthly);
  let gdd5 = 0;
  let gdd0 = 0;
  for (const temperature of daily) {
    gdd5 += Math.max(0, temperature - 5);
    gdd0 += Math.max(0, temperature);
  }
  const snow = Number(maximumSnowDepthModelUnits);
  return Object.freeze({
    coldestMonthCelsius,
    warmestMonthCelsius,
    absoluteMinimumCelsius,
    absoluteMinimumSource: hasUsableMinimum ? "supplied" : "BIOME4 coldest-month minus 5 C fallback",
    gdd5,
    gdd0,
    maximumSnowDepthModelUnits: Number.isFinite(snow) ? snow : null
  });
}

function checkBound(value, [lower, upper], key) {
  if (lower == null && upper == null) return Object.freeze({ key, status: "not-constrained" });
  if (!Number.isFinite(value)) return Object.freeze({ key, status: "unresolved", lower, upper });
  const lowerPass = lower == null || value >= lower;
  const upperPass = upper == null || value < upper;
  return Object.freeze({ key, status: lowerPass && upperPass ? "pass" : "fail", value, lower, upper });
}

export function evaluateBiome4PftClimateEligibility(
  monthlyTemperatureCelsius,
  options = {}
) {
  const indices = deriveBiome4ClimateIndices(monthlyTemperatureCelsius, options);
  const indexMap = Object.freeze({
    coldestMonthCelsius: indices.coldestMonthCelsius,
    absoluteMinimumCelsius: indices.absoluteMinimumCelsius,
    gdd5: indices.gdd5,
    gdd0: indices.gdd0,
    warmestMonthCelsius: indices.warmestMonthCelsius,
    maximumSnowDepthModelUnits: indices.maximumSnowDepthModelUnits
  });

  const evaluations = BIOME4_PFTS.map((plant) => {
    const checks = Object.entries(plant.climateLimits).map(([key, bounds]) =>
      checkBound(indexMap[key], bounds, key)
    );
    const climateStatus = checks.some((check) => check.status === "fail")
      ? "ineligible"
      : checks.some((check) => check.status === "unresolved")
        ? "unresolved"
        : "eligible";
    const status = plant.disabledInBiome4Version ? "disabled" : climateStatus;
    return Object.freeze({
      id: plant.id,
      code: plant.code,
      name: plant.name,
      status,
      climateStatus,
      disabledInBiome4Version: plant.disabledInBiome4Version,
      failedConstraints: Object.freeze(checks.filter((check) => check.status === "fail")),
      unresolvedConstraints: Object.freeze(checks.filter((check) => check.status === "unresolved"))
    });
  });

  return Object.freeze({
    policy: BIOME4_PFT_ELIGIBILITY_POLICY,
    indices,
    evaluations: Object.freeze(evaluations),
    eligiblePftIds: Object.freeze(evaluations.filter((entry) => entry.status === "eligible").map((entry) => entry.id)),
    unresolvedPftIds: Object.freeze(evaluations.filter((entry) => entry.status === "unresolved").map((entry) => entry.id)),
    disabledPftIds: Object.freeze(evaluations.filter((entry) => entry.status === "disabled").map((entry) => entry.id)),
    epistemicStatus: "BIOME4 4.1 parameter-constrained climate eligibility, independently implemented from published/distributed parameter semantics; eligibility is only a PFT environmental sieve, not NPP/LAI competition or a categorical biome transition"
  });
}
