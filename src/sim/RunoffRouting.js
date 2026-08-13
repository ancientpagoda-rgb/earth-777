import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";

const EARTH_RADIUS_KM = 6371.0088;
const SECONDS_PER_YEAR = 365.2425 * 86_400;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const round = (value, digits = 4) => Number(value.toFixed(digits));

export const RUNOFF_ROUTING_POLICY = "etopo-d8-parcel-routing-v1";
export const RIVER_NETWORK_POLICY = "etopo-d8-upstream-network-v1";

function wrapLongitude(longitude) {
  return mod(Number(longitude) + 180, 360) - 180;
}

function cellCenter(latitude, longitude, spacingDegrees) {
  const spacing = clamp(spacingDegrees, 0.5, 8);
  const rows = Math.round(180 / spacing);
  const cols = Math.round(360 / spacing);
  const row = clamp(Math.floor((90 - clamp(latitude, -90, 90)) / spacing), 0, rows - 1);
  const col = mod(Math.floor((wrapLongitude(longitude) + 180) / spacing), cols);
  return {
    latitude: 90 - (row + 0.5) * spacing,
    longitude: -180 + (col + 0.5) * spacing,
    row,
    col,
    rows,
    cols,
    spacing
  };
}

function cellFromIndex(index, rows, cols, spacing) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return {
    latitude: 90 - (row + 0.5) * spacing,
    longitude: -180 + (col + 0.5) * spacing,
    row,
    col,
    rows,
    cols,
    spacing
  };
}

function neighborCell(cell, dRow, dCol) {
  const row = cell.row + dRow;
  if (row < 0 || row >= cell.rows) return null;
  const col = mod(cell.col + dCol, cell.cols);
  return {
    ...cell,
    row,
    col,
    latitude: 90 - (row + 0.5) * cell.spacing,
    longitude: -180 + (col + 0.5) * cell.spacing
  };
}

function greatCircleDistanceKm(a, b) {
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function gridCellAreaKm2(latitude, spacingDegrees) {
  const spacing = clamp(spacingDegrees, 0.5, 8);
  const center = clamp(latitude, -90 + spacing / 2, 90 - spacing / 2);
  const latSouth = (center - spacing / 2) * Math.PI / 180;
  const latNorth = (center + spacing / 2) * Math.PI / 180;
  const dLon = spacing * Math.PI / 180;
  return EARTH_RADIUS_KM ** 2 * dLon * Math.abs(Math.sin(latNorth) - Math.sin(latSouth));
}

function bestDownhillNeighbor(cell, elevationMeters) {
  let best = null;
  for (let dRow = -1; dRow <= 1; dRow += 1) {
    for (let dCol = -1; dCol <= 1; dCol += 1) {
      if (dRow === 0 && dCol === 0) continue;
      const neighbor = neighborCell(cell, dRow, dCol);
      if (!neighbor) continue;
      const neighborElevation = bedrockElevationAt(neighbor.latitude, neighbor.longitude);
      if (!Number.isFinite(neighborElevation) || neighborElevation >= elevationMeters - 0.01) continue;
      const distanceKm = Math.max(1e-6, greatCircleDistanceKm(cell, neighbor));
      const slope = (elevationMeters - neighborElevation) / (distanceKm * 1000);
      if (!best || slope > best.slope) {
        best = { cell: neighbor, elevationMeters: neighborElevation, slope, distanceKm };
      }
    }
  }
  return best;
}

export function routeRunoffParcel(
  latitude,
  longitude,
  runoffMmPerYear,
  {
    spacingDegrees = 1,
    seaLevelMeters = 0,
    maxSteps = 512
  } = {}
) {
  const origin = cellCenter(latitude, longitude, spacingDegrees);
  const originElevation = bedrockElevationAt(origin.latitude, origin.longitude);
  const areaKm2 = gridCellAreaKm2(origin.latitude, origin.spacing);
  const runoffDepth = Math.max(0, Number(runoffMmPerYear) || 0);
  const annualVolumeM3 = runoffDepth * areaKm2 * 1000;
  const path = [];
  const visited = new Set();
  let current = origin;
  let elevationMeters = originElevation;
  let outlet = "sink";

  for (let step = 0; step < Math.max(1, Math.min(4096, Math.floor(maxSteps) || 1)); step += 1) {
    const key = `${current.row}:${current.col}`;
    if (visited.has(key)) {
      outlet = "loop-guard";
      break;
    }
    visited.add(key);
    path.push(Object.freeze({
      latitude: round(current.latitude, 4),
      longitude: round(current.longitude, 4),
      elevationMeters: round(elevationMeters, 1),
      annualVolumeM3: round(annualVolumeM3, 2)
    }));

    if (elevationMeters <= seaLevelMeters) {
      outlet = "ocean";
      break;
    }

    const downhill = bestDownhillNeighbor(current, elevationMeters);
    if (!downhill) {
      outlet = "closed-basin sink";
      break;
    }
    current = downhill.cell;
    elevationMeters = downhill.elevationMeters;
    if (step === maxSteps - 1) outlet = "step-limit";
  }

  return Object.freeze({
    policy: RUNOFF_ROUTING_POLICY,
    spacingDegrees: origin.spacing,
    sourceLatitude: round(origin.latitude, 4),
    sourceLongitude: round(origin.longitude, 4),
    sourceElevationMeters: round(originElevation, 1),
    sourceCellAreaKm2: round(areaKm2, 3),
    runoffMmPerYear: round(runoffDepth, 3),
    annualVolumeM3: round(annualVolumeM3, 2),
    outlet,
    path: Object.freeze(path),
    massConserved: path.every((point) => Math.abs(point.annualVolumeM3 - round(annualVolumeM3, 2)) < 0.01),
    epistemicStatus: "model-derived D8-style parcel routing over compact modern ETOPO bedrock with simulated sea level; no groundwater, lake storage, channel hydraulics, or upstream accumulation"
  });
}

export function networkSpacingForSpatialDetail(spatialDetail = 0.35) {
  // Network accumulation is intentionally coarser than observed local climate.
  // This is CWF/browser compute policy, not a scientific resolution claim.
  return clamp(Number(spatialDetail) || 0, 0, 1) >= 0.82 ? 2 : 4;
}

export function buildRunoffNetworkTopology({ spacingDegrees = 4, seaLevelMeters = 0 } = {}) {
  const spacing = Number(spacingDegrees);
  if (![2, 4].includes(spacing)) {
    throw new RangeError(`River-network topology supports 2° or 4° routing, received ${spacingDegrees}`);
  }
  const rows = Math.round(180 / spacing);
  const cols = Math.round(360 / spacing);
  const count = rows * cols;
  const elevationMeters = new Float32Array(count);
  const landMask = new Uint8Array(count);
  const downstream = new Int32Array(count);
  const cellAreaKm2 = new Float64Array(count);
  downstream.fill(-3); // -3 ocean/non-land, -2 closed sink, -1 ocean outlet.

  const landIndices = [];
  let oceanOutletCells = 0;
  let closedBasinSinkCells = 0;

  for (let index = 0; index < count; index += 1) {
    const cell = cellFromIndex(index, rows, cols, spacing);
    const elevation = bedrockElevationAt(cell.latitude, cell.longitude);
    elevationMeters[index] = elevation;
    cellAreaKm2[index] = gridCellAreaKm2(cell.latitude, spacing);
    if (!(elevation > seaLevelMeters)) continue;
    landMask[index] = 1;
    landIndices.push(index);
  }

  for (const index of landIndices) {
    const cell = cellFromIndex(index, rows, cols, spacing);
    const downhill = bestDownhillNeighbor(cell, elevationMeters[index]);
    if (!downhill) {
      downstream[index] = -2;
      closedBasinSinkCells += 1;
      continue;
    }
    if (downhill.elevationMeters <= seaLevelMeters) {
      downstream[index] = -1;
      oceanOutletCells += 1;
      continue;
    }
    downstream[index] = downhill.cell.row * cols + downhill.cell.col;
  }

  landIndices.sort((a, b) => elevationMeters[b] - elevationMeters[a] || a - b);
  return Object.freeze({
    policy: RIVER_NETWORK_POLICY,
    spacingDegrees: spacing,
    seaLevelMeters: Number(seaLevelMeters) || 0,
    rows,
    cols,
    count,
    elevationMeters,
    landMask,
    downstream,
    cellAreaKm2,
    routingOrder: Int32Array.from(landIndices),
    landCellCount: landIndices.length,
    oceanOutletCells,
    closedBasinSinkCells,
    epistemicStatus: "model-derived D8-style topology over compact modern ETOPO bedrock and simulated sea level"
  });
}

export function accumulateRunoffNetwork(topology, localRunoffMmPerYear) {
  if (!topology?.routingOrder || !topology?.downstream || !topology?.cellAreaKm2) {
    throw new TypeError("accumulateRunoffNetwork requires a runoff-network topology");
  }
  if (!localRunoffMmPerYear || localRunoffMmPerYear.length !== topology.count) {
    throw new RangeError(`Local runoff array length must equal topology cell count ${topology.count}`);
  }

  const localAnnualVolumeM3 = new Float64Array(topology.count);
  const accumulatedAnnualVolumeM3 = new Float64Array(topology.count);
  const upstreamAreaKm2 = new Float64Array(topology.count);
  const upstreamCellCount = new Uint32Array(topology.count);
  let localRunoffTotalM3 = 0;

  for (const index of topology.routingOrder) {
    const runoffMm = Math.max(0, Number(localRunoffMmPerYear[index]) || 0);
    const localVolume = runoffMm * topology.cellAreaKm2[index] * 1000;
    localAnnualVolumeM3[index] = localVolume;
    accumulatedAnnualVolumeM3[index] = localVolume;
    upstreamAreaKm2[index] = topology.cellAreaKm2[index];
    upstreamCellCount[index] = 1;
    localRunoffTotalM3 += localVolume;
  }

  let oceanDischargeM3 = 0;
  let closedBasinRetentionM3 = 0;
  let oceanDrainageAreaKm2 = 0;
  let closedBasinDrainageAreaKm2 = 0;

  // Strictly downhill links make descending elevation a valid topological order.
  for (const index of topology.routingOrder) {
    const downstreamIndex = topology.downstream[index];
    if (downstreamIndex >= 0) {
      accumulatedAnnualVolumeM3[downstreamIndex] += accumulatedAnnualVolumeM3[index];
      upstreamAreaKm2[downstreamIndex] += upstreamAreaKm2[index];
      upstreamCellCount[downstreamIndex] += upstreamCellCount[index];
    } else if (downstreamIndex === -1) {
      oceanDischargeM3 += accumulatedAnnualVolumeM3[index];
      oceanDrainageAreaKm2 += upstreamAreaKm2[index];
    } else if (downstreamIndex === -2) {
      closedBasinRetentionM3 += accumulatedAnnualVolumeM3[index];
      closedBasinDrainageAreaKm2 += upstreamAreaKm2[index];
    }
  }

  const closureErrorM3 = localRunoffTotalM3 - oceanDischargeM3 - closedBasinRetentionM3;
  const meanDischargeM3s = new Float64Array(topology.count);
  for (const index of topology.routingOrder) {
    meanDischargeM3s[index] = accumulatedAnnualVolumeM3[index] / SECONDS_PER_YEAR;
  }

  return Object.freeze({
    policy: RIVER_NETWORK_POLICY,
    localAnnualVolumeM3,
    accumulatedAnnualVolumeM3,
    meanDischargeM3s,
    upstreamAreaKm2,
    upstreamCellCount,
    localRunoffTotalM3,
    oceanDischargeM3,
    closedBasinRetentionM3,
    oceanDrainageAreaKm2,
    closedBasinDrainageAreaKm2,
    closureErrorM3,
    relativeClosureError: localRunoffTotalM3 > 0 ? closureErrorM3 / localRunoffTotalM3 : 0,
    massConserved: Math.abs(closureErrorM3) <= Math.max(1e-6, localRunoffTotalM3 * 1e-12),
    epistemicStatus: "model-derived upstream accumulation of closed local runoff; no channel storage, transmission loss, groundwater exchange, lake evaporation, or floodplain hydraulics"
  });
}

export function networkCellAt(topology, latitude, longitude) {
  const cell = cellCenter(latitude, longitude, topology.spacingDegrees);
  const index = cell.row * topology.cols + cell.col;
  return Object.freeze({ ...cell, index });
}
