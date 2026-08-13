import { BIOME4_PFTS } from "./Biome4PftEligibility.js";
import {
  biome4FvcFromLai,
  biome4OptimumCanopyConductance
} from "./Biome4PftPhotosynthesis.js";
import {
  biome4DailyMidmonthInterpolation,
  biome4RootZoneWaterState
} from "./Biome4PftWaterPhenology.js";
import { biome4AtmosphericEquilibriumDemand } from "./Biome4AtmosphericDemand.js";
import { biome4DailySnowWaterForcing } from "./Biome4Snow.js";
import { atmosphericPressureKPa } from "./WaterBalance.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 6) => Number(value.toFixed(digits));

export const BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY = "biome4-parallel-pft-water-trial-v2-conductance-equilibrium";
export const BIOME4_MAXIMUM_PRIESTLEY_TAYLOR_ALPHA = 1.4;
export const BIOME4_CONDUCTANCE_SCALE_MM_S = 5;

function pftById(id) {
  const pft = BIOME4_PFTS.find((entry) => entry.id === Number(id));
  if (!pft) throw new RangeError(`Unknown BIOME4 PFT ${id}.`);
  return pft;
}

function normalizeSoil(soilProfile) {
  if (!soilProfile?.validSoil) throw new TypeError("Virtual PFT hydrology requires a valid BIOME4 soil profile.");
  const topCapacity = Math.max(0, Number(soilProfile.topWaterCapacityMm) || 0);
  const bottomCapacity = Math.max(0, Number(soilProfile.bottomWaterCapacityMm) || 0);
  if (topCapacity + bottomCapacity <= 0) throw new TypeError("Virtual PFT hydrology requires positive BIOME4 soil capacity.");
  return Object.freeze({
    topCapacityMm: topCapacity,
    bottomCapacityMm: bottomCapacity,
    topPercolationCoefficient: Math.max(0, Number(soilProfile.topPercolationCoefficient) || 0),
    bottomPercolationCoefficient: Math.max(0, Number(soilProfile.bottomPercolationCoefficient) || 0)
  });
}

function sourceUpperPercolation(storage, capacity, coefficient) {
  if (storage <= 0 || capacity <= 0 || coefficient <= 0) return 0;
  const wetness = clamp(storage / capacity, 0, 1);
  return coefficient * wetness ** 4;
}

function requireDailyTrace(trace) {
  if (!Array.isArray(trace) || trace.length !== 365) {
    throw new TypeError("Virtual PFT hydrology requires a 365-day conserved hydrology trace for initial soil state/reference only.");
  }
  if (!Number.isFinite(Number(trace[0]?.startTopStorageMm)) || !Number.isFinite(Number(trace[0]?.startBottomStorageMm))) {
    throw new TypeError("Virtual PFT hydrology requires finite initial top and bottom soil storage.");
  }
  return trace;
}

function requireMonthly(values, label) {
  if (!Array.isArray(values) || values.length !== 12) throw new TypeError(`${label} requires exactly 12 monthly values.`);
  const result = values.map(Number);
  if (result.some((value) => !Number.isFinite(value))) throw new TypeError(`${label} requires finite monthly values.`);
  return result;
}

function extractAetBySourceRootShares(topStorage, bottomStorage, requestedAet, root) {
  const requested = Math.max(0, Number(requestedAet) || 0);
  const topRequested = requested * clamp(root.topExtractionShare, 0, 1);
  const bottomRequested = requested * clamp(root.bottomExtractionShare, 0, 1);
  const topRemoved = Math.min(topStorage, topRequested);
  const bottomRemoved = Math.min(bottomStorage, bottomRequested);
  return Object.freeze({
    topRemoved,
    bottomRemoved,
    removed: topRemoved + bottomRemoved,
    sourceShareUnderflowMm: Math.max(0, requested - topRemoved - bottomRemoved)
  });
}

export function biome4ConductanceControlledAet({
  equilibriumDemandMm,
  fractionalVegetationCover,
  maximumFractionalVegetationCover,
  optimumCanopyConductance,
  minimumCanopyConductance,
  rootZoneWetness,
  maximumDailyTranspirationMm,
  temperatureCelsius
}) {
  const deq = Math.max(0, Number(equilibriumDemandMm) || 0);
  const fvc = clamp(fractionalVegetationCover, 0, 1);
  const maxFvc = clamp(maximumFractionalVegetationCover, 0, 1);
  const rootWetness = clamp(rootZoneWetness, 0, 1);
  const emax = Math.max(0, Number(maximumDailyTranspirationMm) || 0);
  const temperature = Number(temperatureCelsius) || 0;

  if (temperature <= -10) {
    return Object.freeze({
      equilibriumDemandMm: deq,
      potentialAetMm: 0,
      supplyMm: emax * rootWetness,
      actualAetMm: 0,
      activeCanopy: false,
      leaflessLoss: false,
      supplyLimited: false,
      wilted: false,
      canopyConductance: 0,
      surfaceConductance: 0,
      sourceBacksolveSingularity: false
    });
  }

  let potentialAet;
  let canopyConductance = 0;
  let surfaceConductance = 0;
  const activeCanopy = fvc > 0 && maxFvc > 0;
  if (!activeCanopy) {
    potentialAet = 0.25 * deq;
  } else {
    const gmin = Math.max(0, Number(minimumCanopyConductance) || 0) * fvc;
    canopyConductance = Math.max(0, Number(optimumCanopyConductance) || 0) * (fvc / maxFvc);
    surfaceConductance = canopyConductance + gmin;
    const alpha = surfaceConductance > 0
      ? BIOME4_MAXIMUM_PRIESTLEY_TAYLOR_ALPHA * (1 - Math.exp(-surfaceConductance / BIOME4_CONDUCTANCE_SCALE_MM_S))
      : 0;
    potentialAet = alpha * deq;
  }

  const supply = emax * rootWetness;
  const sourceDemandForSupplyTest = potentialAet * 1.02;
  const supplyLimited = sourceDemandForSupplyTest > supply;
  let actualAet = potentialAet;
  let wilted = false;
  let sourceBacksolveSingularity = false;

  if (supplyLimited) {
    actualAet = supply;
    if (activeCanopy) {
      const gmin = Math.max(0, Number(minimumCanopyConductance) || 0) * fvc;
      if (deq > 0) {
        let a = 1 - supply / (deq * BIOME4_MAXIMUM_PRIESTLEY_TAYLOR_ALPHA);
        if (a < 0) a = 0;
        if (a === 0) {
          sourceBacksolveSingularity = true;
          canopyConductance = null;
          surfaceConductance = null;
        } else {
          surfaceConductance = -BIOME4_CONDUCTANCE_SCALE_MM_S * Math.log(a);
          canopyConductance = surfaceConductance - gmin;
          if (canopyConductance <= 0) {
            canopyConductance = 0;
            wilted = true;
          }
        }
      } else {
        canopyConductance = 0;
        surfaceConductance = gmin;
      }
    }
  }

  return Object.freeze({
    equilibriumDemandMm: deq,
    potentialAetMm: potentialAet,
    sourceDemandForSupplyTestMm: sourceDemandForSupplyTest,
    supplyMm: supply,
    actualAetMm: actualAet,
    activeCanopy,
    leaflessLoss: !activeCanopy && potentialAet > 0,
    supplyLimited,
    wilted,
    canopyConductance,
    surfaceConductance,
    sourceBacksolveSingularity
  });
}

export function runBiome4VirtualPftHydrologyTrial({
  pftId,
  lai,
  soilProfile,
  baselineDailyWaterTrace,
  phenologyDaily,
  latitude,
  monthlyTemperatureCelsius,
  monthlyCloudCoverPercent,
  monthlyPrecipitationMmPerYear,
  elevationMeters = 0,
  co2Ppm = 245
}) {
  const pft = pftById(pftId);
  const soil = normalizeSoil(soilProfile);
  const referenceTrace = requireDailyTrace(baselineDailyWaterTrace);
  if (!Array.isArray(phenologyDaily) || phenologyDaily.length !== 365) {
    throw new TypeError("Virtual PFT hydrology requires 365 PFT phenology/water diagnostic days.");
  }
  const monthlyTemperature = requireMonthly(monthlyTemperatureCelsius, "Virtual PFT hydrology temperature");
  const monthlyCloud = requireMonthly(monthlyCloudCoverPercent, "Virtual PFT hydrology cloud");
  const monthlyPrecipitation = requireMonthly(monthlyPrecipitationMmPerYear, "Virtual PFT hydrology precipitation");
  const atmosphere = biome4AtmosphericEquilibriumDemand({
    latitude,
    monthlyTemperatureCelsius: monthlyTemperature,
    monthlyCloudCoverPercent: monthlyCloud
  });
  const snow = biome4DailySnowWaterForcing(monthlyTemperature, monthlyPrecipitation);
  const pressurePa = atmosphericPressureKPa(elevationMeters) * 1000;
  const maximumFvc = biome4FvcFromLai(pft.id, lai);
  const monthlyOptimumConductance = monthlyTemperature.map((temperatureCelsius, monthIndex) =>
    biome4OptimumCanopyConductance({
      pftId: pft.id,
      lai,
      incomingSolarJm2Day: atmosphere.monthlyIncomingSolarJm2Day[monthIndex],
      effectiveDaylengthHours: atmosphere.monthlyEffectiveDaylengthHours[monthIndex],
      temperatureCelsius,
      pressurePa,
      co2Ppm
    }).optimumConductance
  );
  const dailyOptimumConductance = biome4DailyMidmonthInterpolation(monthlyOptimumConductance);

  let topStorage = clamp(Number(referenceTrace[0].startTopStorageMm), 0, soil.topCapacityMm);
  let bottomStorage = clamp(Number(referenceTrace[0].startBottomStorageMm), 0, soil.bottomCapacityMm);
  const startTopStorage = topStorage;
  const startBottomStorage = bottomStorage;
  let actualAet = 0;
  let activeCanopyAet = 0;
  let leaflessAet = 0;
  let surfaceRunoff = 0;
  let lowerLayerDrainage = 0;
  let potentialAet = 0;
  let supplyLimitedDays = 0;
  let wiltedDays = 0;
  let sourceShareUnderflow = 0;
  let sourceBacksolveSingularityDays = 0;
  let conductanceSum = 0;
  let conductanceDays = 0;
  const daily = [];

  for (let index = 0; index < 365; index += 1) {
    const pftDay = phenologyDaily[index];
    const snowDay = snow.daily[index];
    const temperature = atmosphere.dailyTemperatureCelsius[index];
    const deq = atmosphere.dailyEquilibriumDemandMm[index];
    const leafFraction = clamp(Number(pftDay?.leafFraction), 0, 1);
    const fvc = maximumFvc * leafFraction;
    const startTop = topStorage;
    const startBottom = bottomStorage;
    const topWetness = soil.topCapacityMm > 0 ? clamp(topStorage / soil.topCapacityMm, 0, 1) : 0;
    const bottomWetness = soil.bottomCapacityMm > 0 ? clamp(bottomStorage / soil.bottomCapacityMm, 0, 1) : 0;
    const root = biome4RootZoneWaterState(pft, topWetness, bottomWetness);
    const flux = biome4ConductanceControlledAet({
      equilibriumDemandMm: deq,
      fractionalVegetationCover: fvc,
      maximumFractionalVegetationCover: maximumFvc,
      optimumCanopyConductance: dailyOptimumConductance[index],
      minimumCanopyConductance: pft.parameters.minimumCanopyConductance,
      rootZoneWetness: root.effectiveRootZoneWetness,
      maximumDailyTranspirationMm: pft.parameters.maximumDailyTranspiration,
      temperatureCelsius: temperature
    });

    let dayPercolation = 0;
    let dayAet = 0;
    let extraction = { topRemoved: 0, bottomRemoved: 0, removed: 0, sourceShareUnderflowMm: 0 };
    let daySurfaceRunoff = 0;
    let dayDrainage = 0;

    // BIOME4's executable skips the soil-accounting block at <= -10 C. The
    // degree-day snow driver simultaneously gives no liquid precipitation or
    // melt there, so water remains in the explicit snow store.
    if (temperature > -10) {
      dayPercolation = sourceUpperPercolation(topStorage, soil.topCapacityMm, soil.topPercolationCoefficient);
      extraction = extractAetBySourceRootShares(topStorage, bottomStorage, flux.actualAetMm, root);
      dayAet = extraction.removed;
      topStorage += snowDay.soilWaterInputMm - dayPercolation - extraction.topRemoved;
      bottomStorage += dayPercolation - extraction.bottomRemoved;

      if (bottomStorage >= soil.bottomCapacityMm) {
        dayDrainage = Math.max(0, bottomStorage - soil.bottomCapacityMm);
        bottomStorage = soil.bottomCapacityMm;
      }
      if (topStorage >= soil.topCapacityMm) {
        daySurfaceRunoff = Math.max(0, topStorage - soil.topCapacityMm);
        topStorage = soil.topCapacityMm;
      }
      if (topStorage <= 0) topStorage = 0;
      if (bottomStorage <= 0) bottomStorage = 0;
    }

    actualAet += dayAet;
    potentialAet += flux.potentialAetMm;
    if (flux.activeCanopy) activeCanopyAet += dayAet;
    else leaflessAet += dayAet;
    surfaceRunoff += daySurfaceRunoff;
    lowerLayerDrainage += dayDrainage;
    sourceShareUnderflow += extraction.sourceShareUnderflowMm;
    if (flux.supplyLimited) supplyLimitedDays += 1;
    if (flux.wilted) wiltedDays += 1;
    if (flux.sourceBacksolveSingularity) sourceBacksolveSingularityDays += 1;
    if (Number.isFinite(flux.canopyConductance)) {
      conductanceSum += flux.canopyConductance;
      conductanceDays += 1;
    }

    daily.push(Object.freeze({
      dayOfYear: index + 1,
      temperatureCelsius: round(temperature, 4),
      leafFraction: round(leafFraction),
      fractionalVegetationCover: round(fvc),
      rawPrecipitationMm: round(snowDay.rawPrecipitationMm),
      snowfallMm: round(snowDay.snowfallMm),
      liquidPrecipitationMm: round(snowDay.liquidPrecipitationMm),
      snowMeltMm: round(snowDay.snowMeltMm),
      equilibriumDemandMm: round(deq),
      potentialAetMm: round(flux.potentialAetMm),
      actualAetMm: round(dayAet),
      supplyMm: round(flux.supplyMm),
      supplyLimited: flux.supplyLimited,
      wilted: flux.wilted,
      canopyConductance: Number.isFinite(flux.canopyConductance) ? round(flux.canopyConductance) : null,
      rootZoneWetness: round(root.effectiveRootZoneWetness),
      upperPercolationMm: round(dayPercolation),
      startTopStorageMm: round(startTop),
      endTopStorageMm: round(topStorage),
      startBottomStorageMm: round(startBottom),
      endBottomStorageMm: round(bottomStorage),
      surfaceRunoffMm: round(daySurfaceRunoff),
      lowerLayerDrainageMm: round(dayDrainage)
    }));
  }

  const startStorage = startTopStorage + startBottomStorage;
  const endStorage = topStorage + bottomStorage;
  const soilStorageChange = endStorage - startStorage;
  const runoff = surfaceRunoff + lowerLayerDrainage;
  const residual = snow.rawPrecipitationMmPerYear - actualAet - runoff - soilStorageChange - snow.snowStorageChangeMm;
  const unmetAet = Math.max(0, potentialAet - actualAet);

  return Object.freeze({
    policy: BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY,
    pftId: pft.id,
    pftCode: pft.code,
    pftName: pft.name,
    lai: Math.max(0, Number(lai) || 0),
    fractionalVegetationCover: round(maximumFvc),
    startStorageMm: round(startStorage),
    endStorageMm: round(endStorage),
    storageChangeMm: round(soilStorageChange),
    startSnowpackMm: round(snow.startSnowpackMm),
    endSnowpackMm: round(snow.endSnowpackMm),
    snowStorageChangeMm: round(snow.snowStorageChangeMm),
    precipitationMmPerYear: round(snow.rawPrecipitationMmPerYear),
    liquidPrecipitationMmPerYear: round(snow.liquidPrecipitationMmPerYear),
    snowMeltMmPerYear: round(snow.snowMeltMmPerYear),
    equilibriumDemandMmPerYear: round(atmosphere.annualEquilibriumDemandMm),
    atmosphericPetMmPerYear: round(atmosphere.annualEquilibriumDemandMm),
    potentialAetMmPerYear: round(potentialAet),
    actualEvapotranspirationMmPerYear: round(actualAet),
    activeCanopyAetMmPerYear: round(activeCanopyAet),
    leaflessAetMmPerYear: round(leaflessAet),
    transpirationMmPerYear: round(activeCanopyAet),
    soilEvaporationMmPerYear: round(leaflessAet),
    unmetTranspirationDemandMmPerYear: round(unmetAet),
    surfaceRunoffMmPerYear: round(surfaceRunoff),
    deepDrainageMmPerYear: round(lowerLayerDrainage),
    lowerLayerDrainageMmPerYear: round(lowerLayerDrainage),
    runoffMmPerYear: round(runoff),
    massBalanceResidualMm: round(residual, 9),
    supplyLimitedDays,
    wiltedDays,
    sourceBacksolveSingularityDays,
    sourceShareUnderflowMm: round(sourceShareUnderflow),
    meanCanopyConductance: conductanceDays > 0 ? round(conductanceSum / conductanceDays) : 0,
    monthlyOptimumConductance: Object.freeze(monthlyOptimumConductance.map((value) => round(value))),
    pressurePa: round(pressurePa, 2),
    pressurePolicy: "Earth 777 FAO elevation-pressure approximation; BIOME4 accepts pressure as an external input and its original pressure-forcing preparation is not yet pinned",
    bottomPercolationParameterUsed: false,
    bottomPercolationNote: "BIOME4 4.1 assigns k(2) but the audited hydrology routine does not use it; lower-layer drainage occurs on capacity overflow.",
    waterStressFraction: round(potentialAet > 0 ? unmetAet / potentialAet : 0),
    sharedHydrologyMutated: false,
    daily: Object.freeze(daily),
    epistemicStatus: "parallel model-derived candidate hydrology using independently reproduced BIOME4 4.1 ppeett equilibrium demand, source canopy-conductance saturation, Emax/root-water supply limitation, degree-day snow forcing, and source upper-layer percolation/overflow drainage. The candidate cannot alter shared Earth hydrology or select occupancy. Earth 777's elevation-pressure approximation supplies photosynthetic conductance because BIOME4 pressure is externally supplied; no humidity/VPD field is required by this BIOME4 operational path."
  });
}
