import { GMRT_MODERN_ANCHORS, GMRT_MODERN_ANCHOR_META } from "../data/generated/gmrt-modern-anchors.generated.js";

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0088;
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;

function distanceKm(latA, lonA, latB, lonB) {
  if (![latA, lonA, latB, lonB].every(finite)) return Infinity;
  const p1 = Number(latA) * DEG;
  const p2 = Number(latB) * DEG;
  const dp = (Number(latB) - Number(latA)) * DEG;
  const dl = wrapLongitude(Number(lonB) - Number(lonA)) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/**
 * Return generated high-resolution modern anchors near a requested location.
 * These remain modern observations; TerrainReconstruction777 decides whether and
 * how they enter the checkpoint hindcast.
 */
export function cachedModernTerrainAnchorCandidatesAt(latitude, longitude, radiusKm = 1) {
  const radius = Math.max(0.001, Number(radiusKm) || 1);
  return Object.freeze(GMRT_MODERN_ANCHORS
    .map((record) => ({ record, distanceKm: distanceKm(latitude, longitude, record.latitude, record.longitude) }))
    .filter(({ distanceKm: d }) => d <= radius)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map(({ record, distanceKm: d }) => Object.freeze({
      ...record,
      distanceKm: d,
      spatialSupportKm: record.spatialSupportKm ?? Math.max(radius, 0.25)
    })));
}

export function modernTerrainAnchorCacheMeta() {
  return GMRT_MODERN_ANCHOR_META;
}
