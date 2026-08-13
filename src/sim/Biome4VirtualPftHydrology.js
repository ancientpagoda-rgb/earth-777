import { BIOME4_PFTS } from "./Biome4PftEligibility.js";
import {
  biome4DailyMidmonthInterpolation,
  biome4SummergreenPhenologyFraction
} from "./Biome4PftWaterPhenology.js";
import {
  biome4FvcFromLai,
  biome4InitialPhotosyntheticPathway,
  biome4OptimumCanopyConductance
} from "./Biome4PftPhotosynthesis.js";
import { biome4VirtualDailyClimate } from "./Biome4VirtualClimateForcing.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 6) => Number(value.toFixed(digits));
const GRASS_CASE_PFT_IDS = new Set([8, 9, 12]);
const ALFAM = 1.4;
const GM = 5;

export const BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY = "biome4-4.1-parallel-virtual-pft-hydrology-v1";
export const BIOME4_VIRTUAL_PFT_LANDSCAPE_FEEDBACK = false;
export const BIOME4_TOP_PERCOLATION_DISCREPANCY = Object.freeze({
  sourceOperational: "BIOME4 4.1 hydrology uses k(1) * w(1)^4 for top-to-bottom percolation; the separate second-layer percolation input is not used in this daily transfer equation.",
  earth777Policy: "Virtual PFT trials reproduce the source top-coefficient behavior and report the unused second-layer coefficient."
});
export const BIOME4_PERCOLATION_CONSERVATION_REPAIR = Object.freeze({
  sourceOperational: "The shown BIOME4 daily source calculates k(1)*w(1)^4 without an explicit cap before transferring it to layer two.",
  earth777Policy: "Earth 777 caps the virtual transfer to water physically present in layer one so the parallel trial remains mass-conserving; the uncapped source flux is retained diagnostically."
});

function pftById(pftId) {
  const id = Math.trunc(Number(pftId));
  if (!(id >= 1 && id <= BIOME4_PFTS.length)) throw new RangeError(`Unknown BIOME4 PFT ${pftId}.`);
  return BIOME4_PFTS[id - 1];
}

function validateSoilProfile(soilProfile) {
  if (!soilProfile?.validSoil) throw new TypeError("Virtual BIOME4 PFT hydrology requires a valid two-layer BIOME4 soil profile.");
  const topCapacityMm = Number(soilProfile.topWaterCapacityMm);
  const bottomCapacityMm = Number(soilProfile.bottomWaterCapacityMm);
  const topPercolationCoefficient = Number(soilProfile.topPercolationCoefficient);
  const bottomPercolationCoefficient = Number(soilProfile.bottomPercolationCoefficient);
  if (![topCapacityMm, bottomCapacityMm, topPercolationCoefficient, bottomPercolationCoefficient].every(Number.isFinite)) {
    throw new TypeError("Virtual BIOME4 PFT hydrology requires finite BIOME4 soil values.");
  }
  return Object.freeze({
    topCapacityMm: Math.max(0, topCapacityMm),
    bottomCapacityMm: Math.max(0, bottomCapacityMm),
    topPercolationCoefficient: Math.max(0, topPercolationCoefficient),
    bottomPercolationCoefficient: Math.max(0, bottomPercolationCoefficient),
    source: soilProfile.source ?? "BIOME4 4.1 soil"
  });
}

function basePhenologyFraction(pft, monthlyTemperatureCelsius, effectiveDaylengthHours) {
  const grassCase = GRASS_CASE_PFT_IDS.has(pft.id);
  if (pft.parameters.phenology === "summergreen" || (pft.parameters.phenology === "raingreen" && grassCase)) {
    return biome4SummergreenPhenologyFraction(
      pft,
      monthlyTemperatureCelsius,
      Float64Array.from(effectiveDaylengthHours)
    ).fraction;
  }
  return Float64Array.from({ length: 365 }, () => 1);
}

function operationalLeafFraction(pft, baseFraction, rootWetness) {
  if (pft.parameters.phenology !== "raingreen") return baseFraction;
  const threshold = pft.parameters.raingreenLeafDropWetness == null
    ? null
    : Number(pft.parameters.raingreenLeafDropWetness);
  if (!Number.isFinite(threshold)) return baseFraction;
  if (baseFraction > 0.01 && rootWetness > threshold) return baseFraction;
  if (baseFraction < 0.01 && rootWetness > threshold) return baseFraction;
  return 0;
}

function monthlyCanopyConductance({ pft, lai, pathway, forcing, pressurePa, co2Ppm }) {
  return forcing.monthlyPhotosyntheticForcing.map((month) => biome4OptimumCanopyConductance({
    pftId: pft.id,
    lai,
    incomingSolarJm2Day: month.incomingSolarJm2Day,
    effectiveDaylengthHours: month.effectiveDaylengthHours,
    temperatureCelsius: month.temperatureCelsius,
    pressurePa,
    co2Ppm,
    pathway
  }));
}

function summarizeMonths(days) {
  const months = Array.from({ length: 12 }, (_, monthIndex) => ({
    monthIndex,
    aetMm: 0,
    runoffMm: 0,
    drainageMm: 0,
    meanRootWetness: 0,
    meanFvc: 0,
    meanCanopyConductance: 0,
    days: 0,
    wiltDays: 0
  }));
  for (const day of days) {
    const month = months[day.monthIndex];
    month.aetMm += day.actualEvapotranspirationMm;
    month.runoffMm += day.surfaceRunoffMm;
    month.drainageMm += day.bottomDrainageMm;
    month.meanRootWetness += day.rootZoneWetness;
    month.meanFvc += day.fvc;
    month.meanCanopyConductance += day.canopyConductance;
    month.days += 1;
    if (day.wilted) month.wiltDays += 1;
  }
  return Object.freeze(months.map((month) => Object.freeze({
    monthIndex: month.monthIndex,
    actualEvapotranspirationMm: round(month.aetMm),
    surfaceRunoffMm: round(month.runoffMm),
    bottomDrainageMm: round(month.drainageMm),
    runoffMm: round(month.runoffMm + month.drainageMm),
    meanRootZoneWetness: round(month.days ? month.meanRootWetness / month.days : 0),
    meanFvc: round(month.days ? month.meanFvc / month.days : 0),
    meanCanopyConductance: round(month.days ? month.meanCanopyConductance / month.days : 0),
    wiltDays: month.wiltDays
  })));
}

export function runBiome4VirtualPftHydrologyTrial({
  pftId,
  lai,
  pathway = "auto",
  latitude,
  monthlyTemperatureCelsius,
  monthlyCloudCoverPercent,
  monthlyPrecipitationMm,
  soilProfile,
  pressurePa,
  co2Ppm = 245,
  radiationAnomaly = null,
  hydrologySpinupYears = 2
}) {
  const pft = pftById(pftId);
  const soil = validateSoilProfile(soilProfile);
  const pressure = Number(pressurePa);
  if (!Number.isFinite(pressure) || pressure <= 0) {
    throw new TypeError("Virtual BIOME4 PFT hydrology requires explicit positive pressurePa.");
  }
  const leafAreaIndex = Math.max(0, Number(lai) || 0);
  const selectedPathway = pathway === "auto" ? biome4InitialPhotosyntheticPathway(pft.id) : String(pathway).toLowerCase();
  if (!new Set(["c3", "c4"]).has(selectedPathway)) throw new RangeError(`Unknown pathway ${pathway}.`);
  if (selectedPathway === "c4" && ![8, 9, 10].includes(pft.id)) {
    throw new RangeError(`BIOME4 C4 trial is only parameterized for PFT 8, 9, or 10; got ${pft.id}.`);
  }

  const forcing = biome4VirtualDailyClimate({
    latitude,
    monthlyTemperatureCelsius,
    monthlyCloudCoverPercent,
    monthlyPrecipitationMm,
    radiationAnomaly,
    snowSpinupYears: 2
  });
  const monthlyGc = monthlyCanopyConductance({
    pft,
    lai: leafAreaIndex,
    pathway: selectedPathway,
    forcing,
    pressurePa: pressure,
    co2Ppm
  });
  const dailyGcOpt = biome4DailyMidmonthInterpolation(monthlyGc.map((entry) => entry.optimumConductance));
  const effectiveDaylength = forcing.days.map((day) => day.effectiveDaylengthHours);
  const basePhenology = basePhenologyFraction(pft, monthlyTemperatureCelsius, effectiveDaylength);
  const maximumFvc = biome4FvcFromLai(pft.id, leafAreaIndex);
  const root = clamp(pft.parameters.topSoilRootFraction, 0, 1);
  const emax = Math.max(0, Number(pft.parameters.maximumDailyTranspiration) || 0);
  const minimumConductance = Math.max(0, Number(pft.parameters.minimumCanopyConductance) || 0);

  let topWetness = 0;
  let bottomWetness = 0;
  const years = Math.max(1, Math.min(20, Math.floor(Number(hydrologySpinupYears)) || 1));
  let finalYearStartTopStorageMm = 0;
  let finalYearStartBottomStorageMm = 0;
  let finalDays = null;
  let totalUncappedExcessTransferMm = 0;

  for (let year = 0; year < years; year += 1) {
    if (year === years - 1) {
      finalYearStartTopStorageMm = topWetness * soil.topCapacityMm;
      finalYearStartBottomStorageMm = bottomWetness * soil.bottomCapacityMm;
    }
    const days = [];
    for (let index = 0; index < 365; index += 1) {
      const climate = forcing.days[index];
      const startTopWetness = clamp(topWetness, 0, 1);
      const startBottomWetness = clamp(bottomWetness, 0, 1);
      const startTopStorageMm = startTopWetness * soil.topCapacityMm;
      const startBottomStorageMm = startBottomWetness * soil.bottomCapacityMm;
      const rootZoneWetness = root * startTopWetness + (1 - root) * startBottomWetness;
      let leafFraction = operationalLeafFraction(pft, basePhenology[index], rootZoneWetness);
      leafFraction = clamp(leafFraction, 0, 1);
      const fvc = maximumFvc * leafFraction;
      const pet = Math.max(0, climate.potentialEvapotranspirationMm);
      let canopyConductance = 0;
      let actualEvapotranspirationMm = 0;
      let percolationMm = 0;
      let surfaceRunoffMm = 0;
      let bottomDrainageMm = 0;
      let wilted = false;
      let optimalDemandMm = 0;
      let supplyMm = 0;
      let uncappedPercolationMm = 0;

      if (climate.temperatureCelsius > -10) {
        if (fvc === 0) {
          actualEvapotranspirationMm = 0.25 * pet;
        } else {
          const gmin = minimumConductance * fvc;
          canopyConductance = maximumFvc > 0 ? dailyGcOpt[index] * (fvc / maximumFvc) : 0;
          const surfaceConductance = canopyConductance + gmin;
          const alpha = surfaceConductance > 0 ? ALFAM * (1 - Math.exp(-surfaceConductance / GM)) : 0;
          actualEvapotranspirationMm = alpha * pet;
        }

        optimalDemandMm = 1.02 * actualEvapotranspirationMm;
        supplyMm = emax * rootZoneWetness;
        if (optimalDemandMm > supplyMm) {
          actualEvapotranspirationMm = supplyMm;
          if (pet > 0) {
            let a = 1 - supplyMm / (pet * ALFAM);
            if (a < 0) a = 0;
            const sourceSafeA = Math.max(a, 1e-12);
            const gsurf = -GM * Math.log(sourceSafeA);
            const gmin = minimumConductance * fvc;
            canopyConductance = gsurf - gmin;
            if (canopyConductance <= 0) {
              canopyConductance = 0;
              wilted = true;
            }
          } else {
            canopyConductance = 0;
          }
        }

        uncappedPercolationMm = soil.topPercolationCoefficient * startTopWetness ** 4;
        percolationMm = Math.min(uncappedPercolationMm, startTopStorageMm);
        totalUncappedExcessTransferMm += Math.max(0, uncappedPercolationMm - percolationMm);

        let topExtractionMm = 0;
        let bottomExtractionMm = 0;
        if (rootZoneWetness > 0) {
          topExtractionMm = root * (startTopWetness / rootZoneWetness) * actualEvapotranspirationMm;
          bottomExtractionMm = (1 - root) * (startBottomWetness / rootZoneWetness) * actualEvapotranspirationMm;
        }

        let nextTopStorageMm = startTopStorageMm + climate.liquidPrecipitationMm + climate.snowmeltMm -
          percolationMm - topExtractionMm;
        let nextBottomStorageMm = startBottomStorageMm + percolationMm - bottomExtractionMm;
        if (nextBottomStorageMm >= soil.bottomCapacityMm) {
          bottomDrainageMm = nextBottomStorageMm - soil.bottomCapacityMm;
          nextBottomStorageMm = soil.bottomCapacityMm;
        }
        if (nextTopStorageMm >= soil.topCapacityMm) {
          surfaceRunoffMm = nextTopStorageMm - soil.topCapacityMm;
          nextTopStorageMm = soil.topCapacityMm;
        }
        if (nextTopStorageMm <= 0) nextTopStorageMm = 0;
        if (nextBottomStorageMm <= 0) nextBottomStorageMm = 0;
        topWetness = soil.topCapacityMm > 0 ? nextTopStorageMm / soil.topCapacityMm : 0;
        bottomWetness = soil.bottomCapacityMm > 0 ? nextBottomStorageMm / soil.bottomCapacityMm : 0;
      }

      days.push(Object.freeze({
        dayOfYear: climate.dayOfYear,
        monthIndex: climate.monthIndex,
        temperatureCelsius: climate.temperatureCelsius,
        fvc: round(fvc),
        leafFraction: round(leafFraction),
        rootZoneWetness: round(rootZoneWetness),
        startTopWetness: round(startTopWetness),
        startBottomWetness: round(startBottomWetness),
        endTopWetness: round(topWetness),
        endBottomWetness: round(bottomWetness),
        potentialEvapotranspirationMm: round(pet),
        optimalDemandMm: round(optimalDemandMm),
        supplyMm: round(supplyMm),
        actualEvapotranspirationMm: round(actualEvapotranspirationMm),
        canopyConductance: round(canopyConductance),
        uncappedSourcePercolationMm: round(uncappedPercolationMm),
        percolationMm: round(percolationMm),
        surfaceRunoffMm: round(surfaceRunoffMm),
        bottomDrainageMm: round(bottomDrainageMm),
        wilted
      }));
    }
    finalDays = days;
  }

  const finalTopStorageMm = topWetness * soil.topCapacityMm;
  const finalBottomStorageMm = bottomWetness * soil.bottomCapacityMm;
  const storageChangeMm = (finalTopStorageMm + finalBottomStorageMm) -
    (finalYearStartTopStorageMm + finalYearStartBottomStorageMm);
  const liquidInputMm = forcing.liquidToSoilMm;
  const actualEvapotranspirationMm = finalDays.reduce((sum, day) => sum + day.actualEvapotranspirationMm, 0);
  const surfaceRunoffMm = finalDays.reduce((sum, day) => sum + day.surfaceRunoffMm, 0);
  const bottomDrainageMm = finalDays.reduce((sum, day) => sum + day.bottomDrainageMm, 0);
  const waterBalanceResidualMm = liquidInputMm - actualEvapotranspirationMm - surfaceRunoffMm - bottomDrainageMm - storageChangeMm;
  const monthly = summarizeMonths(finalDays);
  const wiltDays = finalDays.filter((day) => day.wilted).length;
  const greenDays = finalDays.filter((day) => day.fvc > 0).length;

  return Object.freeze({
    policy: BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY,
    pftId: pft.id,
    pftCode: pft.code,
    pftName: pft.name,
    pathway: selectedPathway,
    lai: leafAreaIndex,
    maximumFvc: round(maximumFvc),
    rootTopFraction: root,
    maximumDailyTranspirationMm: emax,
    minimumCanopyConductance: minimumConductance,
    pressurePa: pressure,
    co2Ppm: Number(co2Ppm),
    soilSource: soil.source,
    topSoilWaterCapacityMm: soil.topCapacityMm,
    bottomSoilWaterCapacityMm: soil.bottomCapacityMm,
    sourceTopPercolationCoefficient: soil.topPercolationCoefficient,
    sourceBottomPercolationCoefficient: soil.bottomPercolationCoefficient,
    operationalPercolationCoefficient: soil.topPercolationCoefficient,
    secondLayerPercolationCoefficientUsed: false,
    percolationDiscrepancy: BIOME4_TOP_PERCOLATION_DISCREPANCY,
    conservationRepair: BIOME4_PERCOLATION_CONSERVATION_REPAIR,
    uncappedSourcePercolationExcessMm: round(totalUncappedExcessTransferMm),
    liquidInputMm: round(liquidInputMm),
    actualEvapotranspirationMm: round(actualEvapotranspirationMm),
    surfaceRunoffMm: round(surfaceRunoffMm),
    bottomDrainageMm: round(bottomDrainageMm),
    totalRunoffMm: round(surfaceRunoffMm + bottomDrainageMm),
    startSoilStorageMm: round(finalYearStartTopStorageMm + finalYearStartBottomStorageMm),
    endSoilStorageMm: round(finalTopStorageMm + finalBottomStorageMm),
    soilStorageChangeMm: round(storageChangeMm),
    waterBalanceResidualMm: round(waterBalanceResidualMm, 9),
    snowStorageChangeMm: forcing.snowStorageChangeMm,
    snowMassBalanceResidualMm: forcing.snowMassBalanceResidualMm,
    maximumSnowpackModelUnits: forcing.maximumSnowpackModelUnits,
    greenDays,
    wiltDays,
    sustainableAtFixedLai: wiltDays === 0,
    monthlyCanopyConductance: Object.freeze(monthlyGc),
    monthly,
    daily: Object.freeze(finalDays),
    landscapeHydrologyFeedback: BIOME4_VIRTUAL_PFT_LANDSCAPE_FEEDBACK,
    radiationAnomalyAssumption: forcing.radiationAnomalyAssumption,
    epistemicStatus: "parallel virtual BIOME4 4.1 fixed-LAI candidate water trial using source radiation/PET, snow, phenology, conductance, root water supply and runoff order; trial soil state is independent of Earth 777 landscape runoff, and an explicit conservative percolation cap prevents source-equation over-transfer from creating water"
  });
}

export function runBiome4VirtualPftCandidateTrial(input) {
  const pft = pftById(input?.pftId);
  if (pft.id !== 10 || (input?.pathway && input.pathway !== "auto")) {
    return runBiome4VirtualPftHydrologyTrial(input);
  }
  const c4 = runBiome4VirtualPftHydrologyTrial({ ...input, pathway: "c4" });
  const c3 = runBiome4VirtualPftHydrologyTrial({ ...input, pathway: "c3" });
  return Object.freeze({
    policy: BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY,
    pftId: 10,
    pftCode: pft.code,
    pftName: pft.name,
    pathwaySelection: "unresolved-until-NPP",
    alternatives: Object.freeze({ c3, c4 }),
    landscapeHydrologyFeedback: false,
    epistemicStatus: "BIOME4 4.1 evaluates PFT10 C4 and C3 alternatives before monthly NPP pathway selection; Earth 777 therefore preserves both virtual hydrology alternatives until the NPP phase is implemented"
  });
}
