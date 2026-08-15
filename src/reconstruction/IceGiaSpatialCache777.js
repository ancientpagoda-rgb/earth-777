import {
  GIA_777_OUTPUT_CELLS,
  GIA_777_RUN_METADATA,
  ICE_GIA_777_CACHE_META,
  ICE_LOAD_777_CELLS
} from "../data/generated/ice-gia-777.generated.js";
import { normalizeIceLoad777Cell } from "./SpatialIceLoad777.js";
import { normalizeGia777OutputCell, normalizeGia777RunMetadata } from "./GiaSolverOutputCache777.js";

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0088;
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;

function distanceKm(latA, lonA, latB, lonB) {
  if (![latA, lonA, latB, lonB].every(finite)) return null;
  const p1 = Number(latA) * DEG;
  const p2 = Number(latB) * DEG;
  const dp = (Number(latB) - Number(latA)) * DEG;
  const dl = wrapLongitude(Number(lonB) - Number(lonA)) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function nearest(records, latitude, longitude, maxDistanceKm, normalize) {
  let best = null;
  for (const raw of records) {
    const record = normalize(raw);
    if (record.latitude == null || record.longitude == null) continue;
    const d = distanceKm(latitude, longitude, record.latitude, record.longitude);
    if (d == null || d > maxDistanceKm) continue;
    if (!best || d < best.distanceKm) best = { record, distanceKm: d };
  }
  return best ? Object.freeze(best) : null;
}

export function iceGia777CacheStatus() {
  const run = normalizeGia777RunMetadata(GIA_777_RUN_METADATA);
  return Object.freeze({
    meta: ICE_GIA_777_CACHE_META,
    iceCellCount: ICE_LOAD_777_CELLS.length,
    giaCellCount: GIA_777_OUTPUT_CELLS.length,
    giaRun: run,
    hasIceCoverage: ICE_LOAD_777_CELLS.length > 0,
    hasGiaCoverage: GIA_777_OUTPUT_CELLS.length > 0 && run.validForTargetAssimilation,
    status: ICE_LOAD_777_CELLS.length === 0 && GIA_777_OUTPUT_CELLS.length === 0
      ? "unresolved-no-spatial-cache"
      : "spatial-cache-present"
  });
}

export function cachedIceLoad777At(latitude, longitude, maxDistanceKm = 25) {
  return nearest(ICE_LOAD_777_CELLS, latitude, longitude, Math.max(0, Number(maxDistanceKm) || 0), normalizeIceLoad777Cell);
}

export function cachedGia777At(latitude, longitude, maxDistanceKm = 25) {
  return nearest(
    GIA_777_OUTPUT_CELLS,
    latitude,
    longitude,
    Math.max(0, Number(maxDistanceKm) || 0),
    (record) => normalizeGia777OutputCell(record, GIA_777_RUN_METADATA)
  );
}
