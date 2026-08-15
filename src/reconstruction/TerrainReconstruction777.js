import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";
import {
  assimilateReconstructionScalar,
  reconstructionMethodSummary,
  RECONSTRUCTION_STREAMS
} from "./ReconstructionAssimilation.js";
import { shoreline777Sample } from "./ShorelineReconstruction777.js";
import { EVIDENCE_RELATIONS } from "./EvidenceHarvester.js";
import { harvestTopographyEvidenceAt } from "./TopographyEvidenceHarvester.js";
import {
  BATHYMETRY_SOURCE_CLASS,
  resolveModernTerrainAnchor
} from "./ModernTerrainAnchorResolver.js";

const clampLatitude = (value) => Math.max(-90, Math.min(90, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;
const positiveSigma = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

export const TERRAIN_777_RECONSTRUCTION_POLICY = "best-modern-anchor-explicit-hindcast-paleo-assimilation-v4";

/**
 * The default correction is intentionally zero-valued and uncertainty-incomplete.
 * It is a numerical bridge, not a scientific statement that present relief equals
 * 777 ka relief. Regional uplift/subsidence, erosion/deposition, GIA/ice loading,
 * dynamic topography and dated shoreline/terrace constraints must enter here as
 * explicit target-epoch estimates as they become available.
 */
function unresolvedHindcastCorrection() {
  return Object.freeze({
    value: 0,
    sigma: null,
    stream: RECONSTRUCTION_STREAMS.PROCESS,
    sourceId: "terrain-hindcast-unresolved-v1",
    method: "explicit zero correction pending resolved deep-time terrain hindcast",
    transformed: true,
    note: "Numerical placeholder only. The selected modern terrain anchor is not being claimed as observed 777 ka relief."
  });
}

function etopoFallbackCandidate(latitude, longitude, sigmaMeters = null) {
  const value = bedrockElevationAt(latitude, longitude);
  return Object.freeze({
    sourceId: "etopo-2022",
    value,
    sigmaMeters: positiveSigma(sigmaMeters),
    resolutionMeters: 450,
    sourceClass: value >= 0 ? BATHYMETRY_SOURCE_CLASS.LAND : BATHYMETRY_SOURCE_CLASS.UNKNOWN,
    coversQuery: true,
    method: "bundled ETOPO 2022 fallback anchor"
  });
}

function normalizeModernAnchorCandidate(record) {
  return Object.freeze({
    sourceId: record.sourceId ?? record.catalogSourceId ?? record.archiveSourceId ?? null,
    value: Number(record.value),
    sigmaMeters: positiveSigma(record.sigmaMeters ?? record.sigma),
    resolutionMeters: Number.isFinite(Number(record.resolutionMeters)) ? Number(record.resolutionMeters) : null,
    sourceClass: record.sourceClass ?? null,
    tid: Number.isFinite(Number(record.tid)) ? Number(record.tid) : null,
    coversQuery: record.coversQuery ?? true,
    distanceToNearestMeasurementKm: Number.isFinite(Number(record.distanceToNearestMeasurementKm)) ? Number(record.distanceToNearestMeasurementKm) : null,
    sourceQuality: Number.isFinite(Number(record.sourceQuality)) ? Number(record.sourceQuality) : null,
    method: record.method ?? "harvested modern terrain anchor"
  });
}

export function terrain777BedrockSample(latitude, longitude, {
  modernAnchorSigmaMeters = null,
  modernAnchorCandidates = [],
  hindcastCorrection = null,
  paleoConstraints = [],
  historicalCalibration = [],
  modelCompletion = null
} = {}) {
  const lat = clampLatitude(latitude);
  const lon = wrapLongitude(longitude);
  const etopoElevationMeters = bedrockElevationAt(lat, lon);
  const modernAnchorResolution = resolveModernTerrainAnchor([
    etopoFallbackCandidate(lat, lon, modernAnchorSigmaMeters),
    ...modernAnchorCandidates.filter((candidate) => candidate && Number.isFinite(Number(candidate.value)))
  ], { latitude: lat, longitude: lon });
  const selectedModernAnchor = modernAnchorResolution.selected ?? etopoFallbackCandidate(lat, lon, modernAnchorSigmaMeters);
  const modernElevationMeters = Number(selectedModernAnchor.value);
  const correction = hindcastCorrection ?? unresolvedHindcastCorrection();

  const assimilation = assimilateReconstructionScalar({
    field: "bedrockElevationMeters",
    targetYearBP: 777_000,
    modernAnchor: {
      value: modernElevationMeters,
      sigma: positiveSigma(selectedModernAnchor.sigmaMeters),
      stream: RECONSTRUCTION_STREAMS.MODERN,
      sourceId: selectedModernAnchor.sourceId ?? "etopo-2022",
      method: selectedModernAnchor.method ?? "selected best local modern terrain anchor",
      note: "Modern elevation is a spatial anchor and must be transformed before interpretation at 777 ka. Correlated terrain compilations are selected, not naively fused as independent measurements."
    },
    hindcastCorrection: correction,
    paleoConstraints,
    historicalCalibration,
    modelCompletion
  });

  const reconstructedElevationMeters = Number.isFinite(assimilation.value)
    ? assimilation.value
    : modernElevationMeters;
  const shoreline = shoreline777Sample(reconstructedElevationMeters);

  return Object.freeze({
    ...assimilation,
    policy: TERRAIN_777_RECONSTRUCTION_POLICY,
    latitude: lat,
    longitude: lon,
    etopoElevationMeters,
    modernElevationMeters,
    selectedModernAnchorSourceId: selectedModernAnchor.sourceId ?? "etopo-2022",
    selectedModernAnchorClass: selectedModernAnchor.sourceClass ?? null,
    modernAnchorResolution,
    reconstructedElevationMeters,
    hindcastCorrectionMeters: assimilation.value == null ? null : assimilation.value - modernElevationMeters,
    reconstructionMethod: reconstructionMethodSummary(assimilation),
    reconstructionStatus: hindcastCorrection == null && paleoConstraints.length === 0
      ? "provisional-modern-anchor-awaiting-local-hindcast"
      : "assimilated-target-epoch-terrain",
    shoreline,
    medianLandAt777ka: shoreline.medianLand,
    shorelineConfidenceClass: shoreline.confidenceClass,
    shorelineLandProbability: shoreline.landProbability,
    epistemicStatus: "777 ka bedrock reconstruction plus uncertainty-aware global shoreline classification. The strongest available local modern terrain anchor supplies spatial detail only after an explicit hindcast transform; correlated modern grids are selected rather than treated as independent evidence."
  });
}

function harvestedConstraint(record) {
  const transformed = record.relation === EVIDENCE_RELATIONS.TRANSFORMED_HINDCAST || Boolean(record.transformedToTarget);
  return Object.freeze({
    value: Number(record.value),
    sigma: positiveSigma(record.sigma),
    stream: transformed ? RECONSTRUCTION_STREAMS.PROCESS : RECONSTRUCTION_STREAMS.PALEO,
    sourceId: record.sourceId ?? record.id ?? null,
    method: record.method ?? record.relation,
    transformed,
    note: record.note ?? null
  });
}

function harvestedCalibration(record) {
  return Object.freeze({
    parameter: record.parameter ?? record.field ?? null,
    value: Number.isFinite(Number(record.value)) ? Number(record.value) : null,
    sigma: positiveSigma(record.sigma),
    sourceId: record.sourceId ?? record.id ?? null,
    method: record.method ?? "harvested process calibration",
    note: record.note ?? null
  });
}

/**
 * Convenience path for Evidence Harvester adapters.
 *
 * Raw nearby paleo records and untransformed historical rates are retained in
 * evidenceHarvest but do not change the target elevation. Modern anchors may replace
 * ETOPO as the spatial anchor when they contain a numeric field-compatible sample;
 * they still cannot become a 777 ka value until the hindcast transforms that anchor.
 */
export function terrain777BedrockSampleFromEvidence(latitude, longitude, evidenceRecords = [], options = {}) {
  const harvest = harvestTopographyEvidenceAt(latitude, longitude, evidenceRecords, {
    targetYearBP: 777_000,
    field: "bedrockElevationMeters",
    uncertaintyScaleMeters: options.uncertaintyScaleMeters ?? 100
  });
  const harvestedConstraints = harvest.targetConstraints.map(harvestedConstraint);
  const harvestedCalibrationRecords = harvest.processCalibration.map(harvestedCalibration);
  const harvestedModernCandidates = harvest.modernAnchors
    .filter((record) => record.queryFieldEligible !== false && Number.isFinite(Number(record.value)))
    .map(normalizeModernAnchorCandidate);
  const sample = terrain777BedrockSample(latitude, longitude, {
    modernAnchorSigmaMeters: options.modernAnchorSigmaMeters ?? null,
    modernAnchorCandidates: [...(options.modernAnchorCandidates ?? []), ...harvestedModernCandidates],
    hindcastCorrection: options.hindcastCorrection ?? null,
    paleoConstraints: [...(options.paleoConstraints ?? []), ...harvestedConstraints],
    historicalCalibration: [...(options.historicalCalibration ?? []), ...harvestedCalibrationRecords],
    modelCompletion: options.modelCompletion ?? null
  });
  return Object.freeze({
    ...sample,
    evidenceHarvest: harvest,
    evidenceRecordCount: harvest.ranked.length,
    assimilatedHarvestConstraintCount: harvest.targetConstraints.length,
    calibrationRecordCount: harvest.processCalibration.length,
    nearbyUnassimilatedEvidenceCount: harvest.nearbyPaleo.length,
    modernAnchorEvidenceCount: harvest.modernAnchors.length,
    numericModernAnchorCandidateCount: harvestedModernCandidates.length,
    sourceCatalogMatchedCount: harvest.sourceCatalogMatchedCount,
    sourceCatalogUnmatchedCount: harvest.sourceCatalogUnmatchedCount
  });
}

export function reconstructedBedrockElevation777At(latitude, longitude, options = undefined) {
  const sample = terrain777BedrockSample(latitude, longitude, options);
  return sample.reconstructedElevationMeters;
}

export function terrain777ProvenanceAt(latitude, longitude, options = undefined) {
  const sample = terrain777BedrockSample(latitude, longitude, options);
  return Object.freeze({
    policy: sample.policy,
    method: sample.reconstructionMethod,
    status: sample.reconstructionStatus,
    confidence: sample.confidence,
    sigmaMeters: sample.sigma,
    lower95Meters: sample.lower95,
    upper95Meters: sample.upper95,
    etopoElevationMeters: sample.etopoElevationMeters,
    modernElevationMeters: sample.modernElevationMeters,
    selectedModernAnchorSourceId: sample.selectedModernAnchorSourceId,
    selectedModernAnchorClass: sample.selectedModernAnchorClass,
    modernAnchorResolution: sample.modernAnchorResolution,
    reconstructedElevationMeters: sample.reconstructedElevationMeters,
    hindcastCorrectionMeters: sample.hindcastCorrectionMeters,
    shoreline: sample.shoreline,
    estimates: sample.estimates,
    historicalCalibration: sample.historicalCalibration
  });
}
