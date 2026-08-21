const KM_PER_DEGREE_LATITUDE = 111.32;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;

export const SURFACE_STREAMING_POLICY = "camera-following-concentric-lod-v1";

export function streamingSegmentsForCandidate({ bandId = "regional", baseSegments = 18, distanceSquared = 0 } = {}) {
  const base = Math.max(6, Math.round(Number(baseSegments) || 18));
  const distance = Math.sqrt(Math.max(0, Number(distanceSquared) || 0));

  // Spend triangles where they are visible. The outer world buffer exists to
  // preserve continuity/horizon context, not to carry the same mesh density as
  // the inspection point under the camera target.
  if (distance < 0.75) {
    const multiplier = bandId === "regional" ? 1.72 : bandId === "landscape" ? 1.48 : 1.28;
    return Math.max(base, Math.min(48, Math.round(base * multiplier)));
  }
  if (distance < 1.6) return base;
  const multiplier = bandId === "regional" ? 0.56 : bandId === "landscape" ? 0.66 : 0.78;
  return Math.max(8, Math.round(base * multiplier));
}

export function localKilometersToGeographic(origin, xKm = 0, zKm = 0) {
  const latitude = clamp(Number(origin?.latitude) + Number(zKm) / KM_PER_DEGREE_LATITUDE, -89.85, 89.85);
  const longitudeScale = Math.max(12, KM_PER_DEGREE_LATITUDE * Math.cos(Number(origin?.latitude) * Math.PI / 180));
  const longitude = wrapLongitude(Number(origin?.longitude) + Number(xKm) / longitudeScale);
  return Object.freeze({ latitude, longitude });
}

export function quantizeRegionalTerrainCenter(latitude, longitude, stepDegrees = 0.25) {
  const step = clamp(stepDegrees, 0.05, 1);
  return Object.freeze({
    latitude: clamp(Math.round(Number(latitude) / step) * step, -89.5, 89.5),
    longitude: wrapLongitude(Math.round(Number(longitude) / step) * step)
  });
}

export function regionalPatchContainsFocus(patch, latitude, longitude, marginFraction = 0.22) {
  if (!patch) return false;
  const latSpan = Math.max(1e-6, Number(patch.north) - Number(patch.south));
  const lonSpan = Math.max(1e-6, Number(patch.east) - Number(patch.west));
  const margin = clamp(marginFraction, 0.05, 0.42);
  return Number(latitude) >= Number(patch.south) + latSpan * margin
    && Number(latitude) <= Number(patch.north) - latSpan * margin
    && Number(longitude) >= Number(patch.west) + lonSpan * margin
    && Number(longitude) <= Number(patch.east) - lonSpan * margin;
}

export function predictedRefinementCenter({
  origin,
  focusXKm = 0,
  focusZKm = 0,
  previousFocusXKm = focusXKm,
  previousFocusZKm = focusZKm,
  lookAheadKm = 18,
  quantizationDegrees = 0.25
} = {}) {
  const dx = Number(focusXKm) - Number(previousFocusXKm);
  const dz = Number(focusZKm) - Number(previousFocusZKm);
  const length = Math.hypot(dx, dz);
  const lead = length > 0.15 ? Math.min(Math.max(0, Number(lookAheadKm) || 0), 32) : 0;
  const leadX = length > 0 ? dx / length * lead : 0;
  const leadZ = length > 0 ? dz / length * lead : 0;
  const geographic = localKilometersToGeographic(origin, Number(focusXKm) + leadX, Number(focusZKm) + leadZ);
  return quantizeRegionalTerrainCenter(geographic.latitude, geographic.longitude, quantizationDegrees);
}
