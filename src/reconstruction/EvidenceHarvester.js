const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0088;
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const finite = (value) => Number.isFinite(Number(value));

export const EVIDENCE_HARVEST_POLICY = "target-age-distance-uncertainty-source-ranking-v1";

export const EVIDENCE_RELATIONS = Object.freeze({
  DIRECT_TARGET: "direct-target-observation",
  TARGET_INTERVAL: "target-overlapping-paleo-interval",
  TRANSFORMED_HINDCAST: "transformed-to-target-hindcast",
  NEARBY_PALEO: "nearby-age-paleo-evidence",
  PROCESS_CALIBRATION: "process-calibration",
  MODERN_ANCHOR: "modern-spatial-anchor",
  MODEL_COMPLETION: "model-completion"
});

const RELATION_PRIOR = Object.freeze({
  [EVIDENCE_RELATIONS.DIRECT_TARGET]: 1.00,
  [EVIDENCE_RELATIONS.TARGET_INTERVAL]: 0.96,
  [EVIDENCE_RELATIONS.TRANSFORMED_HINDCAST]: 0.90,
  [EVIDENCE_RELATIONS.NEARBY_PALEO]: 0.74,
  [EVIDENCE_RELATIONS.PROCESS_CALIBRATION]: 0.56,
  [EVIDENCE_RELATIONS.MODERN_ANCHOR]: 0.48,
  [EVIDENCE_RELATIONS.MODEL_COMPLETION]: 0.28
});

const DEFAULT_SPATIAL_SUPPORT_KM = Object.freeze({
  [EVIDENCE_RELATIONS.DIRECT_TARGET]: 120,
  [EVIDENCE_RELATIONS.TARGET_INTERVAL]: 180,
  [EVIDENCE_RELATIONS.TRANSFORMED_HINDCAST]: 250,
  [EVIDENCE_RELATIONS.NEARBY_PALEO]: 180,
  [EVIDENCE_RELATIONS.PROCESS_CALIBRATION]: 450,
  [EVIDENCE_RELATIONS.MODERN_ANCHOR]: 30,
  [EVIDENCE_RELATIONS.MODEL_COMPLETION]: 1200
});

function wrapLongitude(value) {
  return ((Number(value) + 540) % 360) - 180;
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

function ageWindow(record) {
  if (Array.isArray(record?.ageRangeBP) && record.ageRangeBP.length >= 2) {
    const values = record.ageRangeBP.slice(0, 2).map(Number).filter(Number.isFinite);
    if (values.length === 2) return { youngerBP: Math.min(...values), olderBP: Math.max(...values) };
  }
  if (finite(record?.ageLowerBP) && finite(record?.ageUpperBP)) {
    return { youngerBP: Math.min(Number(record.ageLowerBP), Number(record.ageUpperBP)), olderBP: Math.max(Number(record.ageLowerBP), Number(record.ageUpperBP)) };
  }
  if (finite(record?.ageBP)) {
    const sigma = Math.max(0, Number(record.ageSigmaYears) || 0);
    return { youngerBP: Number(record.ageBP) - sigma, olderBP: Number(record.ageBP) + sigma };
  }
  return null;
}

function temporalDistanceYears(record, targetYearBP) {
  const window = ageWindow(record);
  if (!window) return null;
  if (targetYearBP >= window.youngerBP && targetYearBP <= window.olderBP) return 0;
  return targetYearBP < window.youngerBP ? window.youngerBP - targetYearBP : targetYearBP - window.olderBP;
}

function temporalFactor(record, targetYearBP) {
  const relation = record.relation ?? EVIDENCE_RELATIONS.NEARBY_PALEO;
  if (relation === EVIDENCE_RELATIONS.MODERN_ANCHOR || relation === EVIDENCE_RELATIONS.MODEL_COMPLETION) return 1;
  const distance = temporalDistanceYears(record, targetYearBP);
  if (distance == null) return relation === EVIDENCE_RELATIONS.PROCESS_CALIBRATION ? 0.82 : 0.62;
  if (distance === 0) return 1;
  const sigma = Math.max(0, Number(record.ageSigmaYears) || 0);
  const scale = Math.max(500, Number(record.temporalSupportYears) || 0, sigma * 1.5,
    relation === EVIDENCE_RELATIONS.PROCESS_CALIBRATION ? 350_000 : 35_000);
  return Math.exp(-distance / scale);
}

function spatialFactor(record, latitude, longitude) {
  const explicit = finite(record?.distanceKm) ? Math.max(0, Number(record.distanceKm)) : null;
  const distanceKm = explicit ?? greatCircleDistanceKm(latitude, longitude, record?.latitude, record?.longitude);
  if (distanceKm == null) return { distanceKm: null, factor: record?.globalCoverage ? 1 : 0.72 };
  const relation = record.relation ?? EVIDENCE_RELATIONS.NEARBY_PALEO;
  const supportKm = Math.max(1, Number(record.spatialSupportKm) || DEFAULT_SPATIAL_SUPPORT_KM[relation] || 150);
  return { distanceKm, factor: Math.exp(-distanceKm / supportKm) };
}

function uncertaintyFactor(record, uncertaintyScale = 100) {
  const sigma = finite(record?.sigma) && Number(record.sigma) > 0 ? Number(record.sigma) : null;
  if (sigma == null) return 0.72;
  return 1 / (1 + sigma / Math.max(1e-6, Number(record.uncertaintyScale) || uncertaintyScale));
}

function targetEligible(record, targetYearBP) {
  if (!finite(record?.value)) return false;
  const relation = record.relation;
  if (relation === EVIDENCE_RELATIONS.TRANSFORMED_HINDCAST) return Boolean(record.transformedToTarget ?? true);
  if (relation === EVIDENCE_RELATIONS.DIRECT_TARGET) return temporalDistanceYears(record, targetYearBP) === 0 || !ageWindow(record);
  if (relation === EVIDENCE_RELATIONS.TARGET_INTERVAL) return temporalDistanceYears(record, targetYearBP) === 0;
  return false;
}

function calibrationEligible(record) {
  return record?.relation === EVIDENCE_RELATIONS.PROCESS_CALIBRATION;
}

export function rankEvidenceRecord(record, {
  targetYearBP = 777_000,
  latitude = null,
  longitude = null,
  field = null,
  uncertaintyScale = 100
} = {}) {
  if (!record) return null;
  const relation = record.relation ?? EVIDENCE_RELATIONS.NEARBY_PALEO;
  const relationPrior = RELATION_PRIOR[relation] ?? 0.2;
  const temporal = temporalFactor(record, targetYearBP);
  const spatial = spatialFactor(record, latitude, longitude);
  const uncertainty = uncertaintyFactor(record, uncertaintyScale);
  const sourceQuality = clamp01(record.sourceQuality ?? 0.72);
  const relevance = clamp01(record.relevance ?? (field == null || record.field == null || record.field === field ? 1 : 0.35));
  const fieldMatch = field == null || record.field == null || record.field === field ? 1 : 0.35;
  const score = clamp01(relationPrior * temporal * spatial.factor * uncertainty * sourceQuality * relevance * fieldMatch);
  const ageDistanceYears = temporalDistanceYears(record, targetYearBP);
  return Object.freeze({
    ...record,
    relation,
    evidenceScore: score,
    scoreComponents: Object.freeze({ relationPrior, temporal, spatial: spatial.factor, uncertainty, sourceQuality, relevance, fieldMatch }),
    distanceKm: spatial.distanceKm,
    ageDistanceYears,
    targetEligible: targetEligible(record, targetYearBP),
    calibrationEligible: calibrationEligible(record),
    rankingPolicy: EVIDENCE_HARVEST_POLICY
  });
}

export function harvestEvidence(records = [], options = {}) {
  const targetYearBP = Math.max(0, Number(options.targetYearBP) || 777_000);
  const ranked = records
    .map((record) => rankEvidenceRecord(record, { ...options, targetYearBP }))
    .filter(Boolean)
    .sort((a, b) => b.evidenceScore - a.evidenceScore || String(a.sourceId ?? "").localeCompare(String(b.sourceId ?? "")));

  const targetConstraints = ranked.filter((record) => record.targetEligible);
  const processCalibration = ranked.filter((record) => record.calibrationEligible);
  const nearbyPaleo = ranked.filter((record) => record.relation === EVIDENCE_RELATIONS.NEARBY_PALEO && !record.targetEligible);
  const modernAnchors = ranked.filter((record) => record.relation === EVIDENCE_RELATIONS.MODERN_ANCHOR);
  const modelCompletion = ranked.filter((record) => record.relation === EVIDENCE_RELATIONS.MODEL_COMPLETION);

  return Object.freeze({
    policy: EVIDENCE_HARVEST_POLICY,
    targetYearBP,
    field: options.field ?? null,
    latitude: finite(options.latitude) ? Number(options.latitude) : null,
    longitude: finite(options.longitude) ? wrapLongitude(options.longitude) : null,
    ranked: Object.freeze(ranked),
    targetConstraints: Object.freeze(targetConstraints),
    processCalibration: Object.freeze(processCalibration),
    nearbyPaleo: Object.freeze(nearbyPaleo),
    modernAnchors: Object.freeze(modernAnchors),
    modelCompletion: Object.freeze(modelCompletion),
    rule: "Discovery rank is not assimilation weight. Only direct/target-overlapping observations or explicitly transformed hindcasts can become target-epoch estimates; nearby paleo, historical/process records and modern anchors remain non-target evidence until a physical or statistical transformation is supplied."
  });
}

export function harvestedTargetConstraints(harvest) {
  return Object.freeze((harvest?.targetConstraints ?? []).map((record) => Object.freeze({
    value: Number(record.value),
    sigma: finite(record.sigma) && Number(record.sigma) > 0 ? Number(record.sigma) : null,
    sourceId: record.sourceId ?? record.id ?? null,
    method: record.method ?? record.relation,
    note: record.note ?? null,
    transformed: record.relation === EVIDENCE_RELATIONS.TRANSFORMED_HINDCAST || Boolean(record.transformedToTarget)
  })));
}

export function harvestedProcessCalibration(harvest) {
  return Object.freeze((harvest?.processCalibration ?? []).map((record) => Object.freeze({
    parameter: record.parameter ?? record.field ?? null,
    value: finite(record.value) ? Number(record.value) : null,
    sigma: finite(record.sigma) && Number(record.sigma) > 0 ? Number(record.sigma) : null,
    sourceId: record.sourceId ?? record.id ?? null,
    method: record.method ?? "harvested process calibration",
    note: record.note ?? null
  })));
}
