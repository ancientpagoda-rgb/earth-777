import { MassConservingHydrology } from "./MassConservingHydrology.js";
import { closeAnnualWaterBalance } from "./WaterBalance.js";
import { dynamicSurfaceElevationMeters } from "./GeneralAtmosphereCirculation.js";
import { gridSpacingForSpatialDetail } from "./SpatialHydroClimate.js";
import { networkSpacingForSpatialDetail } from "./RunoffRouting.js";

const round = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits));
const quantize = (value, step) => Math.round((Number(value) || 0) / step) * step;

export const EARTH_SYSTEM_HYDROLOGY_POLICY = "dynamic-topography-general-atmosphere-hydrology-v1";

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
    return Object.freeze({
      ...globalState,
      temperatureAnomaly: quantize(globalState.temperatureAnomaly, 0.1),
      oceanTemperatureAnomaly: quantize(globalState.oceanTemperatureAnomaly ?? globalState.temperatureAnomaly, 0.1),
      iceIndex: quantize(globalState.iceIndex, 0.01),
      eccentricity: quantize(globalState.eccentricity, 0.0005),
      obliquity: quantize(globalState.obliquity, 0.05),
      precession: quantize(globalState.precession, 2),
      seaLevel: quantize(globalState.seaLevel, 2),
      tectonicTimeMyr: quantize(globalState.tectonicTimeMyr, 0.0025),
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
      round(forcing.tectonicTimeMyr, 3),
      round(forcing.tectonicBoundaryActivity, 2),
      round(forcing.productivityIndex, 2),
      this.soil?.meta?.assetSha256 ?? "fallback-soil"
    ].join("|");
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
      routingTopographyState: "ETOPO routing topology retained as an explicit coarse reference; local water balance already uses evolving tectonic elevation",
      epistemicStatus: `${base.epistemicStatus}; local elevation and cache invalidation are branch-coupled to the general atmosphere, orbit and evolving tectonics`
    });
  }
}
