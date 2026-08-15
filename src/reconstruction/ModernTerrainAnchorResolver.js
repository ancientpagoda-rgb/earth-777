import { topographyEvidenceSourceById } from "./TopographyEvidenceSources.js";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export const MODERN_TERRAIN_ANCHOR_POLICY = "best-local-anchor-correlated-source-selection-v1";

export const BATHYMETRY_SOURCE_CLASS = Object.freeze({
  LAND: "land",
  SINGLEBEAM: "singlebeam",
  MULTIBEAM: "multibeam",
  SEISMIC: "seismic",
  ISOLATED_SOUNDING: "isolated-sounding",
  ENC_SOUNDING: "enc-sounding",
  INTERPOLATED: "interpolated",
  PREDICTED: "predicted",
  UNKNOWN: "unknown"
});

const SOURCE_CLASS_PRIOR = Object.freeze({
  [BATHYMETRY_SOURCE_CLASS.MULTIBEAM]: 1.00,
  [BATHYMETRY_SOURCE_CLASS.SINGLEBEAM]: 0.94,
  [BATHYMETRY_SOURCE_CLASS.SEISMIC]: 0.91,
  [BATHYMETRY_SOURCE_CLASS.ENC_SOUNDING]: 0.89,
  [BATHYMETRY_SOURCE_CLASS.ISOLATED_SOUNDING]: 0.84,
  [BATHYMETRY_SOURCE_CLASS.LAND]: 0.82,
  [BATHYMETRY_SOURCE_CLASS.INTERPOLATED]: 0.66,
  [BATHYMETRY_SOURCE_CLASS.PREDICTED]: 0.58,
  [BATHYMETRY_SOURCE_CLASS.UNKNOWN]: 0.62
});

const SOURCE_ROLE_PRIOR = Object.freeze({
  "polar-subglacial-bed": 1.00,
  "multi-resolution-modern-topography": 0.97,
  "arctic-modern-bathymetry": 0.96,
  "global-modern-bathymetry": 0.90,
  "global-modern-relief": 0.84,
  "global-modern-land-dem": 0.80,
  "polar-modern-surface-dem": 0.55
});

function resolutionMeters(candidate, source) {
  if (finite(candidate?.resolutionMeters) && Number(candidate.resolutionMeters) > 0) return Number(candidate.resolutionMeters);
  const text = String(source?.spatialResolution ?? "");
  const match = text.match(/([0-9.]+)\s*m\b/i);
  if (match) return Number(match[1]);
  if (/15 arc-second/i.test(text)) return 450;
  if (/30 m/i.test(text)) return 30;
  return null;
}

function resolutionFactor(meters) {
  if (!finite(meters) || Number(meters) <= 0) return 0.72;
  const m = Number(meters);
  return clamp01(1 / (1 + Math.log10(Math.max(1, m)) / 5));
}

function uncertaintyFactor(sigmaMeters) {
  if (!finite(sigmaMeters) || Number(sigmaMeters) <= 0) return 0.72;
  return 1 / (1 + Number(sigmaMeters) / 100);
}

function coverageFactor(candidate) {
  if (candidate?.coversQuery === false) return 0;
  if (finite(candidate?.distanceToNearestMeasurementKm)) {
    return Math.exp(-Math.max(0, Number(candidate.distanceToNearestMeasurementKm)) / 100);
  }
  return 1;
}

function preferredSolidBed(candidate, latitude) {
  const sourceId = candidate?.sourceId;
  if (sourceId === "bedmachine-greenland-v6" && Number(latitude) >= 58) return 1.12;
  if (sourceId === "bedmachine-antarctica-v4" && Number(latitude) <= -60) return 1.12;
  return 1;
}

export function gebcoTidSourceClass(tid) {
  const value = Number(tid);
  if (value === 0) return BATHYMETRY_SOURCE_CLASS.LAND;
  if (value === 10) return BATHYMETRY_SOURCE_CLASS.SINGLEBEAM;
  if (value === 11) return BATHYMETRY_SOURCE_CLASS.MULTIBEAM;
  if (value === 12) return BATHYMETRY_SOURCE_CLASS.SEISMIC;
  if (value === 13) return BATHYMETRY_SOURCE_CLASS.ISOLATED_SOUNDING;
  if (value === 14) return BATHYMETRY_SOURCE_CLASS.ENC_SOUNDING;
  if (value >= 40 && value < 50) return BATHYMETRY_SOURCE_CLASS.INTERPOLATED;
  if (value >= 50) return BATHYMETRY_SOURCE_CLASS.PREDICTED;
  return BATHYMETRY_SOURCE_CLASS.UNKNOWN;
}

function sourceClass(candidate) {
  if (candidate?.sourceClass) return candidate.sourceClass;
  if (finite(candidate?.tid)) return gebcoTidSourceClass(candidate.tid);
  return BATHYMETRY_SOURCE_CLASS.UNKNOWN;
}

export function scoreModernTerrainAnchor(candidate, { latitude = 0, longitude = 0 } = {}) {
  if (!candidate || !finite(candidate.value)) return null;
  const source = topographyEvidenceSourceById(candidate.sourceId);
  const cls = sourceClass(candidate);
  const meters = resolutionMeters(candidate, source);
  const sourceQuality = clamp01(candidate.sourceQuality ?? source?.sourceQuality ?? 0.7);
  const classPrior = SOURCE_CLASS_PRIOR[cls] ?? SOURCE_CLASS_PRIOR[BATHYMETRY_SOURCE_CLASS.UNKNOWN];
  const rolePrior = SOURCE_ROLE_PRIOR[source?.family] ?? 0.72;
  const resolution = resolutionFactor(meters);
  const uncertainty = uncertaintyFactor(candidate.sigmaMeters);
  const coverage = coverageFactor(candidate);
  const solidBedPreference = preferredSolidBed(candidate, latitude);
  const score = clamp01(sourceQuality * classPrior * rolePrior * resolution * uncertainty * coverage * solidBedPreference);
  return Object.freeze({
    ...candidate,
    sourceCatalogMatched: Boolean(source),
    sourceFamily: source?.family ?? candidate.sourceFamily ?? null,
    sourceQuality,
    sourceClass: cls,
    resolutionMeters: meters,
    latitude: Number(latitude) || 0,
    longitude: Number(longitude) || 0,
    anchorScore: score,
    scoreComponents: Object.freeze({ classPrior, rolePrior, resolution, uncertainty, coverage, solidBedPreference }),
    policy: MODERN_TERRAIN_ANCHOR_POLICY
  });
}

/**
 * Select one best local modern terrain anchor rather than inverse-variance blending
 * products that frequently share underlying surveys. ETOPO remains a mandatory
 * fallback supplied by TerrainReconstruction777; higher-resolution candidates can
 * replace it only when an actual numeric local sample is available.
 */
export function resolveModernTerrainAnchor(candidates = [], options = {}) {
  const ranked = candidates
    .map((candidate) => scoreModernTerrainAnchor(candidate, options))
    .filter(Boolean)
    .sort((a, b) => b.anchorScore - a.anchorScore || String(a.sourceId ?? "").localeCompare(String(b.sourceId ?? "")));
  const selected = ranked[0] ?? null;
  return Object.freeze({
    policy: MODERN_TERRAIN_ANCHOR_POLICY,
    selected,
    ranked: Object.freeze(ranked),
    candidateCount: ranked.length,
    rule: "Select the strongest local modern anchor; do not statistically fuse overlapping global compilations as independent measurements. Direct survey provenance and solid-bed polar geometry are preferred over interpolated/predicted or ice-surface products."
  });
}
