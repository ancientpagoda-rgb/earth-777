import { checkpointState, CHECKPOINT_777 } from "../data/checkpoint-777.js";
import { MassConservingHydrology } from "./MassConservingHydrology.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 4) => Number(value.toFixed(digits));

export const SPATIAL_VEGETATION_POLICY = "biome4-checkpoint-hydro-co2-response-v1";

function responseFactor(globalState, currentHydrology, checkpointHydrology) {
  let waterRatio = 1;
  const currentAet = currentHydrology?.actualEvapotranspirationMmPerYear;
  const checkpointAet = checkpointHydrology?.actualEvapotranspirationMmPerYear;
  if (Number.isFinite(currentAet) && Number.isFinite(checkpointAet) && checkpointAet > 5) {
    waterRatio = clamp(currentAet / checkpointAet, 0.15, 4);
  } else {
    const currentMoisture = currentHydrology?.soilMoistureIndex;
    const checkpointMoisture = checkpointHydrology?.soilMoistureIndex;
    if (Number.isFinite(currentMoisture) && Number.isFinite(checkpointMoisture) && checkpointMoisture > 0.02) {
      waterRatio = clamp(currentMoisture / checkpointMoisture, 0.15, 4);
    }
  }

  const co2 = clamp(globalState.co2 ?? CHECKPOINT_777.boundary.co2.value, 120, 600);
  const checkpointCo2 = CHECKPOINT_777.boundary.co2.value;
  const co2Ratio = clamp((co2 / checkpointCo2) ** 0.25, 0.75, 1.35);
  return clamp(waterRatio ** 0.65 * co2Ratio, 0.15, 2.5);
}

export class SpatialVegetation {
  constructor(checkpointVegetation, hydrology) {
    if (!checkpointVegetation?.annualAt || !checkpointVegetation?.monthlyNppAt) {
      throw new TypeError("SpatialVegetation requires a Krapp777VegetationLayer-like checkpoint source.");
    }
    if (!hydrology?.sample) {
      throw new TypeError("SpatialVegetation requires a MassConservingHydrology-like source.");
    }
    this.checkpoint = checkpointVegetation;
    this.hydrology = hydrology;
    this.checkpointHydrology = hydrology instanceof MassConservingHydrology
      ? new MassConservingHydrology(hydrology.climate, hydrology.soil)
      : hydrology;
    this.checkpointState = checkpointState();
    this.cache = new Map();
    this.cacheSignature = null;
  }

  _signature(globalState, spatialDetail) {
    return [
      round(globalState.temperatureAnomaly ?? 0, 3),
      round(globalState.iceIndex ?? 0, 4),
      round(globalState.co2 ?? CHECKPOINT_777.boundary.co2.value, 2),
      round(spatialDetail, 2)
    ].join("|");
  }

  _prepare(globalState, spatialDetail) {
    const signature = this._signature(globalState, spatialDetail);
    if (signature !== this.cacheSignature) {
      this.cache.clear();
      this.cacheSignature = signature;
    }
  }

  sample(globalState, latitude, longitude, spatialDetail = 0.35) {
    const detail = clamp(spatialDetail, 0, 1);
    this._prepare(globalState, detail);
    const currentHydrology = this.hydrology.sample(globalState, latitude, longitude, detail);
    const sampleLatitude = currentHydrology?.latitude ?? latitude;
    const sampleLongitude = currentHydrology?.longitude ?? longitude;
    const spacing = currentHydrology?.gridSpacingDegrees ?? this.checkpoint.meta?.spacingDegrees ?? 0.5;
    const key = `${sampleLatitude}:${sampleLongitude}:${spacing}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const published = this.checkpoint.annualAt(sampleLatitude, sampleLongitude);
    if (!published || !Number.isFinite(published.npp)) return null;

    const isCheckpoint = (globalState.elapsedYears ?? 0) <= 0;
    let factor = 1;
    let checkpointHydrology = null;
    if (!isCheckpoint) {
      checkpointHydrology = this.checkpointHydrology.sample(this.checkpointState, sampleLatitude, sampleLongitude, detail);
      factor = responseFactor(globalState, currentHydrology, checkpointHydrology);
    }

    const npp = published.npp * factor;
    const lai = Number.isFinite(published.lai)
      ? published.lai * clamp(factor ** 0.55, 0.25, 1.8)
      : null;
    const transitionPressure = isCheckpoint ? 0 : clamp(Math.abs(Math.log(Math.max(1e-6, factor))) / Math.log(2.5), 0, 1);
    const result = Object.freeze({
      latitude: sampleLatitude,
      longitude: sampleLongitude,
      gridSpacingDegrees: spacing,
      biomeCode: published.biomeCode,
      biomeLabel: published.biomeLabel,
      npp: round(npp, 2),
      lai: Number.isFinite(lai) ? round(lai, 3) : null,
      checkpointNpp: round(published.npp, 2),
      checkpointLai: Number.isFinite(published.lai) ? round(published.lai, 3) : null,
      productivityFactor: round(factor, 4),
      transitionPressure: round(transitionPressure, 4),
      checkpointCategoryRetained: true,
      source: published.source,
      policy: SPATIAL_VEGETATION_POLICY,
      epistemicStatus: isCheckpoint
        ? "study-constrained published BIOME4 model output at 777 ka"
        : "published BIOME4 777 ka category/NPP/LAI baseline + model-derived hydroclimate and CO2 productivity response; categorical biome transitions are not yet simulated"
    });
    this.cache.set(key, result);
    return result;
  }

  monthlyAt(globalState, month, latitude, longitude, spatialDetail = 0.35) {
    const annual = this.sample(globalState, latitude, longitude, spatialDetail);
    if (!annual) return null;
    const checkpointNpp = this.checkpoint.monthlyNppAt(month, annual.latitude, annual.longitude);
    if (!Number.isFinite(checkpointNpp)) return null;
    return Object.freeze({
      month,
      npp: round(checkpointNpp * annual.productivityFactor, 2),
      checkpointNpp: round(checkpointNpp, 2),
      productivityFactor: annual.productivityFactor,
      source: annual.source,
      policy: SPATIAL_VEGETATION_POLICY,
      epistemicStatus: annual.epistemicStatus
    });
  }

  diagnostics(globalState, spatialDetail = 0.35) {
    return Object.freeze({
      policy: SPATIAL_VEGETATION_POLICY,
      stateSignature: this._signature(globalState, spatialDetail),
      cachedCells: this.cache.size,
      checkpointSource: this.checkpoint.meta?.id ?? null,
      checkpointResolutionDegrees: this.checkpoint.meta?.spacingDegrees ?? null,
      epistemicStatus: "published BIOME4 checkpoint with deliberately limited continuous branch response; no claim of full BIOME4 PFT competition after 777 ka"
    });
  }
}
