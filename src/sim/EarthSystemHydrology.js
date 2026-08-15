import { MassConservingHydrology } from "./MassConservingHydrology.js";
import { closeAnnualWaterBalance } from "./WaterBalance.js";
import { dynamicSurfaceElevationMeters } from "./GeneralAtmosphereCirculation.js";
import { evolveRunoffNetworkTopography, DYNAMIC_GEOMORPHOLOGY_POLICY } from "./DynamicGeomorphology.js";
import {
  resolveGroundwaterBaseflow,
  resolveClosedBasinLakes,
  GROUNDWATER_POLICY,
  CLOSED_BASIN_LAKE_POLICY
} from "./GroundwaterLakes.js";
import { gridSpacingForSpatialDetail } from "./SpatialHydroClimate.js";
import { networkCellAt, networkSpacingForSpatialDetail } from "./RunoffRouting.js";

const round = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits));
const quantize = (value, step) => Math.round((Number(value) || 0) / step) * step;
const COUPLED_METHODS = Object.freeze([
  "_stateSignature",
  "_networkForcingState",
  "_networkSignature",
  "_routingElevationAt",
  "_routingTopologySignature",
  "_refineNetworkTopology",
  "_balanceFor",
  "groundwaterLakeSample"
]);

export const EARTH_SYSTEM_HYDROLOGY_POLICY = "dynamic-topography-atmosphere-groundwater-lakes-geomorphology-hydrology-v3";

export class EarthSystemHydrology extends MassConservingHydrology {
  _stateSignature(globalState, spatialDetail) {
    return [
      gridSpacingForSpatialDetail(spatialDetail),
      round(globalState.temperatureAnomaly, 3),
      round(globalState.oceanTemperatureAnomaly ?? globalState.temperatureAnomaly, 3),
      round(globalState.iceIndex, 4),
      round(globalState.eccentricity, 6),
      round(globalState.obliquity, 4),
      round(globalState.precession, 2),
      round(globalState.seaLevel, 1),
      round(globalState.tectonicTimeMyr, 5),
      round(globalState.tectonicBoundaryActivity ?? 1, 3),
      round(globalState.productivityIndex ?? 1, 3),
      this.soil?.meta?.assetSha256 ?? "fallback-soil"
    ].join("|");
  }

  _networkForcingState(globalState) {
    const elapsedYears = quantize(globalState.elapsedYears ?? 0, 2500);
    return Object.freeze({
      ...globalState,
      elapsedYears,
      yearBP: Math.max(0, 777_000 - elapsedYears),
      temperatureAnomaly: quantize(globalState.temperatureAnomaly, 0.1),
      oceanTemperatureAnomaly: quantize(globalState.oceanTemperatureAnomaly ?? globalState.temperatureAnomaly, 0.1),
      iceIndex: quantize(globalState.iceIndex, 0.01),
      eccentricity: quantize(globalState.eccentricity, 0.0005),
      obliquity: quantize(globalState.obliquity, 0.05),
      precession: quantize(globalState.precession, 2),
      seaLevel: quantize(globalState.seaLevel, 2),
      tectonicTimeMyr: elapsedYears / 1_000_000,
      tectonicBoundaryActivity: quantize(globalState.tectonicBoundaryActivity ?? 1, 0.05),
      productivityIndex: quantize(globalState.productivityIndex ?? 1, 0.05)
    });
  }

  _networkSignature(globalState, spatialDetail) {
    const forcing = this._networkForcingState(globalState);
    return [
      networkSpacingForSpatialDetail(spatialDetail),
      round(forcing.temperatureAnomaly, 1),
      round(forcing.oceanTemperatureAnomaly, 1),
      round(forcing.iceIndex, 2),
      round(forcing.eccentricity, 4),
      round(forcing.obliquity, 2),
      round(forcing.precession, 0),
      round(forcing.seaLevel, 0),
      round(forcing.elapsedYears / 1000, 0),
      round(forcing.tectonicTimeMyr, 3),
      round(forcing.tectonicBoundaryActivity, 2),
      round(forcing.productivityIndex, 2),
      this.soil?.meta?.assetSha256 ?? "fallback-soil"
    ].join("|");
  }

  _routingElevationAt(globalState, latitude, longitude) {
    return dynamicSurfaceElevationMeters(globalState, latitude, longitude);
  }

  _routingTopologySignature(globalState) {
    return [
      "dynamic-tectonic-surface",
      round(globalState.tectonicTimeMyr ?? 0, 4),
      round(globalState.tectonicBoundaryActivity ?? 1, 2),
      Number(globalState.tectonicSeed ?? globalState.seed ?? 777001) >>> 0
    ].join(":");
  }

  _refineNetworkTopology(globalState, topology, localRunoffMmPerYear, climateForcedMask) {
    const count = topology.count;
    const surfaceRunoffMmPerYear = new Float32Array(count);
    const deepDrainageMmPerYear = new Float32Array(count);
    const precipitationMmPerYear = new Float32Array(count);
    const potentialEvapotranspirationMmPerYear = new Float32Array(count);
    const precipitationScale = new Float32Array(count);
    const soilWaterCapacityMm = new Float32Array(count);
    const networkClimateDetail = topology.spacingDegrees === 2 ? 0.35 : 0.1;

    // These samples are already materialized by MassConservingHydrology.network()
    // for the same forcing state, so this pass normally hits the deterministic
    // water-balance cache rather than recomputing climate.
    for (const index of topology.routingOrder) {
      const row = Math.floor(index / topology.cols);
      const col = index % topology.cols;
      const latitude = 90 - (row + 0.5) * topology.spacingDegrees;
      const longitude = -180 + (col + 0.5) * topology.spacingDegrees;
      const local = this.sample(globalState, latitude, longitude, networkClimateDetail);
      if (!local) continue;
      surfaceRunoffMmPerYear[index] = Math.max(0, Number(local.surfaceRunoffMmPerYear) || 0);
      deepDrainageMmPerYear[index] = Math.max(0, Number(local.deepDrainageMmPerYear) || 0);
      precipitationMmPerYear[index] = Math.max(0, Number(local.precipitationMmPerYear) || 0);
      potentialEvapotranspirationMmPerYear[index] = Math.max(0, Number(local.potentialEvapotranspirationMmPerYear) || 0);
      precipitationScale[index] = Math.max(0.12, Number(local.precipitationScale) || 1);
      soilWaterCapacityMm[index] = Math.max(40, Number(local.soilWaterCapacityMm) || 260);
    }

    const groundwater = resolveGroundwaterBaseflow(globalState, topology, {
      totalRunoffMmPerYear: localRunoffMmPerYear,
      surfaceRunoffMmPerYear,
      deepDrainageMmPerYear,
      precipitationScale,
      soilWaterCapacityMm
    });
    localRunoffMmPerYear.set(groundwater.effectiveRunoffMmPerYear);

    // Groundwater-adjusted discharge drives the same erosion/sediment model,
    // so slower subsurface routing can causally change landscape evolution.
    const geomorphology = evolveRunoffNetworkTopography(
      globalState,
      topology,
      localRunoffMmPerYear,
      climateForcedMask
    );

    const lakes = resolveClosedBasinLakes(globalState, geomorphology.topology, localRunoffMmPerYear, {
      precipitationMmPerYear,
      potentialEvapotranspirationMmPerYear
    });
    localRunoffMmPerYear.set(lakes.adjustedRunoffMmPerYear);

    const waterSystemClosureErrorM3PerYear = groundwater.landWaterInputM3PerYear
      - groundwater.groundwaterStorageChangeM3PerYear
      - lakes.lakeEvaporationM3PerYear
      - lakes.adjustedLocalRunoffM3PerYear;
    const waterSystemRelativeClosureError = groundwater.landWaterInputM3PerYear > 0
      ? waterSystemClosureErrorM3PerYear / groundwater.landWaterInputM3PerYear
      : 0;

    return Object.freeze({
      ...geomorphology,
      topology: lakes.topology,
      geomorphicTopology: geomorphology.topology,
      groundwater,
      lakes,
      waterSystemClosureErrorM3PerYear,
      waterSystemRelativeClosureError,
      // Routed depths are intentionally Float32 at browser scale. A 2 ppm
      // closure tolerance is tighter than the transport field's accumulated
      // numerical precision while still exposing physically meaningful leaks.
      waterSystemMassConserved: Math.abs(waterSystemClosureErrorM3PerYear) <= Math.max(1e-3, groundwater.landWaterInputM3PerYear * 2e-6),
      epistemicStatus: `${geomorphology.epistemicStatus}; deep drainage is delayed through a coarse groundwater reservoir before contributing baseflow, and closed geomorphic basins resolve lake area/storage/evaporation plus spill-saddle capture without geographic special cases`
    });
  }

  groundwaterLakeSample(globalState, latitude, longitude, spatialDetail = 0.35) {
    const network = this.network(globalState, spatialDetail);
    const refinement = network.geomorphology;
    if (!refinement?.groundwater || !refinement?.lakes) return null;
    const cell = networkCellAt(network.topology, latitude, longitude);
    if (!network.topology.landMask[cell.index] && refinement.lakes.lakeIdByCell[cell.index] < 0) return null;
    const groundwater = refinement.groundwater;
    const lakes = refinement.lakes;
    const lakeId = lakes.lakeIdByCell[cell.index];
    const lake = lakeId >= 0 ? lakes.lakes.find((candidate) => candidate.sinkIndex === lakeId) ?? null : null;
    return Object.freeze({
      policy: EARTH_SYSTEM_HYDROLOGY_POLICY,
      groundwaterPolicy: groundwater.policy,
      lakePolicy: lakes.policy,
      latitude: cell.latitude,
      longitude: cell.longitude,
      spacingDegrees: network.spacingDegrees,
      baseflowMmPerYear: groundwater.baseflowMmPerYear[cell.index],
      baseflowFraction: groundwater.baseflowFraction[cell.index],
      groundwaterStorageChangeMmPerYear: groundwater.groundwaterStorageChangeMmPerYear[cell.index],
      groundwaterResidenceTimeYears: groundwater.residenceTimeYears[cell.index],
      groundwaterMassConserved: groundwater.massConserved,
      groundwaterRelativeClosureError: groundwater.relativeClosureError,
      lakeId,
      lakeCoverageFraction: lakes.lakeCoverageFractionByCell[cell.index],
      lakeSurfaceElevationMeters: Number.isFinite(lakes.lakeSurfaceElevationMetersByCell[cell.index])
        ? lakes.lakeSurfaceElevationMetersByCell[cell.index]
        : null,
      lakeDepthMeters: lakes.lakeDepthMetersByCell[cell.index],
      lakeAreaKm2: lake?.lakeAreaKm2 ?? null,
      lakeStorageM3: lake?.storageM3 ?? null,
      lakeInflowM3PerYear: lake?.inflowM3PerYear ?? null,
      lakeEvaporationM3PerYear: lake?.evaporationM3PerYear ?? null,
      lakeOverflowM3PerYear: lake?.overflowM3PerYear ?? null,
      lakeFillFraction: lake?.fillFraction ?? null,
      lakeSpilling: lake?.spilling ?? false,
      spillingLakeCount: lakes.spillingLakeCount,
      closedLakeCount: lakes.closedLakeCount,
      totalLakeAreaKm2: lakes.totalLakeAreaKm2,
      waterSystemMassConserved: refinement.waterSystemMassConserved,
      waterSystemRelativeClosureError: refinement.waterSystemRelativeClosureError,
      epistemicStatus: "coarse Earth-system groundwater/lake sample from the same deterministic network that drives river discharge and geomorphic response"
    });
  }

  _balanceFor(globalState, climate, spatialDetail, includeDailyTrace = false) {
    const monthlyClimate = Array.from({ length: 12 }, (_, monthIndex) =>
      this.climate.monthlyAt(globalState, monthIndex, climate.latitude, climate.longitude, spatialDetail)
    );
    if (monthlyClimate.some((month) => !month)) return null;
    const elevationMeters = dynamicSurfaceElevationMeters(globalState, climate.latitude, climate.longitude);
    const soilProfile = this._soilProfile(climate.latitude, climate.longitude);
    const balance = closeAnnualWaterBalance(monthlyClimate, {
      latitude: climate.latitude,
      elevationMeters,
      soilProfile: soilProfile?.validSoil ? soilProfile : null,
      includeDailyTrace
    });
    return { elevationMeters, soilProfile, balance, monthlyClimate };
  }

  diagnostics(globalState, spatialDetail = 0.35) {
    const base = super.diagnostics(globalState, spatialDetail);
    return Object.freeze({
      ...base,
      policy: EARTH_SYSTEM_HYDROLOGY_POLICY,
      parentPolicy: base.policy,
      dynamicTopographyInLocalWaterBalance: true,
      generalAtmosphereForcing: true,
      routingTopographyState: "preliminary routing uses evolving tectonic elevation; recharge is delayed through groundwater/baseflow; conserved discharge then drives geomorphology; closed basins resolve lake water balance and spill capture",
      geomorphologyPolicy: DYNAMIC_GEOMORPHOLOGY_POLICY,
      groundwaterPolicy: GROUNDWATER_POLICY,
      lakePolicy: CLOSED_BASIN_LAKE_POLICY,
      waterAndSedimentClosureTrackedSeparately: true,
      epistemicStatus: `${base.epistemicStatus}; local elevation and cache invalidation are branch-coupled to atmosphere/orbit/tectonics, while coarse network hydrology now distinguishes surface runoff, aquifer storage/baseflow, lake retention/evaporation/spill, and runoff-driven geomorphology`
    });
  }
}

export function installEarthSystemHydrologyCoupling() {
  if (MassConservingHydrology.prototype.__earthSystemAtmosphereCoupled) return false;
  for (const method of COUPLED_METHODS) {
    Object.defineProperty(MassConservingHydrology.prototype, method, {
      configurable: true,
      writable: true,
      value: EarthSystemHydrology.prototype[method]
    });
  }
  Object.defineProperty(MassConservingHydrology.prototype, "__earthSystemAtmosphereCoupled", {
    configurable: false,
    writable: false,
    value: true
  });
  return true;
}