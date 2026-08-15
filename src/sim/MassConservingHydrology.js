import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";
import { gridSpacingForSpatialDetail } from "./SpatialHydroClimate.js";
import { closeAnnualWaterBalance, WATER_BALANCE_POLICY } from "./WaterBalance.js";
import {
  accumulateRunoffNetwork,
  buildRunoffNetworkTopology,
  networkCellAt,
  networkSpacingForSpatialDetail,
  RIVER_NETWORK_POLICY,
  routeRunoffParcel,
  RUNOFF_ROUTING_POLICY,
  traceRunoffNetwork
} from "./RunoffRouting.js";

const round = (value, digits = 4) => Number(value.toFixed(digits));
const quantize = (value, step) => Math.round((Number(value) || 0) / step) * step;

export const MASS_CONSERVING_HYDROLOGY_POLICY = "closed-water-budget-state-routing-v3";

export class MassConservingHydrology {
  constructor(spatialHydroClimate, soilLayer = null) {
    if (!spatialHydroClimate?.sample || !spatialHydroClimate?.monthlyAt) {
      throw new TypeError("MassConservingHydrology requires a SpatialHydroClimate-like source.");
    }
    this.climate = spatialHydroClimate;
    this.soil = soilLayer?.profileAt ? soilLayer : null;
    this.cache = new Map();
    this.cacheSignature = null;
    this.networkCache = new Map();
    this.networkTopologyCache = new Map();
  }

  _stateSignature(globalState, spatialDetail) {
    return [
      gridSpacingForSpatialDetail(spatialDetail),
      round(globalState.temperatureAnomaly ?? 0, 3),
      round(globalState.iceIndex ?? 0, 4),
      this.soil?.meta?.assetSha256 ?? "fallback-soil"
    ].join("|");
  }

  _prepareCache(globalState, spatialDetail) {
    const signature = this._stateSignature(globalState, spatialDetail);
    if (signature !== this.cacheSignature) {
      this.cache.clear();
      this.cacheSignature = signature;
    }
  }

  _networkForcingState(globalState) {
    // Whole-network solves are expensive. CWF permits deterministic coarser
    // state bins so small frame-to-frame changes reuse the same conserved
    // network instead of rebuilding thousands of local water budgets.
    return Object.freeze({
      ...globalState,
      temperatureAnomaly: quantize(globalState.temperatureAnomaly, 0.1),
      iceIndex: quantize(globalState.iceIndex, 0.01),
      seaLevel: quantize(globalState.seaLevel, 2)
    });
  }

  _networkSignature(globalState, spatialDetail) {
    const forcing = this._networkForcingState(globalState);
    return [
      networkSpacingForSpatialDetail(spatialDetail),
      round(forcing.temperatureAnomaly ?? 0, 1),
      round(forcing.iceIndex ?? 0, 2),
      round(forcing.seaLevel ?? 0, 0),
      this.soil?.meta?.assetSha256 ?? "fallback-soil"
    ].join("|");
  }

  _routingElevationAt(_globalState, latitude, longitude) {
    return bedrockElevationAt(latitude, longitude);
  }

  _routingTopologySignature(_globalState) {
    return "modern-etopo-reference";
  }

  _refineNetworkTopology(_globalState, _topology, _localRunoffMmPerYear, _climateForcedMask) {
    return null;
  }

  _soilProfile(latitude, longitude) {
    return this.soil?.profileAt?.(latitude, longitude) ?? null;
  }

  _balanceFor(globalState, climate, spatialDetail, includeDailyTrace = false) {
    const monthlyClimate = Array.from({ length: 12 }, (_, monthIndex) =>
      this.climate.monthlyAt(globalState, monthIndex, climate.latitude, climate.longitude, spatialDetail)
    );
    if (monthlyClimate.some((month) => !month)) return null;
    const elevationMeters = bedrockElevationAt(climate.latitude, climate.longitude);
    const soilProfile = this._soilProfile(climate.latitude, climate.longitude);
    const balance = closeAnnualWaterBalance(monthlyClimate, {
      latitude: climate.latitude,
      elevationMeters,
      soilProfile: soilProfile?.validSoil ? soilProfile : null,
      includeDailyTrace
    });
    return { elevationMeters, soilProfile, balance, monthlyClimate };
  }

  dailyWaterTrace(globalState, latitude, longitude, spatialDetail = 0.35) {
    const climate = this.climate.sample(globalState, latitude, longitude, spatialDetail);
    if (!climate) return null;
    const solved = this._balanceFor(globalState, climate, spatialDetail, true);
    if (!solved?.balance?.daily || !solved.soilProfile?.validSoil) {
      return Object.freeze({
        latitude: climate.latitude,
        longitude: climate.longitude,
        gridSpacingDegrees: climate.gridSpacingDegrees,
        soilProfileApplied: false,
        soilStatus: solved?.soilProfile?.status ?? "unavailable",
        dailyWaterTrace: null,
        monthlyTemperatureCelsius: solved?.monthlyClimate?.map((month) => month?.temperatureCelsius ?? null) ?? null,
        monthlyCloudCoverPercent: solved?.monthlyClimate?.map((month) => month?.cloudCoverPercent ?? null) ?? null,
        monthlyPrecipitationMmPerYear: solved?.monthlyClimate?.map((month) => month?.precipitationMmPerYear ?? null) ?? null,
        epistemicStatus: "daily PFT water-access trace unavailable because BIOME4 does not define a valid two-layer soil profile at this materialized cell"
      });
    }
    return Object.freeze({
      latitude: climate.latitude,
      longitude: climate.longitude,
      gridSpacingDegrees: climate.gridSpacingDegrees,
      elevationMeters: solved.elevationMeters,
      soilProfileApplied: true,
      soilStatus: solved.soilProfile.status,
      soilSource: solved.soilProfile.source,
      topSoilWaterCapacityMm: solved.balance.topSoilWaterCapacityMm,
      bottomSoilWaterCapacityMm: solved.balance.bottomSoilWaterCapacityMm,
      monthlyTemperatureCelsius: Object.freeze(solved.monthlyClimate.map((month) => month.temperatureCelsius)),
      monthlyCloudCoverPercent: Object.freeze(solved.monthlyClimate.map((month) => month.cloudCoverPercent)),
      monthlyPrecipitationMmPerYear: Object.freeze(solved.monthlyClimate.map((month) => month.precipitationMmPerYear)),
      dailyWaterTrace: solved.balance.daily,
      waterBalanceResidualMm: solved.balance.massBalanceResidualMm,
      epistemicStatus: "opt-in final-spinup-year daily two-layer soil state from the same conserved Earth 777 water balance; exposed for PFT diagnostics without changing the hydrology solution"
    });
  }

  sample(globalState, latitude, longitude, spatialDetail = 0.35) {
    this._prepareCache(globalState, spatialDetail);
    const climate = this.climate.sample(globalState, latitude, longitude, spatialDetail);
    if (!climate) return null;
    const key = `${climate.latitude}:${climate.longitude}:${climate.gridSpacingDegrees}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const solved = this._balanceFor(globalState, climate, spatialDetail);
    if (!solved) {
      const fallback = Object.freeze({ ...climate });
      this.cache.set(key, fallback);
      return fallback;
    }

    const { elevationMeters, soilProfile, balance } = solved;
    const soilProfileApplied = Boolean(soilProfile?.validSoil);
    const result = Object.freeze({
      ...climate,
      elevationMeters: round(elevationMeters, 1),
      soilMoistureIndex: balance.soilMoistureIndex,
      soilWaterStorageMm: balance.meanSoilWaterStorageMm,
      soilWaterCapacityMm: balance.soilWaterCapacityMm,
      topSoilWaterCapacityMm: balance.topSoilWaterCapacityMm,
      bottomSoilWaterCapacityMm: balance.bottomSoilWaterCapacityMm,
      topPercolationCoefficient: balance.topPercolationCoefficient,
      bottomPercolationCoefficient: balance.bottomPercolationCoefficient,
      potentialEvapotranspirationMmPerYear: balance.potentialEvapotranspirationMmPerYear,
      actualEvapotranspirationMmPerYear: balance.actualEvapotranspirationMmPerYear,
      runoffMmPerYear: balance.runoffMmPerYear,
      runoffPotentialMmPerYear: balance.runoffMmPerYear,
      surfaceRunoffMmPerYear: balance.surfaceRunoffMmPerYear,
      deepDrainageMmPerYear: balance.deepDrainageMmPerYear,
      waterStorageChangeMmPerYear: balance.storageChangeMm,
      waterBalanceResidualMm: balance.massBalanceResidualMm,
      waterBalanceMonths: balance.months,
      waterBalancePolicy: WATER_BALANCE_POLICY,
      soilPolicy: balance.soilPolicy,
      soilProfileApplied,
      soilStatus: soilProfile?.status ?? "unavailable",
      soilSource: soilProfileApplied ? soilProfile.source : null,
      policy: MASS_CONSERVING_HYDROLOGY_POLICY,
      climatePolicy: climate.policy,
      epistemicStatus: `${climate.epistemicStatus}; land water fluxes are ${balance.epistemicStatus}${soilProfile && !soilProfileApplied ? `; BIOME4 soil status ${soilProfile.status} therefore uses the transparent fallback bucket rather than fabricated soil` : ""}`
    });
    this.cache.set(key, result);
    return result;
  }

  monthlyAt(globalState, month, latitude, longitude, spatialDetail = 0.35) {
    const climate = this.climate.monthlyAt(globalState, month, latitude, longitude, spatialDetail);
    if (!climate) return null;
    const annual = this.sample(globalState, latitude, longitude, spatialDetail);
    const balanceMonth = annual?.waterBalanceMonths?.[climate.monthIndex] ?? null;
    return Object.freeze({
      ...climate,
      potentialEvapotranspirationMm: balanceMonth?.potentialEvapotranspirationMm ?? null,
      actualEvapotranspirationMm: balanceMonth?.actualEvapotranspirationMm ?? null,
      runoffMm: balanceMonth?.runoffMm ?? null,
      surfaceRunoffMm: balanceMonth?.surfaceRunoffMm ?? null,
      deepDrainageMm: balanceMonth?.deepDrainageMm ?? null,
      soilWaterStorageMm: balanceMonth?.endStorageMm ?? null,
      soilProfileApplied: annual?.soilProfileApplied ?? false,
      soilStatus: annual?.soilStatus ?? null,
      waterBalancePolicy: balanceMonth ? WATER_BALANCE_POLICY : null,
      policy: MASS_CONSERVING_HYDROLOGY_POLICY
    });
  }

  routeRunoff(globalState, latitude, longitude, spatialDetail = 0.35, options = {}) {
    const sample = this.sample(globalState, latitude, longitude, spatialDetail);
    if (!sample || !Number.isFinite(sample.runoffMmPerYear)) return null;
    return routeRunoffParcel(sample.latitude, sample.longitude, sample.runoffMmPerYear, {
      spacingDegrees: sample.gridSpacingDegrees,
      seaLevelMeters: globalState.seaLevel ?? 0,
      elevationAt: (lat, lon) => this._routingElevationAt(globalState, lat, lon),
      ...options
    });
  }

  network(globalState, spatialDetail = 0.35) {
    const signature = this._networkSignature(globalState, spatialDetail);
    if (this.networkCache.has(signature)) return this.networkCache.get(signature);

    const forcingState = this._networkForcingState(globalState);
    const spacingDegrees = networkSpacingForSpatialDetail(spatialDetail);
    const topologyKey = `${spacingDegrees}|${forcingState.seaLevel}|${this._routingTopologySignature(forcingState)}`;
    let topology = this.networkTopologyCache.get(topologyKey);
    if (!topology) {
      topology = buildRunoffNetworkTopology({
        spacingDegrees,
        seaLevelMeters: forcingState.seaLevel,
        elevationAt: (latitude, longitude) => this._routingElevationAt(forcingState, latitude, longitude),
        elevationPolicy: this._routingTopologySignature(forcingState)
      });
      this.networkTopologyCache.set(topologyKey, topology);
      if (this.networkTopologyCache.size > 4) {
        this.networkTopologyCache.delete(this.networkTopologyCache.keys().next().value);
      }
    }
    const preliminaryTopology = topology;

    // Match local water-balance cells to the coarse network grid. The selected
    // region can still use 0.5° climate separately from this network solve.
    const networkClimateDetail = spacingDegrees === 2 ? 0.35 : 0.1;
    const localRunoffMmPerYear = new Float32Array(topology.count);
    const climateForcedMask = new Uint8Array(topology.count);
    let activeRunoffCells = 0;

    for (const index of topology.routingOrder) {
      const row = Math.floor(index / topology.cols);
      const col = index % topology.cols;
      const latitude = 90 - (row + 0.5) * spacingDegrees;
      const longitude = -180 + (col + 0.5) * spacingDegrees;
      const local = this.sample(forcingState, latitude, longitude, networkClimateDetail);
      if (!local || !Number.isFinite(local.runoffMmPerYear)) continue;
      localRunoffMmPerYear[index] = Math.max(0, local.runoffMmPerYear);
      climateForcedMask[index] = 1;
      activeRunoffCells += 1;
    }

    const refinement = this._refineNetworkTopology(
      forcingState,
      preliminaryTopology,
      localRunoffMmPerYear,
      climateForcedMask
    );
    if (refinement?.topology) {
      topology = refinement.topology;
      activeRunoffCells = 0;
      for (let index = 0; index < topology.count; index += 1) {
        if (!topology.landMask[index]) {
          localRunoffMmPerYear[index] = 0;
          climateForcedMask[index] = 0;
        }
        if (topology.landMask[index] && localRunoffMmPerYear[index] > 0) activeRunoffCells += 1;
      }
    }

    const accumulation = accumulateRunoffNetwork(topology, localRunoffMmPerYear, climateForcedMask);
    const result = Object.freeze({
      policy: RIVER_NETWORK_POLICY,
      signature,
      forcingState,
      spacingDegrees,
      networkClimateDetail,
      topology,
      preliminaryTopology,
      geomorphology: refinement?.topology ? refinement : null,
      localRunoffMmPerYear,
      climateForcedMask,
      accumulation,
      activeRunoffCells,
      climateForcedLandCellCount: accumulation.climateForcedLandCellCount,
      climateForcingCoverageFraction: accumulation.climateForcingCoverageFraction,
      epistemicStatus: `model-derived upstream-accumulating river network from closed local water budgets${this.soil ? " using the official BIOME4 static spatial soil driver where valid" : ""}; routing elevation is ${topology.elevationPolicy}; discharge is complete only over the explicitly tracked climate-forced part of each basin; deep soil drainage currently joins routed runoff immediately pending groundwater/baseflow; channel hydraulics are not yet simulated`
    });
    this.networkCache.set(signature, result);
    if (this.networkCache.size > 3) this.networkCache.delete(this.networkCache.keys().next().value);
    return result;
  }

  networkSample(globalState, latitude, longitude, spatialDetail = 0.35) {
    const network = this.network(globalState, spatialDetail);
    const cell = networkCellAt(network.topology, latitude, longitude);
    if (!network.topology.landMask[cell.index]) return null;
    const localRunoffMmPerYear = network.localRunoffMmPerYear[cell.index];
    const route = traceRunoffNetwork(network.topology, cell.index, 1024);
    const upstreamAreaKm2 = network.accumulation.upstreamAreaKm2[cell.index];
    const upstreamClimateForcedAreaKm2 = network.accumulation.climateForcedUpstreamAreaKm2[cell.index];
    const upstreamClimateForcingCoverageFraction = upstreamAreaKm2 > 0
      ? upstreamClimateForcedAreaKm2 / upstreamAreaKm2
      : 0;
    const geomorphology = network.geomorphology;
    return Object.freeze({
      policy: RIVER_NETWORK_POLICY,
      latitude: cell.latitude,
      longitude: cell.longitude,
      spacingDegrees: network.spacingDegrees,
      elevationMeters: network.topology.elevationMeters[cell.index],
      localRunoffMmPerYear,
      localClimateForced: Boolean(network.climateForcedMask[cell.index]),
      localAnnualVolumeM3: network.accumulation.localAnnualVolumeM3[cell.index],
      accumulatedAnnualVolumeM3: network.accumulation.accumulatedAnnualVolumeM3[cell.index],
      meanDischargeM3s: network.accumulation.meanDischargeM3s[cell.index],
      upstreamAreaKm2,
      upstreamCellCount: network.accumulation.upstreamCellCount[cell.index],
      upstreamClimateForcedAreaKm2,
      upstreamClimateForcedCellCount: network.accumulation.climateForcedUpstreamCellCount[cell.index],
      upstreamClimateForcingCoverageFraction,
      globalClimateForcingCoverageFraction: network.accumulation.climateForcingCoverageFraction,
      outlet: route.outlet,
      routeCellsToOutlet: route.routeCellsToOutlet,
      routeAcyclic: route.acyclic,
      networkMassConserved: network.accumulation.massConserved,
      networkRelativeClosureError: network.accumulation.relativeClosureError,
      geomorphologyPolicy: geomorphology?.policy ?? null,
      erosionRateMmPerYear: geomorphology ? geomorphology.erosionRateMmPerYear[cell.index] : null,
      depositionRateMmPerYear: geomorphology ? geomorphology.depositionRateMmPerYear[cell.index] : null,
      geomorphicElevationOffsetMeters: geomorphology ? geomorphology.netElevationOffsetMeters[cell.index] : null,
      sedimentIncomingM3PerYear: geomorphology ? geomorphology.sedimentIncomingM3PerYear[cell.index] : null,
      sedimentOutgoingM3PerYear: geomorphology ? geomorphology.sedimentOutgoingM3PerYear[cell.index] : null,
      drainageReroutedCellCount: geomorphology?.reroutedCellCount ?? 0,
      sedimentMassConserved: geomorphology?.sedimentMassConserved ?? null,
      sedimentRelativeClosureError: geomorphology?.sedimentRelativeClosureError ?? null,
      epistemicStatus: network.epistemicStatus
    });
  }

  diagnostics(globalState, spatialDetail = 0.35) {
    return Object.freeze({
      policy: MASS_CONSERVING_HYDROLOGY_POLICY,
      climate: this.climate.diagnostics?.(globalState, spatialDetail) ?? null,
      soilSource: this.soil?.meta?.id ?? null,
      soilResolutionDegrees: this.soil?.meta?.spacingDegrees ?? null,
      soilAssetSha256: this.soil?.meta?.assetSha256 ?? null,
      waterBalancePolicy: WATER_BALANCE_POLICY,
      runoffRoutingPolicy: RUNOFF_ROUTING_POLICY,
      riverNetworkPolicy: RIVER_NETWORK_POLICY,
      routingTopologyPolicy: this._routingTopologySignature(globalState),
      cachedWaterBalanceCells: this.cache.size,
      cachedNetworks: this.networkCache.size,
      stateSignature: this._stateSignature(globalState, spatialDetail),
      epistemicStatus: "model-derived closed land water budget with optional study-constrained BIOME4 static two-layer soil, state-dependent parcel routing, and upstream-accumulating river network; deep drainage is not yet groundwater/baseflow and this is not a reconstructed river network"
    });
  }
}
