import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";

const EARTH_RADIUS_METERS = 6_371_000;
const SOLAR_CONSTANT_MJ_M2_MIN = 0.0820;
const LATENT_HEAT_MJ_KG = 2.45;
const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;
const SECONDS_PER_MONTH = DAYS_PER_MONTH * 86_400;
const SECONDS_PER_YEAR = SECONDS_PER_MONTH * MONTHS_PER_YEAR;
const SOIL_CAPACITY_MM = 180;
const FIELD_CAPACITY_FRACTION = 0.65;
const MONTHLY_DRAINAGE_FRACTION = 0.35;
const DEGREE_DAY_MELT_MM_C_DAY = 3;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const toRadians = (degrees) => degrees * Math.PI / 180;
const round = (value, digits = 4) => Number(value.toFixed(digits));

export const CONSERVATIVE_HYDROLOGY_POLICY = "etopo-oudin-water-routing-v1";

export function routingSpacingForSpatialDetail(spatialDetail = 0.35) {
  // Global flow routing is deliberately capped at 2° in this browser phase.
  // Krapp/branch climate can still materialize at 0.5° for an observed region.
  return Number(spatialDetail) >= 0.58 ? 2 : 4;
}

export function extraterrestrialRadiationMjM2Day(latitude, monthIndex, obliquityDegrees = 23.3) {
  const latitudeRadians = toRadians(clamp(Number(latitude), -89.75, 89.75));
  const obliquity = toRadians(clamp(Number(obliquityDegrees) || 23.3, 20, 27));
  const midDay360 = mod(Math.floor(Number(monthIndex) || 0), 12) * DAYS_PER_MONTH + DAYS_PER_MONTH / 2;
  // Seasonal phase is tied to the March equinox in the source's 360-day
  // calendar. The branch's evolving obliquity controls declination amplitude.
  const solarLongitude = 2 * Math.PI * (midDay360 - 80) / 360;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(solarLongitude));
  const sunsetArgument = clamp(-Math.tan(latitudeRadians) * Math.tan(declination), -1, 1);
  const sunsetHourAngle = Math.acos(sunsetArgument);
  const radiation = (24 * 60 / Math.PI) * SOLAR_CONSTANT_MJ_M2_MIN * (
    sunsetHourAngle * Math.sin(latitudeRadians) * Math.sin(declination) +
    Math.cos(latitudeRadians) * Math.cos(declination) * Math.sin(sunsetHourAngle)
  );
  return Math.max(0, radiation);
}

export function oudinPotentialEvapotranspirationMmMonth(
  temperatureCelsius,
  latitude,
  monthIndex,
  obliquityDegrees = 23.3
) {
  const temperature = Number(temperatureCelsius);
  if (!Number.isFinite(temperature) || temperature <= -5) return 0;
  const radiation = extraterrestrialRadiationMjM2Day(latitude, monthIndex, obliquityDegrees);
  const millimetersPerDay = (radiation / LATENT_HEAT_MJ_KG) * ((temperature + 5) / 100);
  return Math.max(0, millimetersPerDay * DAYS_PER_MONTH);
}

export function stepWaterBucket({
  precipitationMm,
  temperatureCelsius,
  potentialEtMm,
  soilStorageMm,
  snowStorageMm,
  soilCapacityMm = SOIL_CAPACITY_MM
}) {
  const precipitation = Math.max(0, Number(precipitationMm) || 0);
  const temperature = Number(temperatureCelsius) || 0;
  const potentialEt = Math.max(0, Number(potentialEtMm) || 0);
  const capacity = Math.max(1, Number(soilCapacityMm) || SOIL_CAPACITY_MM);
  const initialSoil = clamp(Number(soilStorageMm) || 0, 0, capacity);
  const initialSnow = Math.max(0, Number(snowStorageMm) || 0);

  // Linear rain/snow partition from all-snow at -1 °C to all-rain at +1 °C.
  const snowFraction = clamp((1 - temperature) / 2, 0, 1);
  const snowfall = precipitation * snowFraction;
  const rainfall = precipitation - snowfall;
  let snow = initialSnow + snowfall;
  const meltPotential = Math.max(0, temperature) * DEGREE_DAY_MELT_MM_C_DAY * DAYS_PER_MONTH;
  const snowmelt = Math.min(snow, meltPotential);
  snow -= snowmelt;

  let soil = initialSoil + rainfall + snowmelt;
  const actualEt = Math.min(potentialEt, soil);
  soil -= actualEt;

  const saturationRunoff = Math.max(0, soil - capacity);
  soil -= saturationRunoff;
  const fieldCapacity = capacity * FIELD_CAPACITY_FRACTION;
  const drainable = Math.max(0, soil - fieldCapacity);
  const drainageRunoff = drainable * MONTHLY_DRAINAGE_FRACTION;
  soil -= drainageRunoff;
  const runoff = saturationRunoff + drainageRunoff;

  const storageChange = (soil + snow) - (initialSoil + initialSnow);
  const closureError = precipitation - actualEt - runoff - storageChange;

  return Object.freeze({
    precipitationMm: precipitation,
    rainfallMm: rainfall,
    snowfallMm: snowfall,
    snowmeltMm: snowmelt,
    potentialEtMm: potentialEt,
    actualEtMm: actualEt,
    runoffMm: runoff,
    saturationRunoffMm: saturationRunoff,
    drainageRunoffMm: drainageRunoff,
    soilStorageMm: soil,
    snowStorageMm: snow,
    storageChangeMm: storageChange,
    closureErrorMm: closureError
  });
}

function cellAreaSquareMeters(row, spacingDegrees) {
  const north = 90 - row * spacingDegrees;
  const south = Math.max(-90, north - spacingDegrees);
  const deltaLongitude = toRadians(spacingDegrees);
  return EARTH_RADIUS_METERS ** 2 * deltaLongitude * (
    Math.sin(toRadians(north)) - Math.sin(toRadians(south))
  );
}

function cellCenter(row, col, spacingDegrees) {
  return {
    latitude: 90 - (row + 0.5) * spacingDegrees,
    longitude: -180 + (col + 0.5) * spacingDegrees
  };
}

function nearestCell(latitude, longitude, spacingDegrees, rows, cols) {
  const lat = clamp(Number(latitude), -90, 90);
  const lon = mod(Number(longitude) + 180, 360);
  const row = clamp(Math.floor((90 - lat) / spacingDegrees), 0, rows - 1);
  const col = mod(Math.floor(lon / spacingDegrees), cols);
  return row * cols + col;
}

export function buildDrainageTopology(spacingDegrees, seaLevelMeters) {
  const spacing = Number(spacingDegrees);
  if (![1, 2, 4].includes(spacing)) throw new RangeError(`Unsupported drainage spacing ${spacing}`);
  const rows = Math.round(180 / spacing);
  const cols = Math.round(360 / spacing);
  const count = rows * cols;
  const elevation = new Float32Array(count);
  const land = new Uint8Array(count);
  const downstream = new Int32Array(count);
  const areaSquareMeters = new Float64Array(count);
  downstream.fill(-3);

  for (let row = 0; row < rows; row += 1) {
    const area = cellAreaSquareMeters(row, spacing);
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const center = cellCenter(row, col, spacing);
      const z = bedrockElevationAt(center.latitude, center.longitude);
      elevation[index] = z;
      land[index] = z > seaLevelMeters ? 1 : 0;
      areaSquareMeters[index] = area;
    }
  }

  const landIndices = [];
  let oceanOutletCells = 0;
  let endorheicSinkCells = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      if (!land[index]) {
        downstream[index] = -3;
        continue;
      }
      landIndices.push(index);
      let bestElevation = elevation[index];
      let bestIndex = -2; // no lower neighbor -> endorheic sink
      let bestIsOcean = false;

      for (let dr = -1; dr <= 1; dr += 1) {
        const rr = row + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const cc = mod(col + dc, cols);
          const neighbor = rr * cols + cc;
          const neighborElevation = elevation[neighbor];
          if (neighborElevation < bestElevation - 0.01) {
            bestElevation = neighborElevation;
            bestIndex = neighbor;
            bestIsOcean = !land[neighbor];
          }
        }
      }

      if (bestIndex >= 0 && bestIsOcean) {
        downstream[index] = -1;
        oceanOutletCells += 1;
      } else if (bestIndex >= 0) {
        downstream[index] = bestIndex;
      } else {
        downstream[index] = -2;
        endorheicSinkCells += 1;
      }
    }
  }

  landIndices.sort((a, b) => elevation[b] - elevation[a] || a - b);
  return Object.freeze({
    spacingDegrees: spacing,
    rows,
    cols,
    count,
    seaLevelMeters,
    elevation,
    land,
    downstream,
    areaSquareMeters,
    routingOrder: Int32Array.from(landIndices),
    landCellCount: landIndices.length,
    oceanOutletCells,
    endorheicSinkCells
  });
}

export function routeRunoffVolumes(localRunoffVolumeM3, topology) {
  if (localRunoffVolumeM3.length !== topology.count) throw new RangeError("Runoff array does not match topology");
  const accumulated = Float64Array.from(localRunoffVolumeM3);
  let oceanVolumeM3 = 0;
  let endorheicVolumeM3 = 0;

  for (const index of topology.routingOrder) {
    const volume = accumulated[index];
    if (volume === 0) continue;
    const downstream = topology.downstream[index];
    if (downstream >= 0) accumulated[downstream] += volume;
    else if (downstream === -1) oceanVolumeM3 += volume;
    else if (downstream === -2) endorheicVolumeM3 += volume;
  }

  const localTotalM3 = localRunoffVolumeM3.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    accumulatedVolumeM3: accumulated,
    localTotalM3,
    oceanVolumeM3,
    endorheicVolumeM3,
    routingClosureErrorM3: localTotalM3 - oceanVolumeM3 - endorheicVolumeM3
  });
}

export class ConservativeHydrology {
  constructor(spatialHydroClimate) {
    if (!spatialHydroClimate?.monthlyAt || !spatialHydroClimate?.sample) {
      throw new TypeError("ConservativeHydrology requires SpatialHydroClimate");
    }
    this.climate = spatialHydroClimate;
    this.topologyCache = new Map();
    this.snapshotCache = new Map();
  }

  _signature(globalState, spacing) {
    return [
      spacing,
      round(globalState.temperatureAnomaly ?? 0, 3),
      round(globalState.iceIndex ?? 0, 4),
      round(globalState.seaLevel ?? 0, 1),
      round(globalState.obliquity ?? 23.3, 3)
    ].join("|");
  }

  _topology(spacing, seaLevelMeters) {
    const key = `${spacing}|${round(seaLevelMeters, 1)}`;
    if (!this.topologyCache.has(key)) {
      this.topologyCache.set(key, buildDrainageTopology(spacing, seaLevelMeters));
      if (this.topologyCache.size > 4) this.topologyCache.delete(this.topologyCache.keys().next().value);
    }
    return this.topologyCache.get(key);
  }

  compute(globalState, spatialDetail = 0.35) {
    const spacing = routingSpacingForSpatialDetail(spatialDetail);
    const signature = this._signature(globalState, spacing);
    if (this.snapshotCache.has(signature)) return this.snapshotCache.get(signature);

    const topology = this._topology(spacing, Number(globalState.seaLevel) || 0);
    const count = topology.count;
    const annualPrecipitationMm = new Float32Array(count);
    const annualPotentialEtMm = new Float32Array(count);
    const annualActualEtMm = new Float32Array(count);
    const annualRunoffMm = new Float32Array(count);
    const finalSoilStorageMm = new Float32Array(count);
    const finalSnowStorageMm = new Float32Array(count);
    const annualRoutedVolumeM3 = new Float64Array(count);
    const peakDischargeM3s = new Float32Array(count);
    const initialCombinedStorageMm = new Float32Array(count);
    const soilStorage = new Float64Array(count);
    const snowStorage = new Float64Array(count);
    const activeClimate = new Uint8Array(count);

    let landPrecipitationM3 = 0;
    let actualEtM3 = 0;
    let localRunoffM3 = 0;
    let activeLandCells = 0;

    for (let row = 0; row < topology.rows; row += 1) {
      for (let col = 0; col < topology.cols; col += 1) {
        const index = row * topology.cols + col;
        if (!topology.land[index]) continue;
        const center = cellCenter(row, col, spacing);
        const annualClimate = this.climate.sample(globalState, center.latitude, center.longitude, spatialDetail);
        if (!annualClimate || !Number.isFinite(annualClimate.temperatureCelsius)) continue;
        activeClimate[index] = 1;
        activeLandCells += 1;
        const initialFraction = Number.isFinite(annualClimate.soilMoistureIndex)
          ? clamp(annualClimate.soilMoistureIndex, 0.08, 0.95)
          : 0.5;
        soilStorage[index] = SOIL_CAPACITY_MM * initialFraction;
        initialCombinedStorageMm[index] = soilStorage[index];
      }
    }

    let oceanDischargeM3 = 0;
    let endorheicRetentionM3 = 0;

    for (let month = 0; month < MONTHS_PER_YEAR; month += 1) {
      const localRunoffVolumeM3 = new Float64Array(count);

      for (let row = 0; row < topology.rows; row += 1) {
        for (let col = 0; col < topology.cols; col += 1) {
          const index = row * topology.cols + col;
          if (!activeClimate[index]) continue;
          const center = cellCenter(row, col, spacing);
          const climate = this.climate.monthlyAt(globalState, month, center.latitude, center.longitude, spatialDetail);
          if (!climate || !Number.isFinite(climate.precipitationMmThisMonth)) continue;

          const pet = oudinPotentialEvapotranspirationMmMonth(
            climate.temperatureCelsius,
            center.latitude,
            month,
            globalState.obliquity
          );
          const step = stepWaterBucket({
            precipitationMm: climate.precipitationMmThisMonth,
            temperatureCelsius: climate.temperatureCelsius,
            potentialEtMm: pet,
            soilStorageMm: soilStorage[index],
            snowStorageMm: snowStorage[index]
          });
          soilStorage[index] = step.soilStorageMm;
          snowStorage[index] = step.snowStorageMm;
          annualPrecipitationMm[index] += step.precipitationMm;
          annualPotentialEtMm[index] += step.potentialEtMm;
          annualActualEtMm[index] += step.actualEtMm;
          annualRunoffMm[index] += step.runoffMm;

          const area = topology.areaSquareMeters[index];
          const precipitationVolume = step.precipitationMm / 1000 * area;
          const etVolume = step.actualEtMm / 1000 * area;
          const runoffVolume = step.runoffMm / 1000 * area;
          landPrecipitationM3 += precipitationVolume;
          actualEtM3 += etVolume;
          localRunoffM3 += runoffVolume;
          localRunoffVolumeM3[index] = runoffVolume;
        }
      }

      const routed = routeRunoffVolumes(localRunoffVolumeM3, topology);
      oceanDischargeM3 += routed.oceanVolumeM3;
      endorheicRetentionM3 += routed.endorheicVolumeM3;
      for (let index = 0; index < count; index += 1) {
        const volume = routed.accumulatedVolumeM3[index];
        annualRoutedVolumeM3[index] += volume;
        peakDischargeM3s[index] = Math.max(peakDischargeM3s[index], volume / SECONDS_PER_MONTH);
      }
    }

    let storageChangeM3 = 0;
    for (let index = 0; index < count; index += 1) {
      if (!activeClimate[index]) continue;
      finalSoilStorageMm[index] = soilStorage[index];
      finalSnowStorageMm[index] = snowStorage[index];
      const deltaStorageMm = soilStorage[index] + snowStorage[index] - initialCombinedStorageMm[index];
      storageChangeM3 += deltaStorageMm / 1000 * topology.areaSquareMeters[index];
    }

    const closureErrorM3 = landPrecipitationM3 - actualEtM3 - oceanDischargeM3 - endorheicRetentionM3 - storageChangeM3;
    const routedClosureErrorM3 = localRunoffM3 - oceanDischargeM3 - endorheicRetentionM3;
    const result = Object.freeze({
      policy: CONSERVATIVE_HYDROLOGY_POLICY,
      epistemicStatus: "model derived water balance and downhill routing; Oudin PET is literature grounded, soil/snow bucket parameters are provisional priors",
      spacingDegrees: spacing,
      topology,
      activeLandCells,
      annualPrecipitationMm,
      annualPotentialEtMm,
      annualActualEtMm,
      annualRunoffMm,
      finalSoilStorageMm,
      finalSnowStorageMm,
      annualRoutedVolumeM3,
      peakDischargeM3s,
      budget: Object.freeze({
        precipitationM3: landPrecipitationM3,
        actualEtM3,
        localRunoffM3,
        oceanDischargeM3,
        endorheicRetentionM3,
        storageChangeM3,
        closureErrorM3,
        relativeClosureError: landPrecipitationM3 > 0 ? closureErrorM3 / landPrecipitationM3 : 0,
        routingClosureErrorM3: routedClosureErrorM3,
        relativeRoutingClosureError: localRunoffM3 > 0 ? routedClosureErrorM3 / localRunoffM3 : 0
      })
    });

    this.snapshotCache.set(signature, result);
    if (this.snapshotCache.size > 3) this.snapshotCache.delete(this.snapshotCache.keys().next().value);
    return result;
  }

  sample(globalState, latitude, longitude, spatialDetail = 0.35) {
    const snapshot = this.compute(globalState, spatialDetail);
    const index = nearestCell(
      latitude,
      longitude,
      snapshot.spacingDegrees,
      snapshot.topology.rows,
      snapshot.topology.cols
    );
    if (!snapshot.topology.land[index]) return null;
    const row = Math.floor(index / snapshot.topology.cols);
    const col = index % snapshot.topology.cols;
    const center = cellCenter(row, col, snapshot.spacingDegrees);
    const annualDischargeM3s = snapshot.annualRoutedVolumeM3[index] / SECONDS_PER_YEAR;
    const downstream = snapshot.topology.downstream[index];
    return Object.freeze({
      latitude: center.latitude,
      longitude: center.longitude,
      routingSpacingDegrees: snapshot.spacingDegrees,
      elevationMeters: snapshot.topology.elevation[index],
      annualPrecipitationMm: snapshot.annualPrecipitationMm[index],
      potentialEtMm: snapshot.annualPotentialEtMm[index],
      actualEtMm: snapshot.annualActualEtMm[index],
      localRunoffMm: snapshot.annualRunoffMm[index],
      soilStorageMm: snapshot.finalSoilStorageMm[index],
      snowStorageMm: snapshot.finalSnowStorageMm[index],
      meanDischargeM3s: annualDischargeM3s,
      peakMonthlyDischargeM3s: snapshot.peakDischargeM3s[index],
      downstream: downstream === -1 ? "ocean" : downstream === -2 ? "endorheic sink" : downstream >= 0 ? "downstream land cell" : "ocean cell",
      policy: snapshot.policy,
      epistemicStatus: snapshot.epistemicStatus,
      globalWaterBudgetRelativeError: snapshot.budget.relativeClosureError,
      routingBudgetRelativeError: snapshot.budget.relativeRoutingClosureError
    });
  }

  diagnostics(globalState, spatialDetail = 0.35) {
    const snapshot = this.compute(globalState, spatialDetail);
    return Object.freeze({
      policy: snapshot.policy,
      spacingDegrees: snapshot.spacingDegrees,
      activeLandCells: snapshot.activeLandCells,
      landCellCount: snapshot.topology.landCellCount,
      oceanOutletCells: snapshot.topology.oceanOutletCells,
      endorheicSinkCells: snapshot.topology.endorheicSinkCells,
      budget: snapshot.budget,
      epistemicStatus: snapshot.epistemicStatus
    });
  }
}
