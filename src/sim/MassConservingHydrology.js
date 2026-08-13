import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";
import { gridSpacingForSpatialDetail } from "./SpatialHydroClimate.js";
import { closeAnnualWaterBalance, WATER_BALANCE_POLICY } from "./WaterBalance.js";
import { routeRunoffParcel, RUNOFF_ROUTING_POLICY } from "./RunoffRouting.js";

const round = (value, digits = 4) => Number(value.toFixed(digits));

export const MASS_CONSERVING_HYDROLOGY_POLICY = "closed-water-budget-etopo-routing-v1";

export class MassConservingHydrology {
  constructor(spatialHydroClimate) {
    if (!spatialHydroClimate?.sample || !spatialHydroClimate?.monthlyAt) {
      throw new TypeError("MassConservingHydrology requires a SpatialHydroClimate-like source.");
    }
    this.climate = spatialHydroClimate;
    this.cache = new Map();
    this.cacheSignature = null;
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

  diagnostics(globalState, spatialDetail = 0.35) {
    return Object.freeze({
      policy: MASS_CONSERVING_HYDROLOGY_POLICY,
      climate: this.climate.diagnostics?.(globalState, spatialDetail) ?? null,
      waterBalancePolicy: WATER_BALANCE_POLICY,
      runoffRoutingPolicy: RUNOFF_ROUTING_POLICY,
      cachedWaterBalanceCells: this.cache.size,
      stateSignature: this._stateSignature(globalState, spatialDetail),
      epistemicStatus: "model-derived closed land water budget plus parcel routing; not a reconstructed river network"
    });
  }
}
