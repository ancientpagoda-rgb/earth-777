import { BIOME4_PFTS } from "./Biome4PftEligibility.js";
import { biome4FvcFromLai } from "./Biome4PftPhotosynthesis.js";
import { biome4RootZoneWaterState } from "./Biome4PftWaterPhenology.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 6) => Number(value.toFixed(digits));

export const BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY = "biome4-parallel-pft-water-trial-v1";

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

function percolation(storage, capacity, coefficient) {
  if (storage <= 0 || capacity <= 0 || coefficient <= 0) return 0;
  const wetness = clamp(storage / capacity, 0, 1);
  return Math.min(storage, coefficient * wetness ** 4);
}

function removeByRootShares(topStorage, bottomStorage, amount, topShare, bottomShare) {
  const demand = Math.max(0, amount);
  let topDemand = demand * clamp(topShare, 0, 1);
  let bottomDemand = demand * clamp(bottomShare, 0, 1);
  let topRemoved = Math.min(topStorage, topDemand);
  let bottomRemoved = Math.min(bottomStorage, bottomDemand);
  let remaining = demand - topRemoved - bottomRemoved;

  // If one rooted layer cannot satisfy its nominal share, allow the other
  // rooted layer to supply the remainder. This preserves the PFT root-zone
  // accessibility constraint without discarding available rooted water.
  if (remaining > 0) {
    const extraTop = Math.min(Math.max(0, topStorage - topRemoved), remaining);
    topRemoved += extraTop;
    remaining -= extraTop;
  }
  if (remaining > 0) {
    const extraBottom = Math.min(Math.max(0, bottomStorage - bottomRemoved), remaining);
    bottomRemoved += extraBottom;
  }
  return {
    topStorage: topStorage - topRemoved,
    bottomStorage: bottomStorage - bottomRemoved,
    removed: topRemoved + bottomRemoved
  };
}

function requireDailyTrace(trace) {
  if (!Array.isArray(trace) || trace.length !== 365) {
    throw new TypeError("Virtual PFT hydrology requires a 365-day conserved hydrology trace.");
  }
  for (const day of trace) {
    if (!Number.isFinite(Number(day?.precipitationMm)) || !Number.isFinite(Number(day?.potentialEvapotranspirationMm))) {
      throw new TypeError("Virtual PFT hydrology daily trace requires finite precipitation and PET.");
    }
  }
  return trace;
}

export function runBiome4VirtualPftHydrologyTrial({
  pftId,
  lai,
  soilProfile,
  baselineDailyWaterTrace,
  phenologyDaily
}) {
  const pft = pftById(pftId);
  const soil = normalizeSoil(soilProfile);
  const forcing = requireDailyTrace(baselineDailyWaterTrace);
  if (!Array.isArray(phenologyDaily) || phenologyDaily.length !== 365) {
    throw new TypeError("Virtual PFT hydrology requires 365 PFT phenology/water diagnostic days.");
  }

  let topStorage = clamp(Number(forcing[0]?.startTopStorageMm), 0, soil.topCapacityMm);
  let bottomStorage = clamp(Number(forcing[0]?.startBottomStorageMm), 0, soil.bottomCapacityMm);
  const startTopStorage = topStorage;
  const startBottomStorage = bottomStorage;
  const fvc = biome4FvcFromLai(pft.id, lai);

  let precipitation = 0;
  let soilEvaporation = 0;
  let transpiration = 0;
  let surfaceRunoff = 0;
  let deepDrainage = 0;
  let unmetTranspirationDemand = 0;
  let greenDayTranspiration = 0;
  const daily = [];

  for (let index = 0; index < 365; index += 1) {
    const forcingDay = forcing[index];
    const pftDay = phenologyDaily[index];
    const rain = Math.max(0, Number(forcingDay.precipitationMm) || 0);
    const pet = Math.max(0, Number(forcingDay.potentialEvapotranspirationMm) || 0);
    const leafFraction = clamp(Number(pftDay?.leafFraction), 0, 1);
    const activeCanopyFraction = clamp(fvc * leafFraction, 0, 1);
    const startTop = topStorage;
    const startBottom = bottomStorage;

    topStorage += rain;

    // Bare/under-canopy evaporation is the non-active-canopy share of the
    // atmospheric PET budget. The remainder is available to the PFT as a
    // transpiration opportunity but is also capped by the BIOME4 PFT Emax and
    // dynamically available root-zone water.
    const soilEvapDemand = pet * (1 - activeCanopyFraction);
    const evaporated = Math.min(topStorage, soilEvapDemand);
    topStorage -= evaporated;

    const topWetness = soil.topCapacityMm > 0 ? clamp(topStorage / soil.topCapacityMm, 0, 1) : 0;
    const bottomWetness = soil.bottomCapacityMm > 0 ? clamp(bottomStorage / soil.bottomCapacityMm, 0, 1) : 0;
    const root = biome4RootZoneWaterState(pft, topWetness, bottomWetness);
    const atmosphericCanopyDemand = pet * activeCanopyFraction;
    const pftMaximumDemand = pft.parameters.maximumDailyTranspiration * leafFraction;
    const potentialTranspiration = Math.min(atmosphericCanopyDemand, pftMaximumDemand);
    const waterLimitedDemand = Math.min(potentialTranspiration, root.waterSupplyCapacityMmPerDay);
    const extraction = removeByRootShares(
      topStorage,
      bottomStorage,
      waterLimitedDemand,
      root.topExtractionShare,
      root.bottomExtractionShare
    );
    topStorage = extraction.topStorage;
    bottomStorage = extraction.bottomStorage;

    // Preserve Earth 777's BIOME4-compatible soil transfer semantics exactly:
    // top overflow infiltrates first, k*wetness^4 percolates once per day,
    // lower-layer overflow is routed runoff, then bottom percolation is deep
    // drainage. Deep drainage remains immediate routed water in the parent
    // hydrology until groundwater/baseflow is implemented.
    if (topStorage > soil.topCapacityMm) {
      bottomStorage += topStorage - soil.topCapacityMm;
      topStorage = soil.topCapacityMm;
    }
    const topPercolation = percolation(topStorage, soil.topCapacityMm, soil.topPercolationCoefficient);
    topStorage -= topPercolation;
    bottomStorage += topPercolation;

    let daySurfaceRunoff = 0;
    if (bottomStorage > soil.bottomCapacityMm) {
      daySurfaceRunoff = bottomStorage - soil.bottomCapacityMm;
      bottomStorage = soil.bottomCapacityMm;
    }
    const dayDeepDrainage = percolation(bottomStorage, soil.bottomCapacityMm, soil.bottomPercolationCoefficient);
    bottomStorage -= dayDeepDrainage;

    const unmet = Math.max(0, potentialTranspiration - extraction.removed);
    precipitation += rain;
    soilEvaporation += evaporated;
    transpiration += extraction.removed;
    surfaceRunoff += daySurfaceRunoff;
    deepDrainage += dayDeepDrainage;
    unmetTranspirationDemand += unmet;
    if (leafFraction > 0) greenDayTranspiration += extraction.removed;

    daily.push(Object.freeze({
      dayOfYear: index + 1,
      leafFraction: round(leafFraction),
      activeCanopyFraction: round(activeCanopyFraction),
      precipitationMm: round(rain),
      potentialEvapotranspirationMm: round(pet),
      soilEvaporationMm: round(evaporated),
      potentialTranspirationMm: round(potentialTranspiration),
      actualTranspirationMm: round(extraction.removed),
      unmetTranspirationDemandMm: round(unmet),
      rootZoneWetness: round(root.effectiveRootZoneWetness),
      startTopStorageMm: round(startTop),
      endTopStorageMm: round(topStorage),
      startBottomStorageMm: round(startBottom),
      endBottomStorageMm: round(bottomStorage),
      surfaceRunoffMm: round(daySurfaceRunoff),
      deepDrainageMm: round(dayDeepDrainage)
    }));
  }

  const startStorage = startTopStorage + startBottomStorage;
  const endStorage = topStorage + bottomStorage;
  const storageChange = endStorage - startStorage;
  const runoff = surfaceRunoff + deepDrainage;
  const residual = precipitation - soilEvaporation - transpiration - runoff - storageChange;
  const atmosphericDemand = forcing.reduce((sum, day) => sum + Math.max(0, Number(day.potentialEvapotranspirationMm) || 0), 0);

  return Object.freeze({
    policy: BIOME4_VIRTUAL_PFT_HYDROLOGY_POLICY,
    pftId: pft.id,
    pftCode: pft.code,
    pftName: pft.name,
    lai: Math.max(0, Number(lai) || 0),
    fractionalVegetationCover: round(fvc),
    startStorageMm: round(startStorage),
    endStorageMm: round(endStorage),
    storageChangeMm: round(storageChange),
    precipitationMmPerYear: round(precipitation),
    atmosphericPetMmPerYear: round(atmosphericDemand),
    soilEvaporationMmPerYear: round(soilEvaporation),
    transpirationMmPerYear: round(transpiration),
    greenDayTranspirationMmPerYear: round(greenDayTranspiration),
    unmetTranspirationDemandMmPerYear: round(unmetTranspirationDemand),
    surfaceRunoffMmPerYear: round(surfaceRunoff),
    deepDrainageMmPerYear: round(deepDrainage),
    runoffMmPerYear: round(runoff),
    massBalanceResidualMm: round(residual, 9),
    waterStressFraction: round(transpiration + unmetTranspirationDemand > 0
      ? unmetTranspirationDemand / (transpiration + unmetTranspirationDemand)
      : 0),
    sharedHydrologyMutated: false,
    daily: Object.freeze(daily),
    epistemicStatus: "parallel model-derived PFT water trial using BIOME4 PFT canopy/root/Emax parameters and Earth 777's conserved BIOME4-soil forcing; the trial does not alter shared hydrology or choose the occupying PFT, and canopy conductance is not yet converted to water flux because paleoclimate vapor-pressure/humidity forcing is not integrated"
  });
}
