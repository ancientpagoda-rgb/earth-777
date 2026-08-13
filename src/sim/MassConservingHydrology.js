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
  RUNOFF_ROUTING_POLICY
} from "./RunoffRouting.js";

const round = (value, digits = 4) => Number(value.toFixed(digits));
const quantize = (value, step) => Math.round((Number(value) || 0) / step) * step;

export const MASS_CONSERVING_HYDROLOGY_POLICY = "closed-water-budget-etopo-routing-v1";

export class MassConservingHydrology {
  constructor(spatialHydroClimate) {
    if (!spatialHydroClimate?.sample || !spatialHydroClimate?.monthlyAt) {
      throw new TypeError("MassConservingHydrology requires a SpatialHydroClimate-like source.");
    }
    this.climate = spatialHydroClimate;
    this.cache = new Map();
    this.cacheSignature = null;
    this.networkCache = new Map();
    this.networkTopologyCache = new Map();
  }

  _stateSignature(globalState, spatialDetail) {
    return [
      gridSpacingForSpatialDetail(spatialDetail),
      round(globalState.temperatureAnomaly ?? 0, 3),
      round(globalState.iceIndex ?? 0, 4)
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
      round(forcing.seaLevel ?? 0, 0)
    ].join("|");
  }

  sample(globalState, latitude, longitude, spatialDetail = 0.35) {
    this._prepareCache(globalState, spatialDetail);
    const climate = this.climate.sample(globalState, latitude, longitude, spatialDetail);
    if (!climate) return null;
    const key = `${climate.latitude}:${climate.longitude}:${climate.gridSpacingDegrees}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const monthlyClimate = Array.from({ length: 12 }, (_, monthIndex) =>
      this.climate.monthlyAt(globalState, monthIndex, climate.latitude, climate.longitude, spatialDetail)
    );
    if (monthlyClimate.some((month) => !month)) {
      const fallback = Object.freeze({ ...climate });
      this.cache.set(key, fallback);
      return fallback;
    }

    const elevationMeters = bedrockElevationAt(climate.latitude, climate.longitude);
    const balance = closeAnnualWaterBalance(monthlyClimate, {
      latitude: climate.latitude,
      elevationMeters
    });
    const result = Object.freeze({
      ...climate,
      elevationMeters: round(elevationMeters, 1),
      soilMoistureIndex: balance.soilMoistureIndex,
      soilWaterStorageMm: balance.meanSoilWaterStorageMm,
      potentialEvapotranspirationMmPerYear: balance.potentialEvapotranspirationMmPerYear,
      actualEvapotranspirationMmPerYear: balance.actualEvapotranspirationMmPerYear,
      runoffMmPerYear: balance.runoffMmPerYear,
      runoffPotentialMmPerYear: balance.runoffMmPerYear,
      waterStorageChangeMmPerYear: balance.storageChangeMm,
      waterBalanceResidualMm: balance.massBalanceResidualMm,
      waterBalancePolicy: WATER_BALANCE_POLICY,
      policy: MASS_CONSERVING_HYDROLOGY_POLICY,
      climatePolicy: climate.policy,
      epistemicStatus: `${climate.epistemicStatus}; land water fluxes are ${balance.epistemicStatus}`
    });
    this.cache.set(key, result);
    return result;
  }

  monthlyAt(globalState, month, latitude, longitude, spatialDetail = 0.35) {
    const climate = this.climate.monthlyAt(globalState, month, latitude, longitude, spatialDetail);
    if (!climate) return null;
    const annual = this.sample(globalState, latitude, longitude, spatialDetail);
    const monthIndex = climate.monthIndex;
    const balanceMonth = annual
      ? closeAnnualWaterBalance(
          Array.from({ length: 12 }, (_, index) =>
            this.climate.monthlyAt(globalState, index, annual.latitude, annual.longitude, spatialDetail)
          ),
          { latitude: annual.latitude, elevationMeters: annual.elevationMeters }
        ).months[monthIndex]
      : null;
    return Object.freeze({
      ...climate,
      potentialEvapotranspirationMm: balanceMonth?.potentialEvapotranspirationMm ?? null,
      actualEvapotranspirationMm: balanceMonth?.actualEvapotranspirationMm ?? null,
      runoffMm: balanceMonth?.runoffMm ?? null,
      soilWaterStorageMm: balanceMonth?.endStorageMm ?? null,
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
      ...options
    });
  }

  network(globalState, spatialDetail = 0.35) {
    const signature = this._networkSignature(globalState, spatialDetail);
    if (this.networkCache.has(signature)) return this.networkCache.get(signature);

    const forcingState = this._networkForcingState(globalState);
    const spacingDegrees = networkSpacingForSpatialDetail(spatialDetail);
    const topologyKey = `${spacingDegrees}|${forcingState.seaLevel}`;
    let topology = this.networkTopologyCache.get(topologyKey);
    if (!topology) {
      topology = buildRunoffNetworkTopology({
        spacingDegrees,
        seaLevelMeters: forcingState.seaLevel
      });
      this.networkTopologyCache.set(topologyKey, topology);
      if (this.networkTopologyCache.size > 4) {
        this.networkTopologyCache.delete(this.networkTopologyCache.keys().next().value);
      }
    }

    // Match local water-balance cells to the coarse network grid. The selected
    // region can still use 0.5° climate separately from this network solve.
    const networkClimateDetail = spacingDegrees === 2 ? 0.35 : 0.1;
    const localRunoffMmPerYear = new Float32Array(topology.count);
    let activeRunoffCells = 0;

    for (const index of topology.routingOrder) {
      const row = Math.floor(index / topology.cols);
      const col = index % topology.cols;
      const latitude = 90 - (row + 0.5) * spacingDegrees;
      const longitude = -180 + (col + 0.5) * spacingDegrees;
      const local = this.sample(forcingState, latitude, longitude, networkClimateDetail);
      if (!local || !Number.isFinite(local.runoffMmPerYear)) continue;
      localRunoffMmPerYear[index] = Math.max(0, local.runoffMmPerYear);
      activeRunoffCells += 1;
    }

    const accumulation = accumulateRunoffNetwork(topology, localRunoffMmPerYear);
    const result = Object.freeze({
      policy: RIVER_NETWORK_POLICY,
      signature,
      forcingState,
      spacingDegrees,
      networkClimateDetail,
      topology,
      localRunoffMmPerYear,
      accumulation,
      activeRunoffCells,
      epistemicStatus: "model-derived upstream-accumulating river network from closed local water budgets; ETOPO is a modern-bedrock baseline and channel hydraulics are not yet simulated"
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
    const route = routeRunoffParcel(cell.latitude, cell.longitude, localRunoffMmPerYear, {
      spacingDegrees: network.spacingDegrees,
      seaLevelMeters: network.forcingState.seaLevel,
      maxSteps: 1024
    });
    return Object.freeze({
      policy: RIVER_NETWORK_POLICY,
      latitude: cell.latitude,
      longitude: cell.longitude,
      spacingDegrees: network.spacingDegrees,
      elevationMeters: network.topology.elevationMeters[cell.index],
      localRunoffMmPerYear,
      localAnnualVolumeM3: network.accumulation.localAnnualVolumeM3[cell.index],
      accumulatedAnnualVolumeM3: network.accumulation.accumulatedAnnualVolumeM3[cell.index],
      meanDischargeM3s: network.accumulation.meanDischargeM3s[cell.index],
      upstreamAreaKm2: network.accumulation.upstreamAreaKm2[cell.index],
      upstreamCellCount: network.accumulation.upstreamCellCount[cell.index],
      outlet: route.outlet,
      routeCellsToOutlet: route.path.length,
      networkMassConserved: network.accumulation.massConserved,
      networkRelativeClosureError: network.accumulation.relativeClosureError,
      epistemicStatus: network.epistemicStatus
    });
  }

  diagnostics(globalState, spatialDetail = 0.35) {
    return Object.freeze({
      policy: MASS_CONSERVING_HYDROLOGY_POLICY,
      climate: this.climate.diagnostics?.(globalState, spatialDetail) ?? null,
      waterBalancePolicy: WATER_BALANCE_POLICY,
      runoffRoutingPolicy: RUNOFF_ROUTING_POLICY,
      riverNetworkPolicy: RIVER_NETWORK_POLICY,
      cachedWaterBalanceCells: this.cache.size,
      cachedNetworks: this.networkCache.size,
      stateSignature: this._stateSignature(globalState, spatialDetail),
      epistemicStatus: "model-derived closed land water budget with parcel routing and optional upstream-accumulating river network; not a reconstructed river network"
    });
  }
}
