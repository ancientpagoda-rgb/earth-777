import { MassConservingHydrology } from "./MassConservingHydrology.js";
import { closeAnnualWaterBalance } from "./WaterBalance.js";
import { dynamicSurfaceElevationMeters } from "./GeneralAtmosphereCirculation.js";
import { evolveRunoffNetworkTopography, DYNAMIC_GEOMORPHOLOGY_POLICY } from "./DynamicGeomorphology.js";
import {
  evolveSoilProfile,
  soilEvolutionCellFields,
  DYNAMIC_SOIL_POLICY
} from "./DynamicSoilEvolution.js";
import {
  resolveGroundwaterBaseflow,
  resolveClosedBasinLakes,
  GROUNDWATER_POLICY,
  CLOSED_BASIN_LAKE_POLICY
} from "./GroundwaterLakes.js";
import { gridSpacingForSpatialDetail } from "./SpatialHydroClimate.js";
import { networkCellAt, networkSpacingForSpatialDetail } from "./RunoffRouting.js";

const KM_PER_DEGREE = 111.32;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits));
const quantize = (value, step) => Math.round((Number(value) || 0) / step) * step;
const wrapLongitudeDelta = (value) => ((Number(value) + 540) % 360) - 180;
const COUPLED_METHODS = Object.freeze([
  "_stateSignature",
  "_networkForcingState",
  "_networkSignature",
  "_routingElevationAt",
  "_routingTopologySignature",
  "_refineNetworkTopology",
  "_balanceFor",
  "groundwaterLakeSample",
  "soilEvolutionSample",
  "surfaceGeomorphologyPatch"
]);

export const EARTH_SYSTEM_HYDROLOGY_POLICY = "dynamic-topography-atmosphere-soil-groundwater-lakes-geomorphology-hydrology-v4";
export const SURFACE_GEOMORPHOLOGY_PATCH_POLICY = "coarse-geomorphology-to-local-surface-gradient-v1";

function topologyCell(topology, index) {
  const row = Math.floor(index / topology.cols);
  const col = index % topology.cols;
  return Object.freeze({
    index,
    row,
    col,
    latitude: 90 - (row + 0.5) * topology.spacingDegrees,
    longitude: -180 + (col + 0.5) * topology.spacingDegrees
  });
}

function topologyNeighborIndex(topology, row, col) {
  if (row < 0 || row >= topology.rows) return -1;
  const wrappedCol = ((col % topology.cols) + topology.cols) % topology.cols;
  return row * topology.cols + wrappedCol;
}

function localKmFrom(latitude, longitude, targetLatitude, targetLongitude) {
  const northKm = (Number(targetLatitude) - Number(latitude)) * KM_PER_DEGREE;
  const eastKm = wrapLongitudeDelta(Number(targetLongitude) - Number(longitude))
    * KM_PER_DEGREE
    * Math.max(0.12, Math.cos(Number(latitude) * Math.PI / 180));
  return { x: eastKm, z: northKm };
}

function closestPointToOriginOnSegment(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 1e-12 ? clamp(-(a.x * dx + a.z * dz) / lengthSquared, 0, 1) : 0;
  const x = a.x + dx * t;
  const z = a.z + dz * t;
  return { x, z, distanceKm: Math.hypot(x, z), t, dx, dz, lengthKm: Math.sqrt(lengthSquared) };
}

function monthlyClimateFor(hydrology, globalState, latitude, longitude, spatialDetail) {
  const months = Array.from({ length: 12 }, (_, monthIndex) =>
    hydrology.climate.monthlyAt(globalState, monthIndex, latitude, longitude, spatialDetail)
  );
  return months.some((month) => !month) ? null : months;
}

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
      this.soil?.meta?.assetSha256 ?? "fallback-soil",
      DYNAMIC_SOIL_POLICY
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
    const initialSurfaceRunoffMmPerYear = new Float32Array(count);
    const initialDeepDrainageMmPerYear = new Float32Array(count);
    const precipitationMmPerYear = new Float32Array(count);
    const potentialEvapotranspirationMmPerYear = new Float32Array(count);
    const precipitationScale = new Float32Array(count);
    const initialSoilWaterCapacityMm = new Float32Array(count);
    const localSamples = new Array(count);
    const networkClimateDetail = topology.spacingDegrees === 2 ? 0.35 : 0.1;

    for (const index of topology.routingOrder) {
      const row = Math.floor(index / topology.cols);
      const col = index % topology.cols;
      const latitude = 90 - (row + 0.5) * topology.spacingDegrees;
      const longitude = -180 + (col + 0.5) * topology.spacingDegrees;
      const local = this.sample(globalState, latitude, longitude, networkClimateDetail);
      localSamples[index] = local;
      if (!local) continue;
      initialSurfaceRunoffMmPerYear[index] = Math.max(0, Number(local.surfaceRunoffMmPerYear) || 0);
      initialDeepDrainageMmPerYear[index] = Math.max(0, Number(local.deepDrainageMmPerYear) || 0);
      precipitationMmPerYear[index] = Math.max(0, Number(local.precipitationMmPerYear) || 0);
      potentialEvapotranspirationMmPerYear[index] = Math.max(0, Number(local.potentialEvapotranspirationMmPerYear) || 0);
      precipitationScale[index] = Math.max(0.12, Number(local.precipitationScale) || 1);
      initialSoilWaterCapacityMm[index] = Math.max(40, Number(local.soilWaterCapacityMm) || 260);
    }

    // Pass 1: checkpoint/static soil produces a preliminary discharge and
    // geomorphic field. This field is the parent-material/erosion forcing for
    // pedogenesis; it is not the final branch river solution.
    const initialGroundwater = resolveGroundwaterBaseflow(globalState, topology, {
      totalRunoffMmPerYear: localRunoffMmPerYear,
      surfaceRunoffMmPerYear: initialSurfaceRunoffMmPerYear,
      deepDrainageMmPerYear: initialDeepDrainageMmPerYear,
      precipitationScale,
      soilWaterCapacityMm: initialSoilWaterCapacityMm
    });
    const preliminaryRunoffMmPerYear = new Float32Array(initialGroundwater.effectiveRunoffMmPerYear);
    const preliminaryGeomorphology = evolveRunoffNetworkTopography(
      globalState,
      topology,
      preliminaryRunoffMmPerYear,
      climateForcedMask
    );

    // Pass 2: climate/weathering + preliminary erosion/deposition evolve the
    // BIOME4 soil layers. The water balance is then recomputed once with those
    // evolved capacities/percolation values and the preliminary geomorphic
    // elevation offset. This fixed pass avoids recursive soil<->river solving.
    const soilFields = soilEvolutionCellFields(topology);
    const revisedSurfaceRunoffMmPerYear = new Float32Array(initialSurfaceRunoffMmPerYear);
    const revisedDeepDrainageMmPerYear = new Float32Array(initialDeepDrainageMmPerYear);
    const revisedTotalRunoffMmPerYear = new Float32Array(localRunoffMmPerYear);
    const revisedSoilWaterCapacityMm = new Float32Array(initialSoilWaterCapacityMm);
    let evolvedSoilCellCount = 0;
    let maxWaterBalanceResidualMm = 0;
    let maxCapacityMultiplierChange = 0;
    let meanFertilityAccumulator = 0;

    for (const index of topology.routingOrder) {
      const local = localSamples[index];
      if (!local) continue;
      const cell = topologyCell(topology, index);
      const baselineSoil = this._soilProfile(cell.latitude, cell.longitude);
      const evolvedSoil = evolveSoilProfile(globalState, baselineSoil, local, {
        erosionRateMmPerYear: preliminaryGeomorphology.erosionRateMmPerYear[index],
        depositionRateMmPerYear: preliminaryGeomorphology.depositionRateMmPerYear[index]
      });
      if (!evolvedSoil?.validSoil) continue;

      const months = monthlyClimateFor(this, globalState, local.latitude, local.longitude, networkClimateDetail);
      if (!months) continue;
      const elevationMeters = dynamicSurfaceElevationMeters(globalState, local.latitude, local.longitude)
        + (Number(preliminaryGeomorphology.netElevationOffsetMeters[index]) || 0);
      const balance = closeAnnualWaterBalance(months, {
        latitude: local.latitude,
        elevationMeters,
        soilProfile: evolvedSoil
      });

      revisedSurfaceRunoffMmPerYear[index] = Math.max(0, balance.surfaceRunoffMmPerYear);
      revisedDeepDrainageMmPerYear[index] = Math.max(0, balance.deepDrainageMmPerYear);
      revisedTotalRunoffMmPerYear[index] = Math.max(0, balance.runoffMmPerYear);
      revisedSoilWaterCapacityMm[index] = Math.max(1, balance.soilWaterCapacityMm);

      soilFields.appliedMask[index] = 1;
      soilFields.capacityMultiplier[index] = evolvedSoil.capacityMultiplier;
      soilFields.topWaterCapacityMm[index] = evolvedSoil.topWaterCapacityMm;
      soilFields.bottomWaterCapacityMm[index] = evolvedSoil.bottomWaterCapacityMm;
      soilFields.soilDepthMeters[index] = evolvedSoil.soilDepthMeters;
      soilFields.fertilityIndex[index] = evolvedSoil.fertilityIndex;
      soilFields.soilProductionMmPerYear[index] = evolvedSoil.soilProductionMmPerYear;
      soilFields.erosionLossMmPerYear[index] = evolvedSoil.erosionLossMmPerYear;
      soilFields.depositionGainMmPerYear[index] = evolvedSoil.depositionGainMmPerYear;
      evolvedSoilCellCount += 1;
      meanFertilityAccumulator += evolvedSoil.fertilityIndex;
      maxCapacityMultiplierChange = Math.max(maxCapacityMultiplierChange, Math.abs(evolvedSoil.capacityMultiplier - 1));
      maxWaterBalanceResidualMm = Math.max(maxWaterBalanceResidualMm, Math.abs(Number(balance.massBalanceResidualMm) || 0));
    }

    const soilEvolution = Object.freeze({
      policy: DYNAMIC_SOIL_POLICY,
      ...soilFields,
      evolvedSoilCellCount,
      evolvedSoilFraction: topology.landCellCount > 0 ? evolvedSoilCellCount / topology.landCellCount : 0,
      meanFertilityIndex: evolvedSoilCellCount > 0 ? meanFertilityAccumulator / evolvedSoilCellCount : null,
      maxCapacityMultiplierChange,
      maxWaterBalanceResidualMm,
      fixedPasses: 2,
      epistemicStatus: "coarse deterministic pedogenesis is solved between preliminary and final river passes: climate/productivity weathering, erosion and deposition change BIOME4 soil depth/capacity/percolation; revised closed water budgets then drive final groundwater, rivers, geomorphology and lakes"
    });

    const groundwater = resolveGroundwaterBaseflow(globalState, topology, {
      totalRunoffMmPerYear: revisedTotalRunoffMmPerYear,
      surfaceRunoffMmPerYear: revisedSurfaceRunoffMmPerYear,
      deepDrainageMmPerYear: revisedDeepDrainageMmPerYear,
      precipitationScale,
      soilWaterCapacityMm: revisedSoilWaterCapacityMm
    });
    localRunoffMmPerYear.set(groundwater.effectiveRunoffMmPerYear);

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
      preliminaryGeomorphologySummary: Object.freeze({
        policy: preliminaryGeomorphology.policy,
        generatedSedimentM3PerYear: preliminaryGeomorphology.generatedSedimentM3PerYear,
        maxAbsoluteElevationChangeMeters: preliminaryGeomorphology.maxAbsoluteElevationChangeMeters,
        reroutedCellCount: preliminaryGeomorphology.reroutedCellCount
      }),
      soilEvolution,
      groundwater,
      lakes,
      waterSystemClosureErrorM3PerYear,
      waterSystemRelativeClosureError,
      waterSystemMassConserved: Math.abs(waterSystemClosureErrorM3PerYear) <= Math.max(1e-3, groundwater.landWaterInputM3PerYear * 2e-6),
      epistemicStatus: `${geomorphology.epistemicStatus}; preliminary runoff-driven geomorphology feeds a fixed-pass climate/weathering/erosion/deposition soil response, revised soil hydraulics recalculate runoff and recharge, deep drainage is delayed through groundwater, and closed geomorphic basins resolve lake water balance/spill without geographic special cases`
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
      epistemicStatus: "coarse Earth-system groundwater/lake sample from the same deterministic soil-evolved network that drives river discharge and geomorphic response"
    });
  }

  soilEvolutionSample(globalState, latitude, longitude, spatialDetail = 0.35) {
    const network = this.network(globalState, spatialDetail);
    const soil = network.geomorphology?.soilEvolution;
    if (!soil) return null;
    const cell = networkCellAt(network.topology, latitude, longitude);
    if (!network.topology.landMask[cell.index]) return null;
    const applied = Boolean(soil.appliedMask[cell.index]);
    return Object.freeze({
      policy: soil.policy,
      latitude: cell.latitude,
      longitude: cell.longitude,
      spacingDegrees: network.spacingDegrees,
      networkCellIndex: cell.index,
      evolved: applied,
      capacityMultiplier: applied ? soil.capacityMultiplier[cell.index] : 1,
      topWaterCapacityMm: applied ? soil.topWaterCapacityMm[cell.index] : null,
      bottomWaterCapacityMm: applied ? soil.bottomWaterCapacityMm[cell.index] : null,
      totalWaterCapacityMm: applied ? soil.topWaterCapacityMm[cell.index] + soil.bottomWaterCapacityMm[cell.index] : null,
      soilDepthMeters: applied ? soil.soilDepthMeters[cell.index] : null,
      fertilityIndex: applied ? soil.fertilityIndex[cell.index] : 1,
      soilProductionMmPerYear: applied ? soil.soilProductionMmPerYear[cell.index] : 0,
      erosionLossMmPerYear: applied ? soil.erosionLossMmPerYear[cell.index] : 0,
      depositionGainMmPerYear: applied ? soil.depositionGainMmPerYear[cell.index] : 0,
      evolvedSoilFraction: soil.evolvedSoilFraction,
      meanFertilityIndex: soil.meanFertilityIndex,
      fixedPasses: soil.fixedPasses,
      epistemicStatus: applied
        ? "network-derived evolved BIOME4 soil from the fixed preliminary-geomorphology → pedogenesis → revised-water-budget pass"
        : "no valid BIOME4 two-layer soil exists at this coarse network cell; the runtime retains the transparent fallback water bucket rather than fabricating evolved soil"
    });
  }

  surfaceGeomorphologyPatch(globalState, latitude, longitude, spatialDetail = 0.35) {
    const network = this.network(globalState, spatialDetail);
    const geomorphology = network.geomorphology;
    if (!geomorphology?.netElevationOffsetMeters) return null;
    const topology = network.topology;
    const cell = networkCellAt(topology, latitude, longitude);
    if (!topology.landMask[cell.index]) return null;

    const centerOffset = Number(geomorphology.netElevationOffsetMeters[cell.index]) || 0;
    const center = topologyCell(topology, cell.index);
    const offsetAt = (row, col) => {
      const index = topologyNeighborIndex(topology, row, col);
      return index >= 0 && topology.landMask[index]
        ? Number(geomorphology.netElevationOffsetMeters[index]) || 0
        : centerOffset;
    };
    const eastOffset = offsetAt(center.row, center.col + 1);
    const westOffset = offsetAt(center.row, center.col - 1);
    const northOffset = offsetAt(center.row - 1, center.col);
    const southOffset = offsetAt(center.row + 1, center.col);
    const eastWestDistanceKm = Math.max(
      1,
      2 * topology.spacingDegrees * KM_PER_DEGREE * Math.max(0.12, Math.cos(center.latitude * Math.PI / 180))
    );
    const northSouthDistanceKm = Math.max(1, 2 * topology.spacingDegrees * KM_PER_DEGREE);
    const gradientEastMetersPerKm = (eastOffset - westOffset) / eastWestDistanceKm;
    const gradientNorthMetersPerKm = (northOffset - southOffset) / northSouthDistanceKm;

    const downstreamIndex = topology.downstream[cell.index];
    let downstreamLatitude = null;
    let downstreamLongitude = null;
    let channelBearingRadians = null;
    let channelDistanceFromSelectionKm = null;
    let channelClosestXKm = null;
    let channelClosestZKm = null;
    let channelReachLengthKm = null;
    let routedSlope = null;
    if (downstreamIndex >= 0 && topology.landMask[downstreamIndex]) {
      const downstream = topologyCell(topology, downstreamIndex);
      downstreamLatitude = downstream.latitude;
      downstreamLongitude = downstream.longitude;
      const localCenter = localKmFrom(latitude, longitude, center.latitude, center.longitude);
      const localDownstream = localKmFrom(latitude, longitude, downstream.latitude, downstream.longitude);
      const closest = closestPointToOriginOnSegment(localCenter, localDownstream);
      channelBearingRadians = Math.atan2(closest.dz, closest.dx);
      channelDistanceFromSelectionKm = closest.distanceKm;
      channelClosestXKm = closest.x;
      channelClosestZKm = closest.z;
      channelReachLengthKm = closest.lengthKm;
      routedSlope = closest.lengthKm > 0
        ? Math.max(0, (topology.elevationMeters[cell.index] - topology.elevationMeters[downstreamIndex]) / (closest.lengthKm * 1000))
        : 0;
    }

    return Object.freeze({
      policy: SURFACE_GEOMORPHOLOGY_PATCH_POLICY,
      geomorphologyPolicy: geomorphology.policy,
      soilPolicy: geomorphology.soilEvolution?.policy ?? null,
      latitude: Number(latitude),
      longitude: Number(longitude),
      networkLatitude: center.latitude,
      networkLongitude: center.longitude,
      spacingDegrees: topology.spacingDegrees,
      networkCellIndex: cell.index,
      geomorphicElevationOffsetMeters: centerOffset,
      geomorphicGradientEastMetersPerKm: gradientEastMetersPerKm,
      geomorphicGradientNorthMetersPerKm: gradientNorthMetersPerKm,
      erosionRateMmPerYear: Number(geomorphology.erosionRateMmPerYear[cell.index]) || 0,
      depositionRateMmPerYear: Number(geomorphology.depositionRateMmPerYear[cell.index]) || 0,
      meanDischargeM3s: Number(network.accumulation.meanDischargeM3s[cell.index]) || 0,
      upstreamAreaKm2: Number(network.accumulation.upstreamAreaKm2[cell.index]) || 0,
      downstreamIndex,
      downstreamLatitude,
      downstreamLongitude,
      channelBearingRadians,
      channelDistanceFromSelectionKm,
      channelClosestXKm,
      channelClosestZKm,
      channelReachLengthKm,
      routedSlope,
      drainageReroutedCellCount: geomorphology.reroutedCellCount ?? 0,
      epistemicStatus: "local presentation patch sampled from the same coarse soil-evolved conserved geomorphic river network: scientific elevation offset and finite-difference relief gradient are projected continuously; routed reach geometry identifies direction/proximity but any sub-grid channel cross-section remains presentation-only"
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
      routingTopographyState: "preliminary routing uses evolving tectonic elevation; preliminary discharge drives geomorphology/pedogenesis; evolved soil hydraulics recalculate water; revised recharge/baseflow drives final geomorphology and closed-basin lakes",
      geomorphologyPolicy: DYNAMIC_GEOMORPHOLOGY_POLICY,
      dynamicSoilPolicy: DYNAMIC_SOIL_POLICY,
      groundwaterPolicy: GROUNDWATER_POLICY,
      lakePolicy: CLOSED_BASIN_LAKE_POLICY,
      surfaceGeomorphologyPatchPolicy: SURFACE_GEOMORPHOLOGY_PATCH_POLICY,
      fixedEarthSystemPasses: 2,
      waterAndSedimentClosureTrackedSeparately: true,
      epistemicStatus: `${base.epistemicStatus}; the coarse network uses a fixed two-pass soil-landscape solve so climate/weathering/erosion/deposition can alter BIOME4 soil hydraulics and therefore runoff/recharge without creating recursive atmosphere-hydrology-geomorphology calls`
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