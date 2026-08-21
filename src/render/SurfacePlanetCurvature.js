export const EARTH_MEAN_RADIUS_KM = 6371.0088;
export const SURFACE_CURVATURE_POLICY = "distance-blended-local-spherical-cap-v1";

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

export function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function surfaceCurvatureBlend(distanceKm, {
  startKm = 140,
  fullKm = 320
} = {}) {
  const distance = Math.max(0, Number(distanceKm) || 0);
  const start = Math.max(0, Number(startKm) || 0);
  const full = Math.max(start + 1e-6, Number(fullKm) || start + 1);
  return smoothstep01((distance - start) / (full - start));
}

export function tangentSphereDropKm(horizontalDistanceKm, radiusKm = EARTH_MEAN_RADIUS_KM) {
  const radius = Math.max(1, Number(radiusKm) || EARTH_MEAN_RADIUS_KM);
  const distance = Math.min(Math.abs(Number(horizontalDistanceKm) || 0), radius * 0.999999);
  return radius - Math.sqrt(Math.max(0, radius * radius - distance * distance));
}
