import { BIOME4_PFTS } from "./Biome4PftEligibility.js";
import {
  BIOME4_C4_CONDUCTANCE_CI_CA_RATIO,
  BIOME4_MAX_C3_CI_CA_RATIO,
  biome4FvcFromLai,
  biome4OptimumCanopyConductance,
  biome4PftPhotosynthesis
} from "./Biome4PftPhotosynthesis.js";
import {
  biome4DailyMidmonthInterpolation,
  biome4RootZoneWaterState,
  biome4SummergreenPhenologyFraction
} from "./Biome4PftWaterPhenology.js";
import { biome4AtmosphericEquilibriumDemand } from "./Biome4AtmosphericDemand.js";
import { biome4DailySnowWaterForcing } from "./Biome4Snow.js";
import { biome4ConductanceControlledAet } from "./Biome4VirtualPftHydrology.js";
import { atmosphericPressureKPa } from "./WaterBalance.js";
import { biome4FireDrynessDiagnostic } from "./Biome4FireDryness.js";

const DAYS_IN_MONTH = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
const RESPIRATION_FACTOR = Object.freeze([0.8, 0.8, 1.4, 1.6, 0.8, 4.0, 4.0, 1.6, 0.8, 1.4, 4.0, 4.0, 4.0]);
const ALLOCATION_FACTOR = Object.freeze([1.0, 1.0, 1.2, 1.2, 1.2, 1.2, 1.2, 1.0, 1.0, 1.0, 1.0, 1.0, 1.5]);
const GRASS_PHENOLOGY_PFT_IDS = new Set([8, 9, 12]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 6) => Number(value.toFixed(digits));

export const BIOME4_PFT_GROWTH_POLICY = "biome4-4.1-fixed-lai-growth-independent-v1";
export const BIOME4_PFT_LAI_OPTIMIZATION_POLICY = "biome4-4.1-findnpp-eight-round-search-independent-v1";

export const BIOME4_GROWTH_SOURCE_REPAIRS = Object.freeze({
  woodyRaingreenFirstDayFvc: "BIOME4 4.1 reads the local fvc scalar before assigning it on the first hydrology spin-up day for woody raingreen PFTs. Earth 777 deterministically seeds that source state leafless (fvc=0); subsequent days and the second output year follow source state carry.",
  zeroStemRespirationPartition: "If all monthly stem-maintenance weights are zero, BIOME4 would divide by zero when partitioning fine-root respiration. Earth 777 distributes no monthly root respiration in that degenerate case and reports the repair.",
  photosynthesisBisectionBracket: "BIOME4 assumes the conductance/photosynthesis bisection root is bracketed and leaves gphot undefined if no fmid<=0 update occurs. Earth 777 initializes gphot to zero and reports a bracket failure rather than reproducing undefined memory.",
  waterConservation: "Earth 777 caps layer-specific AET withdrawal by available storage. This preserves the source demand/supply equations while preventing the source's post-subtraction zero clamp from silently destroying water mass."
});

export const BIOME4_NPP_OBJECTIVE_DISCREPANCY = Object.freeze({
  annual: "BIOME4 first computes annual NPP with 20% construction respiration and a litterfall minimum-allocation test.",
  operational: "The executable later computes monthly NPP with a 2% next-month growth-respiration term and unconditionally replaces annual NPP with the monthly sum when they differ. findnpp therefore optimizes the monthly-sum value.",
  earth777Policy: "Earth 777 exposes both values and uses the operational monthly-sum objective for source-compatible LAI search."
});

export const BIOME4_C4_MONTH_RULE_DISCREPANCY = Object.freeze({
  comment: "The source comment says C4 advantage must persist for at least two months.",
  operational: "The executable requires c4months >= 3 before enabling month-by-month C4 selection for PFT 10.",
  earth777Policy: "Earth 777 follows the executable >=3 rule and reports the discrepancy."
});

function pftById(id) {
  const pft = BIOME4_PFTS.find((entry) => entry.id === Number(id));
  if (!pft) throw new RangeError(`Unknown BIOME4 PFT ${id}.`);
  return pft;
}

function requireMonthly(values, label) {
  if (!Array.isArray(values) || values.length !== 12) throw new TypeError(`${label} requires exactly 12 monthly values.`);
  const result = values.map(Number);
  if (result.some((value) => !Number.isFinite(value))) throw new TypeError(`${label} requires finite monthly values.`);
  return result;
}

function normalizeSoil(soilProfile) {
  if (!soilProfile?.validSoil) throw new TypeError("BIOME4 fixed-LAI growth requires a valid BIOME4 soil profile.");
  const topCapacity = Math.max(0, Number(soilProfile.topWaterCapacityMm) || 0);
  const bottomCapacity = Math.max(0, Number(soilProfile.bottomWaterCapacityMm) || 0);
  if (topCapacity + bottomCapacity <= 0) throw new TypeError("BIOME4 fixed-LAI growth requires positive soil water capacity.");
  return Object.freeze({
    topCapacityMm: topCapacity,
    bottomCapacityMm: bottomCapacity,
    topPercolationCoefficient: Math.max(0, Number(soilProfile.topPercolationCoefficient) || 0)
  });
}

function monthForDay(dayIndex) {
  let offset = dayIndex;
  for (let month = 0; month < 12; month += 1) {
    if (offset < DAYS_IN_MONTH[month]) return month;
    offset -= DAYS_IN_MONTH[month];
  }
  return 11;
}

function annualizedPrecipitationToAnnualTotal(monthlyPrecipitationMmPerYear) {
  return monthlyPrecipitationMmPerYear.reduce((sum, rate) => sum + Math.max(0, rate) / 12, 0);
}

function genericPhenology(pft, monthlyTemperatureCelsius, dailyDaylengthHours) {
  if (pft.parameters.phenology === "summergreen" || (pft.parameters.phenology === "raingreen" && GRASS_PHENOLOGY_PFT_IDS.has(pft.id))) {
    return biome4SummergreenPhenologyFraction(pft, monthlyTemperatureCelsius, dailyDaylengthHours).fraction;
  }
  return Float64Array.from({ length: 365 }, () => 1);
}

function sourcePhenologyFvc({ pft, maxFvc, genericFraction, rootWetness, priorFvc }) {
  const phenology = pft.parameters.phenology;
  const grassCase = GRASS_PHENOLOGY_PFT_IDS.has(pft.id);
  const off = Number(pft.parameters.raingreenLeafDropWetness);
  // Operational BIOME4 4.1 assigns parameter 4 to both onnw and offw.
  const threshold = Number.isFinite(off) ? off : null;

  if (phenology === "evergreen") return maxFvc;
  if (phenology === "summergreen") return maxFvc * clamp(genericFraction, 0, 1);

  if (grassCase) {
    let fvc = maxFvc * clamp(genericFraction, 0, 1);
    if (threshold == null) return fvc;
    if (fvc > 0.01 && rootWetness > threshold) return fvc;
    if (fvc < 0.01 && rootWetness > threshold) return fvc;
    return 0;
  }

  if (threshold == null) return maxFvc;
  const previous = Number.isFinite(priorFvc) ? priorFvc : 0;
  if (previous > 0.01 && rootWetness > threshold) return maxFvc;
  if (previous < 0.01 && rootWetness > threshold) return maxFvc;
  return 0;
}

function upperPercolationMm(topWetness, coefficient) {
  return Math.max(0, coefficient) * clamp(topWetness, 0, 1) ** 4;
}

function conservativeSourceExtraction(topStorage, bottomStorage, requestedAet, rootState) {
  const requested = Math.max(0, Number(requestedAet) || 0);
  const topRequested = requested * clamp(rootState.topExtractionShare, 0, 1);
  const bottomRequested = requested * clamp(rootState.bottomExtractionShare, 0, 1);
  const topRemoved = Math.min(topStorage, topRequested);
  const bottomRemoved = Math.min(bottomStorage, bottomRequested);
  return Object.freeze({
    topRemoved,
    bottomRemoved,
    removed: topRemoved + bottomRemoved,
    underflowMm: Math.max(0, requested - topRemoved - bottomRemoved)
  });
}

function runSourceHydrology({
  pft,
  lai,
  pathway,
  soil,
  atmosphere,
  snow,
  monthlyTemperatureCelsius,
  monthlyPrecipitationMmPerYear,
  elevationMeters,
  co2Ppm
}) {
  const maxFvc = biome4FvcFromLai(pft.id, lai);
  const pressurePa = atmosphericPressureKPa(elevationMeters) * 1000;
  const monthlyOptimumConductance = monthlyTemperatureCelsius.map((temperatureCelsius, monthIndex) =>
    biome4OptimumCanopyConductance({
      pftId: pft.id,
      lai,
      incomingSolarJm2Day: atmosphere.monthlyIncomingSolarJm2Day[monthIndex],
      effectiveDaylengthHours: atmosphere.monthlyEffectiveDaylengthHours[monthIndex],
      temperatureCelsius,
      pressurePa,
      co2Ppm,
      pathway
    }).optimumConductance
  );
  const dailyOptimumConductance = biome4DailyMidmonthInterpolation(monthlyOptimumConductance);
  const generic = genericPhenology(pft, monthlyTemperatureCelsius, atmosphere.dailyEffectiveDaylengthHours);
  const annualPrecipitation = annualizedPrecipitationToAnnualTotal(monthlyPrecipitationMmPerYear);
  const initialWetness = clamp(annualPrecipitation / 1000, 0, 1);
  let topStorage = initialWetness * soil.topCapacityMm;
  let bottomStorage = initialWetness * soil.bottomCapacityMm;
  let priorFvc = 0; // deterministic repair for the source's first-day uninitialized woody-raingreen state.
  let final = null;

  for (let spinupYear = 0; spinupYear < 2; spinupYear += 1) {
    const monthlyMeanFvc = Array(12).fill(0);
    const monthlyMeanCanopyConductance = Array(12).fill(0);
    const monthlyMeanRootWetness = Array.from({ length: 12 }, () => [0, 0, 0]);
    const monthlyMeanAet = Array(12).fill(0);
    const monthlyRunoff = Array(12).fill(0);
    const daily = [];
    let annualAet = 0;
    let annualRunoff = 0;
    let wilt = false;
    let underflowMm = 0;
    let greenDays = 0;
    const startStorage = topStorage + bottomStorage;

    for (let dayIndex = 0; dayIndex < 365; dayIndex += 1) {
      const month = monthForDay(dayIndex);
      const topWetness = soil.topCapacityMm > 0 ? clamp(topStorage / soil.topCapacityMm, 0, 1) : 0;
      const bottomWetness = soil.bottomCapacityMm > 0 ? clamp(bottomStorage / soil.bottomCapacityMm, 0, 1) : 0;
      const root = biome4RootZoneWaterState(pft, topWetness, bottomWetness);
      const fvc = sourcePhenologyFvc({
        pft,
        maxFvc,
        genericFraction: generic[dayIndex],
        rootWetness: root.effectiveRootZoneWetness,
        priorFvc
      });
      priorFvc = fvc;
      if (fvc > 0) greenDays += 1;

      const temperature = atmosphere.dailyTemperatureCelsius[dayIndex];
      const deq = atmosphere.dailyEquilibriumDemandMm[dayIndex];
      const flux = biome4ConductanceControlledAet({
        equilibriumDemandMm: deq,
        fractionalVegetationCover: fvc,
        maximumFractionalVegetationCover: maxFvc,
        optimumCanopyConductance: dailyOptimumConductance[dayIndex],
        minimumCanopyConductance: pft.parameters.minimumCanopyConductance,
        rootZoneWetness: root.effectiveRootZoneWetness,
        maximumDailyTranspirationMm: pft.parameters.maximumDailyTranspiration,
        temperatureCelsius: temperature
      });
      if (flux.wilted) wilt = true;

      let dayAet = 0;
      let dayRunoff = 0;
      let dayDrainage = 0;
      let percolation = 0;
      if (temperature > -10) {
        percolation = Math.min(topStorage, upperPercolationMm(topWetness, soil.topPercolationCoefficient));
        const extraction = conservativeSourceExtraction(topStorage, bottomStorage, flux.actualAetMm, root);
        dayAet = extraction.removed;
        underflowMm += extraction.underflowMm;
        topStorage += snow.daily[dayIndex].soilWaterInputMm - percolation - extraction.topRemoved;
        bottomStorage += percolation - extraction.bottomRemoved;

        if (bottomStorage >= soil.bottomCapacityMm) {
          dayDrainage = Math.max(0, bottomStorage - soil.bottomCapacityMm);
          bottomStorage = soil.bottomCapacityMm;
        }
        if (topStorage >= soil.topCapacityMm) {
          dayRunoff = Math.max(0, topStorage - soil.topCapacityMm);
          topStorage = soil.topCapacityMm;
        }
        if (topStorage < 0) topStorage = 0;
        if (bottomStorage < 0) bottomStorage = 0;
      }

      const days = DAYS_IN_MONTH[month];
      if (Number.isFinite(flux.canopyConductance) && flux.canopyConductance !== 0) {
        monthlyMeanCanopyConductance[month] += flux.canopyConductance / days;
      }
      if (fvc !== 0) monthlyMeanFvc[month] += fvc / days;
      monthlyMeanRootWetness[month][0] += root.effectiveRootZoneWetness / days;
      monthlyMeanRootWetness[month][1] += topWetness / days;
      monthlyMeanRootWetness[month][2] += bottomWetness / days;
      monthlyMeanAet[month] += dayAet / days;
      monthlyRunoff[month] += dayRunoff + dayDrainage;
      annualAet += dayAet;
      annualRunoff += dayRunoff + dayDrainage;
      daily.push(Object.freeze({
        dayOfYear: dayIndex + 1,
        monthIndex: month,
        fvc: round(fvc),
        rootZoneWetness: round(root.effectiveRootZoneWetness),
        canopyConductance: Number.isFinite(flux.canopyConductance) ? round(flux.canopyConductance) : null,
        aetMm: round(dayAet),
        runoffMm: round(dayRunoff + dayDrainage),
        topWetness: round(soil.topCapacityMm > 0 ? topStorage / soil.topCapacityMm : 0),
        bottomWetness: round(soil.bottomCapacityMm > 0 ? bottomStorage / soil.bottomCapacityMm : 0)
      }));
    }

    const endStorage = topStorage + bottomStorage;
    const storageChange = endStorage - startStorage;
    const residual = snow.rawPrecipitationMmPerYear - annualAet - annualRunoff - storageChange - snow.snowStorageChangeMm;
    final = Object.freeze({
      maxFvc: round(maxFvc),
      initialWetness: round(initialWetness),
      monthlyMeanFvc: Object.freeze(monthlyMeanFvc.map((value) => round(value))),
      monthlyMeanCanopyConductance: Object.freeze(monthlyMeanCanopyConductance.map((value) => round(value))),
      monthlyMeanRootWetness: Object.freeze(monthlyMeanRootWetness.map((values) => Object.freeze(values.map((value) => round(value))))),
      monthlyMeanAet: Object.freeze(monthlyMeanAet.map((value) => round(value))),
      monthlyRunoff: Object.freeze(monthlyRunoff.map((value) => round(value))),
      annualAetMm: round(annualAet),
      annualRunoffMm: round(annualRunoff),
      startStorageMm: round(startStorage),
      endStorageMm: round(endStorage),
      storageChangeMm: round(storageChange),
      snowStorageChangeMm: round(snow.snowStorageChangeMm),
      waterBalanceResidualMm: round(residual, 9),
      wilt,
      greenDays,
      sourceShareUnderflowMm: round(underflowMm),
      monthlyOptimumConductance: Object.freeze(monthlyOptimumConductance.map((value) => round(value))),
      daily: Object.freeze(daily)
    });
  }
  return final;
}

function realizedMonthlyPhotosynthesis({
  pft,
  pathway,
  lai,
  hydrology,
  atmosphere,
  monthlyTemperatureCelsius,
  pressurePa,
  co2Ppm
}) {
  const maxFvc = biome4FvcFromLai(pft.id, lai);
  const ciCaOptimum = pathway === "c4"
    ? BIOME4_C4_CONDUCTANCE_CI_CA_RATIO
    : BIOME4_MAX_C3_CI_CA_RATIO[pft.id - 1];
  const ca = Math.max(0, Number(co2Ppm) || 0) * 1e-6;
  const monthly = [];

  for (let month = 0; month < 12; month += 1) {
    const meanFvc = hydrology.monthlyMeanFvc[month];
    const meanGc = hydrology.monthlyMeanCanopyConductance[month];
    const optimum = biome4PftPhotosynthesis({
      pftId: pft.id,
      ciCaRatio: ciCaOptimum,
      incomingSolarJm2Day: atmosphere.monthlyIncomingSolarJm2Day[month],
      effectiveDaylengthHours: atmosphere.monthlyEffectiveDaylengthHours[month],
      temperatureCelsius: monthlyTemperatureCelsius[month],
      fpar: maxFvc,
      pressurePa,
      co2Ppm
    }, pathway);

    let gphot = 0;
    let ciCaRatio = 0;
    let leafRespiration = maxFvc > 0 ? optimum.leafRespiration * (meanFvc / maxFvc) : 0;
    let bracketUpdated = false;
    if (meanGc !== 0) {
      let rtbis = 0.02;
      let dx = (ciCaOptimum + 0.05) - 0.02;
      for (let iteration = 0; iteration < 10; iteration += 1) {
        dx *= 0.5;
        const xmid = rtbis + dx;
        const photo = biome4PftPhotosynthesis({
          pftId: pft.id,
          ciCaRatio: xmid,
          incomingSolarJm2Day: atmosphere.monthlyIncomingSolarJm2Day[month],
          effectiveDaylengthHours: atmosphere.monthlyEffectiveDaylengthHours[month],
          temperatureCelsius: monthlyTemperatureCelsius[month],
          fpar: meanFvc,
          pressurePa,
          co2Ppm
        }, pathway);
        const gt = 3600 * atmosphere.monthlyEffectiveDaylengthHours[month] * meanGc;
        const ap = gt === 0
          ? 0
          : pft.parameters.minimumCanopyConductance + (gt / 1.6) * (ca * (1 - xmid));
        const fmid = photo.gasExchangeAday - ap;
        // Source leafresp is overwritten on every bisection evaluation.
        leafRespiration = photo.leafRespiration;
        if (fmid <= 0) {
          rtbis = xmid;
          gphot = photo.grossPhotosynthesis;
          bracketUpdated = true;
        }
      }
      ciCaRatio = rtbis;
    }

    monthly.push(Object.freeze({
      monthIndex: month,
      meanFvc: round(meanFvc),
      meanCanopyConductance: round(meanGc),
      ciCaRatio: round(ciCaRatio),
      bracketUpdated,
      dailyGrossPhotosynthesis: round(gphot),
      dailyLeafRespiration: round(leafRespiration),
      grossPrimaryProduction: round(DAYS_IN_MONTH[month] * gphot),
      leafRespiration: round(DAYS_IN_MONTH[month] * leafRespiration)
    }));
  }
  return Object.freeze(monthly);
}

function respirationAndMonthlyNpp(pft, lai, monthlyTemperatureCelsius, photosynthesis) {
  const litterfall = lai * 50 * ALLOCATION_FACTOR[pft.id - 1];
  const monthlyStem = monthlyTemperatureCelsius.map((temperature) => {
    if (temperature <= -46.02) return 0;
    return lai * 0.5 * RESPIRATION_FACTOR[pft.id - 1] *
      Math.exp(308.56 * (1 / (10 + 46.02) - 1 / (temperature + 46.02)));
  });
  const rawStemRespiration = monthlyStem.reduce((sum, value) => sum + value, 0);
  const fineRootRespiration = 0.25 * litterfall;
  const zeroStemPartitionRepairUsed = rawStemRespiration <= 0;
  const monthlyRoot = monthlyStem.map((value) => rawStemRespiration > 0 ? (value / rawStemRespiration) * fineRootRespiration : 0);
  const monthlyBackLeaf = monthlyRoot.map((value, month) => value * photosynthesis[month].meanFvc * 4);
  const directLeafRespiration = photosynthesis.reduce((sum, month) => sum + month.leafRespiration, 0);
  const leafMaintenance = monthlyBackLeaf.reduce((sum, value) => sum + value, 0);
  const leafRespiration = directLeafRespiration + leafMaintenance;
  const stemRespiration = pft.parameters.sapwoodRespiration ? rawStemRespiration : 0;
  const gpp = photosynthesis.reduce((sum, month) => sum + month.grossPrimaryProduction, 0);
  const growthRespiration = 0.2 * (gpp - stemRespiration - leafRespiration - fineRootRespiration);
  let annualAllocationNpp = gpp - stemRespiration - leafRespiration - fineRootRespiration - growthRespiration;
  const minimumAllocation = litterfall;
  const annualAllocationRejected = annualAllocationNpp < minimumAllocation;
  if (annualAllocationRejected) annualAllocationNpp = -9999;

  const monthlyMaintenance = photosynthesis.map((month, index) =>
    month.leafRespiration + monthlyBackLeaf[index] + (pft.parameters.sapwoodRespiration ? monthlyStem[index] : 0) + monthlyRoot[index]
  );
  const monthlyNpp = photosynthesis.map((month, index) => {
    const next = (index + 1) % 12;
    const growth = Math.max(0, 0.02 * (photosynthesis[next].grossPrimaryProduction - monthlyMaintenance[next]));
    return month.grossPrimaryProduction - (monthlyMaintenance[index] + growth);
  });
  const operationalMonthlySumNpp = monthlyNpp.reduce((sum, value) => sum + value, 0);

  return Object.freeze({
    gpp: round(gpp),
    litterfall: round(litterfall),
    fineRootRespiration: round(fineRootRespiration),
    stemRespiration: round(stemRespiration),
    rawStemRespiration: round(rawStemRespiration),
    directLeafRespiration: round(directLeafRespiration),
    leafMaintenance: round(leafMaintenance),
    totalLeafRespiration: round(leafRespiration),
    annualGrowthRespiration: round(growthRespiration),
    annualAllocationNpp: round(annualAllocationNpp),
    annualAllocationRejected,
    minimumAllocation: round(minimumAllocation),
    zeroStemPartitionRepairUsed,
    monthlyStemRespiration: Object.freeze(monthlyStem.map((value) => round(value))),
    monthlyRootRespiration: Object.freeze(monthlyRoot.map((value) => round(value))),
    monthlyBackLeafRespiration: Object.freeze(monthlyBackLeaf.map((value) => round(value))),
    monthlyMaintenanceRespiration: Object.freeze(monthlyMaintenance.map((value) => round(value))),
    monthlyNpp: Object.freeze(monthlyNpp.map((value) => round(value))),
    operationalMonthlySumNpp: round(operationalMonthlySumNpp)
  });
}

function evaluatePathway(input, pft, lai, pathway, shared) {
  const hydrology = runSourceHydrology({
    pft,
    lai,
    pathway,
    soil: shared.soil,
    atmosphere: shared.atmosphere,
    snow: shared.snow,
    monthlyTemperatureCelsius: shared.monthlyTemperature,
    monthlyPrecipitationMmPerYear: shared.monthlyPrecipitation,
    elevationMeters: input.elevationMeters,
    co2Ppm: input.co2Ppm
  });
  const photosynthesis = realizedMonthlyPhotosynthesis({
    pft,
    pathway,
    lai,
    hydrology,
    atmosphere: shared.atmosphere,
    monthlyTemperatureCelsius: shared.monthlyTemperature,
    pressurePa: shared.pressurePa,
    co2Ppm: input.co2Ppm
  });
  const carbon = respirationAndMonthlyNpp(pft, lai, shared.monthlyTemperature, photosynthesis);
  return Object.freeze({ pathway, hydrology, photosynthesis, carbon });
}

export function biome4PftGrowthAtLai({
  pftId,
  lai,
  soilProfile,
  latitude,
  monthlyTemperatureCelsius,
  monthlyCloudCoverPercent,
  monthlyPrecipitationMmPerYear,
  elevationMeters = 0,
  co2Ppm = 245
}) {
  const pft = pftById(pftId);
  const leafArea = Math.max(0.0001, Number(lai) || 0.0001);
  const monthlyTemperature = requireMonthly(monthlyTemperatureCelsius, "BIOME4 fixed-LAI growth temperature");
  const monthlyCloud = requireMonthly(monthlyCloudCoverPercent, "BIOME4 fixed-LAI growth cloud");
  const monthlyPrecipitation = requireMonthly(monthlyPrecipitationMmPerYear, "BIOME4 fixed-LAI growth precipitation");
  const soil = normalizeSoil(soilProfile);
  const atmosphere = biome4AtmosphericEquilibriumDemand({
    latitude,
    monthlyTemperatureCelsius: monthlyTemperature,
    monthlyCloudCoverPercent: monthlyCloud
  });
  const snow = biome4DailySnowWaterForcing(monthlyTemperature, monthlyPrecipitation);
  const pressurePa = atmosphericPressureKPa(elevationMeters) * 1000;
  const shared = { soil, atmosphere, snow, pressurePa, monthlyTemperature, monthlyPrecipitation };

  if (pft.id === 10) {
    const c4 = evaluatePathway({ elevationMeters, co2Ppm }, pft, leafArea, "c4", shared);
    const c3 = evaluatePathway({ elevationMeters, co2Ppm }, pft, leafArea, "c3", shared);
    const c4AdvantageMonths = c4.carbon.monthlyNpp.reduce((count, value, month) =>
      count + (value > c3.carbon.monthlyNpp[month] ? 1 : 0), 0
    );
    const mixed = c4AdvantageMonths >= 3;
    const monthlyNpp = c3.carbon.monthlyNpp.map((value, month) =>
      mixed && c4.carbon.monthlyNpp[month] > value ? c4.carbon.monthlyNpp[month] : value
    );
    const objectiveNpp = monthlyNpp.reduce((sum, value) => sum + value, 0);
    // Source fire is called after the second (C3) rerun, so PFT 10 uses the
    // C3 wet trajectory even when monthly NPP later selects some C4 months.
    const fireDryness = biome4FireDrynessDiagnostic({
      pftId: pft.id,
      lai: leafArea,
      npp: objectiveNpp,
      hydrology: c3.hydrology
    });
    return Object.freeze({
      policy: BIOME4_PFT_GROWTH_POLICY,
      pftId: pft.id,
      pftCode: pft.code,
      pftName: pft.name,
      lai: round(leafArea),
      operationalObjectiveNpp: round(objectiveNpp),
      monthlyNpp: Object.freeze(monthlyNpp.map((value) => round(value))),
      c4AdvantageMonths,
      mixedC3C4MonthsEnabled: mixed,
      c3,
      c4,
      fireDryness,
      nppObjectiveDiscrepancy: BIOME4_NPP_OBJECTIVE_DISCREPANCY,
      c4MonthRuleDiscrepancy: BIOME4_C4_MONTH_RULE_DISCREPANCY,
      sourceRepairs: BIOME4_GROWTH_SOURCE_REPAIRS,
      pressurePa: round(pressurePa, 2),
      epistemicStatus: "independent source-operational BIOME4 4.1 fixed-LAI candidate growth evaluation with explicit deterministic/conservation repairs; PFT 10 evaluates complete C4 then C3 pathways and follows the executable >=3-month switch rule. This remains a parallel candidate diagnostic and does not alter shared Earth hydrology or biome category."
    });
  }

  const pathway = pft.id === 9 ? "c4" : "c3";
  const evaluated = evaluatePathway({ elevationMeters, co2Ppm }, pft, leafArea, pathway, shared);
  const fireDryness = biome4FireDrynessDiagnostic({
    pftId: pft.id,
    lai: leafArea,
    npp: evaluated.carbon.operationalMonthlySumNpp,
    hydrology: evaluated.hydrology
  });
  return Object.freeze({
    policy: BIOME4_PFT_GROWTH_POLICY,
    pftId: pft.id,
    pftCode: pft.code,
    pftName: pft.name,
    lai: round(leafArea),
    pathway,
    operationalObjectiveNpp: evaluated.carbon.operationalMonthlySumNpp,
    monthlyNpp: evaluated.carbon.monthlyNpp,
    annualAllocationNpp: evaluated.carbon.annualAllocationNpp,
    annualAllocationRejected: evaluated.carbon.annualAllocationRejected,
    hydrology: evaluated.hydrology,
    photosynthesis: evaluated.photosynthesis,
    carbon: evaluated.carbon,
    fireDryness,
    nppObjectiveDiscrepancy: BIOME4_NPP_OBJECTIVE_DISCREPANCY,
    sourceRepairs: BIOME4_GROWTH_SOURCE_REPAIRS,
    pressurePa: round(pressurePa, 2),
    epistemicStatus: "independent source-operational BIOME4 4.1 fixed-LAI candidate growth evaluation with explicit deterministic/conservation repairs; operational NPP is the monthly-sum objective actually returned to findnpp. This remains a parallel candidate diagnostic and does not alter shared Earth hydrology or biome category."
  });
}

export function biome4FindNppSearch(evaluateLai) {
  if (typeof evaluateLai !== "function") throw new TypeError("biome4FindNppSearch requires an LAI evaluator function.");
  let lowbound = 0.01;
  let range = 8.0;
  let optimumLai = 0;
  let optimumNpp = 0;
  let optimumEvaluation = null;
  const evaluations = [];

  for (let iteration = 1; iteration <= 8; iteration += 1) {
    const candidates = [lowbound + 0.25 * range, lowbound + 0.75 * range];
    for (const candidateLai of candidates) {
      const result = evaluateLai(candidateLai);
      const npp = Number(result?.operationalObjectiveNpp ?? result?.npp ?? result);
      if (!Number.isFinite(npp)) throw new TypeError(`LAI evaluator returned non-finite NPP at LAI ${candidateLai}.`);
      evaluations.push(Object.freeze({
        iteration,
        lai: round(candidateLai, 8),
        npp: round(npp),
        result
      }));
      if (npp >= optimumNpp) {
        optimumLai = candidateLai;
        optimumNpp = npp;
        optimumEvaluation = result;
      }
    }
    range /= 2;
    lowbound = optimumLai - range / 2;
    if (lowbound <= 0) lowbound = 0.01;
  }

  return Object.freeze({
    policy: BIOME4_PFT_LAI_OPTIMIZATION_POLICY,
    optimumLai: round(optimumLai, 8),
    optimumNpp: round(optimumNpp),
    optimumEvaluation,
    evaluations: Object.freeze(evaluations),
    evaluationCount: evaluations.length,
    sourceSearchSemantics: "eight iterations; evaluate low+range/4 then low+3range/4; retain >= ties; halve range; recenter on global best; floor low bound to 0.01"
  });
}

export function optimizeBiome4PftLaiNpp(input) {
  const pft = pftById(input?.pftId);
  const search = biome4FindNppSearch((lai) => biome4PftGrowthAtLai({ ...input, pftId: pft.id, lai }));
  return Object.freeze({
    ...search,
    pftId: pft.id,
    pftCode: pft.code,
    pftName: pft.name,
    checkpointCategoryMutationEnabled: false,
    fireDrynessIntegrated: true,
    fireDryness: search.optimumEvaluation?.fireDryness ?? null,
    fireDrynessStatus: search.optimumEvaluation?.fireDryness ? "resolved" : "nonproductive-no-optimum",
    sourceRepairs: BIOME4_GROWTH_SOURCE_REPAIRS,
    nppObjectiveDiscrepancy: BIOME4_NPP_OBJECTIVE_DISCREPANCY,
    epistemicStatus: "BIOME4 4.1 source-operational LAI/NPP optimization reproduced independently for one climate-eligible parallel PFT candidate. The optimized result carries source-operational fire and top-layer dryness diagnostics when findnpp selects a nonnegative growth trajectory; climate-eligible candidates that remain negative at every tested LAI are explicitly labeled nonproductive-no-optimum instead of receiving fabricated fire/dryness. No competitive occupancy decision or biome-category mutation is enabled."
  });
}
