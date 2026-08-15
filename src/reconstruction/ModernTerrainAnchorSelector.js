import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";
import { EVIDENCE_RELATIONS } from "./EvidenceHarvester.js";

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0088;
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;

export const MODERN_TERRAIN_ANCHOR_POLICY = "measured-resolution-source-aware-anchor-v2";

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

function etopoFallback(latitude, longitude, sigmaMeters = null) {
  return normalizeCandidate({
    sourceId: "etopo-2022",
    field: "bedrockElevationMeters",
    value: bedrockElevationAt(latitude, longitude),
    sigma: sigmaMeters,
    relation: EVIDENCE_RELATIONS.MODERN_ANCHOR,
    globalCoverage: true,
    resolutionMeters: 464,
    sourceQuality: 0.90,
    measurementClass: "mixed",
    method: "ETOPO 2022 15 arc-second global bedrock/bathymetry anchor",
    note: "Guaranteed global fallback; higher-resolution measured anchors may replace it locally."
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
