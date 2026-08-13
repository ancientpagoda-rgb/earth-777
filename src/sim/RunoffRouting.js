import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";

const EARTH_RADIUS_KM = 6371.0088;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;
const round = (value, digits = 4) => Number(value.toFixed(digits));

export const RUNOFF_ROUTING_POLICY = "etopo-d8-parcel-routing-v1";

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
    epistemicStatus: "model-derived D8-style parcel routing over compact modern ETOPO bedrock with simulated sea level; no groundwater, lake storage, channel hydraulics, or upstream accumulation yet"
  });
}
