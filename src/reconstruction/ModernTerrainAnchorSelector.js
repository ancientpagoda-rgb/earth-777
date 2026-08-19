import { bedrockElevationAt, ETOPO_2022_META } from "../data/generated/etopo-2022.generated.js";
import { EVIDENCE_RELATIONS } from "./EvidenceHarvester.js";

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0088;
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;

export const MODERN_TERRAIN_ANCHOR_POLICY = "measured-resolution-source-aware-anchor-v3";

const DIRECT_GEBCO_TID = new Set([10, 11, 12, 13, 14, 15, 16, 17]);
const INDIRECT_GEBCO_TID = new Set([40, 41, 42, 43, 44, 45, 46, 47, 48]);

export function gebcoTidMeasurementQuality(tid) {
  const code = Number(tid);
  if (code === 0) return 0.86;
  if (DIRECT_GEBCO_TID.has(code)) return 1.0;
  if (INDIRECT_GEBCO_TID.has(code)) return 0.72;
  if (code === 70) return 0.58;
  if (code === 71) return 0.46;
  if (code === 72) return 0.34;
  return 0.62;
}

function greatCircleDistanceKm(latA, lonA, latB, lonB) {
  if (![latA, lonA, latB, lonB].every(finite)) return null;
  const p1 = Number(latA) * DEG;
  const p2 = Number(latB) * DEG;
  const dp = (Number(latB) - Number(latA)) * DEG;
  const dl = wrapLongitude(Number(lonB) - Number(lonA)) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function fieldEligible(field) {
  return field == null || ["bedrockElevationMeters", "bathymetryMeters", "terrainMeters"].includes(field);
}

function measurementQuality(candidate) {
  if (finite(candidate?.tidCode)) return gebcoTidMeasurementQuality(candidate.tidCode);
  if (candidate?.directMeasurement || candidate?.measurementClass === "direct") return 1.0;
  // GMRT topo-mask certifies high-resolution coverage, not necessarily direct multibeam.
  if (candidate?.maskedHighResolution || candidate?.measurementClass === "high-resolution-mixed") return 0.90;
  if (candidate?.measurementClass === "predicted" || candidate?.measurementClass === "interpolated") return 0.70;
  if (candidate?.measurementClass === "mixed") return 0.78;
  if (candidate?.sourceId === "etopo-2022") return 0.74;
  return 0.80;
}

function resolutionQuality(resolutionMeters) {
  if (!finite(resolutionMeters) || Number(resolutionMeters) <= 0) return 0.72;
  const meters = Math.max(1, Number(resolutionMeters));
  return clamp01(1 / (1 + Math.log10(Math.max(1, meters / 25)) * 0.18));
}

function normalizeCandidate(candidate, latitude, longitude) {
  if (!candidate || !finite(candidate.value) || !fieldEligible(candidate.field)) return null;
  if (candidate.relation && candidate.relation !== EVIDENCE_RELATIONS.MODERN_ANCHOR) return null;
  const distanceKm = finite(candidate.distanceKm)
    ? Math.max(0, Number(candidate.distanceKm))
    : greatCircleDistanceKm(latitude, longitude, candidate.latitude, candidate.longitude);
  const resolutionMeters = finite(candidate.resolutionMeters) ? Math.max(1, Number(candidate.resolutionMeters)) : null;
  const spatialSupportKm = finite(candidate.spatialSupportKm)
    ? Math.max(0.001, Number(candidate.spatialSupportKm))
    : resolutionMeters != null ? Math.max(0.25, resolutionMeters / 500) : 1;
  if (distanceKm != null && distanceKm > spatialSupportKm) return null;
  const spatial = distanceKm == null ? (candidate.globalCoverage ? 1 : 0.72) : Math.exp(-distanceKm / spatialSupportKm);
  const sourceQuality = clamp01(candidate.sourceQuality ?? (candidate.sourceId === "etopo-2022" ? 0.90 : 0.86));
  const measured = measurementQuality(candidate);
  const resolution = resolutionQuality(resolutionMeters);
  const uncertainty = finite(candidate.sigma) && Number(candidate.sigma) > 0 ? 1 / (1 + Number(candidate.sigma) / 100) : 0.78;
  const score = clamp01(sourceQuality * measured * resolution * spatial * uncertainty);
  return Object.freeze({
    ...candidate,
    value: Number(candidate.value),
    sigma: finite(candidate.sigma) && Number(candidate.sigma) > 0 ? Number(candidate.sigma) : null,
    relation: EVIDENCE_RELATIONS.MODERN_ANCHOR,
    latitude: finite(candidate.latitude) ? Number(candidate.latitude) : null,
    longitude: finite(candidate.longitude) ? wrapLongitude(candidate.longitude) : null,
    distanceKm,
    resolutionMeters,
    spatialSupportKm,
    measurementQuality: measured,
    resolutionQuality: resolution,
    sourceQuality,
    anchorScore: score,
    anchorPolicy: MODERN_TERRAIN_ANCHOR_POLICY
  });
}

function rowCenterLatitude(row) {
  return ETOPO_2022_META.northLatitude - row * ETOPO_2022_META.latitudeStepDegrees;
}

function colCenterLongitude(col) {
  return wrapLongitude(ETOPO_2022_META.westLongitude + col * ETOPO_2022_META.longitudeStepDegrees);
}

function sampleCompactCell(row, col) {
  const clampedRow = clamp(row, 0, ETOPO_2022_META.rows - 1);
  const wrappedCol = ((col % ETOPO_2022_META.cols) + ETOPO_2022_META.cols) % ETOPO_2022_META.cols;
  return bedrockElevationAt(rowCenterLatitude(clampedRow), colCenterLongitude(wrappedCol));
}

/**
 * Bilinearly interpolate the compact browser ETOPO grid.
 *
 * The generated asset is intentionally compact (0.5° spacing) and its low-level
 * accessor returns the nearest stored cell. Using that nearest-cell accessor
 * directly in a regional mesh creates ~55 km rectangular elevation terraces.
 * Interpolation cannot recover detail discarded during compacting, but it does
 * restore a continuous large-scale relief field suitable for regional rendering.
 */
export function interpolatedEtopoBedrockElevationAt(latitude, longitude) {
  const lat = clamp(Number(latitude) || 0, -90, 90);
  const lon = wrapLongitude(longitude);
  const rowFloat = (ETOPO_2022_META.northLatitude - lat) / ETOPO_2022_META.latitudeStepDegrees;
  const row0 = clamp(Math.floor(rowFloat), 0, ETOPO_2022_META.rows - 1);
  const row1 = clamp(row0 + 1, 0, ETOPO_2022_META.rows - 1);
  const ty = row0 === row1 ? 0 : clamp(rowFloat - row0, 0, 1);

  const cols = ETOPO_2022_META.cols;
  const west = ETOPO_2022_META.westLongitude;
  const step = ETOPO_2022_META.longitudeStepDegrees;
  const span = cols * step;
  const unwrappedLon = ((lon - west) % span + span) % span;
  const colFloat = unwrappedLon / step;
  const col0 = Math.floor(colFloat) % cols;
  const col1 = (col0 + 1) % cols;
  const tx = clamp(colFloat - Math.floor(colFloat), 0, 1);

  const z00 = sampleCompactCell(row0, col0);
  const z10 = sampleCompactCell(row0, col1);
  const z01 = sampleCompactCell(row1, col0);
  const z11 = sampleCompactCell(row1, col1);
  return mix(mix(z00, z10, tx), mix(z01, z11, tx), ty);
}

const COMPACT_ETOPO_EFFECTIVE_RESOLUTION_METERS = Math.round(ETOPO_2022_META.sampleSpacingDegrees * 111_320);

function etopoFallback(latitude, longitude, sigmaMeters = null) {
  return normalizeCandidate({
    sourceId: "etopo-2022",
    field: "bedrockElevationMeters",
    value: interpolatedEtopoBedrockElevationAt(latitude, longitude),
    sigma: sigmaMeters,
    relation: EVIDENCE_RELATIONS.MODERN_ANCHOR,
    globalCoverage: true,
    resolutionMeters: COMPACT_ETOPO_EFFECTIVE_RESOLUTION_METERS,
    sourceQuality: 0.90,
    measurementClass: "interpolated",
    method: "bilinear interpolation of the compact 0.5° browser grid derived from ETOPO 2022 bedrock relief",
    note: "Guaranteed global fallback. The browser asset preserves broad modern relief continuously but only at ~0.5° effective spacing; higher-resolution measured anchors should replace it locally."
  }, latitude, longitude);
}

/**
 * Select the best modern solid-surface anchor at one location.
 *
 * This is not a 777 ka estimate. It only chooses the best present-day spatial
 * observation to be transformed by the reconstruction hindcast. Explicit direct
 * measurements are favored over masked high-resolution mixed coverage, which in
 * turn outranks predicted/interpolated cells when resolution and support permit.
 */
export function selectModernTerrainAnchor(latitude, longitude, candidates = [], {
  etopoSigmaMeters = null
} = {}) {
  const lat = Math.max(-90, Math.min(90, Number(latitude) || 0));
  const lon = wrapLongitude(longitude);
  const fallback = etopoFallback(lat, lon, etopoSigmaMeters);
  const ranked = [fallback, ...candidates.map((candidate) => normalizeCandidate(candidate, lat, lon)).filter(Boolean)]
    .sort((a, b) => b.anchorScore - a.anchorScore || (a.resolutionMeters ?? Infinity) - (b.resolutionMeters ?? Infinity) || String(a.sourceId).localeCompare(String(b.sourceId)));
  return Object.freeze({
    policy: MODERN_TERRAIN_ANCHOR_POLICY,
    latitude: lat,
    longitude: lon,
    selected: ranked[0],
    ranked: Object.freeze(ranked),
    fallbackSourceId: "etopo-2022",
    replacementUsed: ranked[0]?.sourceId !== "etopo-2022",
    epistemicRule: "Anchor selection chooses present-day spatial evidence only. The selected value must still undergo explicit 777 ka hindcast/assimilation before paleo interpretation."
  });
}
