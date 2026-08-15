import { MassConservingHydrology } from "./MassConservingHydrology.js";
import { closeAnnualWaterBalance } from "./WaterBalance.js";
import { dynamicSurfaceElevationMeters } from "./GeneralAtmosphereCirculation.js";
import { evolveRunoffNetworkTopography, DYNAMIC_GEOMORPHOLOGY_POLICY } from "./DynamicGeomorphology.js";
import { gridSpacingForSpatialDetail } from "./SpatialHydroClimate.js";
import { networkSpacingForSpatialDetail } from "./RunoffRouting.js";

const round = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits));
const quantize = (value, step) => Math.round((Number(value) || 0) / step) * step;
const COUPLED_METHODS = Object.freeze([
  "_stateSignature",
  "_networkForcingState",
  "_networkSignature",
  "_routingElevationAt",
  "_routingTopologySignature",
  "_refineNetworkTopology",
  "_balanceFor"
]);

export const EARTH_SYSTEM_HYDROLOGY_POLICY = "dynamic-topography-atmosphere-geomorphology-hydrology-v2";

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
    if ((Number(globalState.elapsedYears) || 0) <= 0) return null;
    return evolveRunoffNetworkTopography(globalState, topology, localRunoffMmPerYear, climateForcedMask);
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
      routingTopographyState: "preliminary routing uses evolving tectonic elevation; conserved runoff then drives stream-power erosion and sediment redistribution before one deterministic drainage-topology rebuild",
      geomorphologyPolicy: DYNAMIC_GEOMORPHOLOGY_POLICY,
      waterAndSedimentClosureTrackedSeparately: true,
      epistemicStatus: `${base.epistemicStatus}; local elevation and cache invalidation are branch-coupled to the general atmosphere, orbit and evolving tectonics; coarse routing additionally resolves one-pass runoff-driven erosion/sediment redistribution and drainage-divide migration`
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
