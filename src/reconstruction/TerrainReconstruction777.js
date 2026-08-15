import {
  assimilateReconstructionScalar,
  reconstructionMethodSummary,
  RECONSTRUCTION_STREAMS
} from "./ReconstructionAssimilation.js";
import { shoreline777Sample } from "./ShorelineReconstruction777.js";
import { EVIDENCE_RELATIONS } from "./EvidenceHarvester.js";
import { harvestTopographyEvidenceAt } from "./TopographyEvidenceHarvester.js";
import { selectModernTerrainAnchor } from "./ModernTerrainAnchorSelector.js";
import { cachedModernTerrainAnchorCandidatesAt } from "./ModernTerrainAnchorCache.js";

const clampLatitude = (value) => Math.max(-90, Math.min(90, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;
const positiveSigma = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

export const TERRAIN_777_RECONSTRUCTION_POLICY = "source-aware-modern-relief-explicit-hindcast-paleo-assimilation-v4";

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
    note: "Numerical placeholder only. The selected modern anchor is not being claimed as observed 777 ka relief."
  });
}

export function terrain777BedrockSample(latitude, longitude, {
  modernAnchorSigmaMeters = null,
  modernAnchorCandidates = [],
  useCachedHighResolutionAnchors = true,
  cachedAnchorRadiusKm = 1,
  hindcastCorrection = null,
  paleoConstraints = [],
  historicalCalibration = [],
  modelCompletion = null
} = {}) {
  const lat = clampLatitude(latitude);
  const lon = wrapLongitude(longitude);
  const cachedCandidates = useCachedHighResolutionAnchors
    ? cachedModernTerrainAnchorCandidatesAt(lat, lon, cachedAnchorRadiusKm)
    : [];
  const anchorSelection = selectModernTerrainAnchor(lat, lon, [...cachedCandidates, ...modernAnchorCandidates], {
    etopoSigmaMeters: modernAnchorSigmaMeters
  });
  const selectedAnchor = anchorSelection.selected;
  const modernElevationMeters = selectedAnchor.value;
  const correction = hindcastCorrection ?? unresolvedHindcastCorrection();

  const assimilation = assimilateReconstructionScalar({
    field: "bedrockElevationMeters",
    targetYearBP: 777_000,
    modernAnchor: {
      value: modernElevationMeters,
      sigma: selectedAnchor.sigma ?? positiveSigma(modernAnchorSigmaMeters),
      stream: RECONSTRUCTION_STREAMS.MODERN,
      sourceId: selectedAnchor.sourceId,
      method: selectedAnchor.method ?? `selected modern terrain anchor (${selectedAnchor.sourceId})`,
      note: `${selectedAnchor.note ?? "Modern terrain evidence selected for spatial detail."} It must still be transformed before interpretation at 777 ka.`
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
    modernElevationMeters,
    modernAnchorSelection: anchorSelection,
    modernAnchorSourceId: selectedAnchor.sourceId,
    modernAnchorResolutionMeters: selectedAnchor.resolutionMeters,
    modernAnchorMeasurementQuality: selectedAnchor.measurementQuality,
    modernAnchorReplacementUsed: anchorSelection.replacementUsed,
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
    epistemicStatus: "777 ka bedrock reconstruction plus uncertainty-aware global shoreline classification. The best available modern solid-surface anchor supplies spatial detail, but it enters the target epoch only through an explicit hindcast transform; historical observations calibrate process models and paleo constraints may directly update the target epoch."
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
 * Raw nearby paleo records and untransformed historical rates are retained without
 * changing target elevation. Modern-anchor evidence is allowed to improve the
 * present-day spatial skeleton, but only target-overlapping paleo observations and
 * explicitly target-transformed hindcasts can change the 777 ka estimate itself.
 */
export function terrain777BedrockSampleFromEvidence(latitude, longitude, evidenceRecords = [], options = {}) {
  const harvest = harvestTopographyEvidenceAt(latitude, longitude, evidenceRecords, {
    targetYearBP: 777_000,
    field: "bedrockElevationMeters",
    uncertaintyScaleMeters: options.uncertaintyScaleMeters ?? 100
  });
  const harvestedConstraints = harvest.targetConstraints.map(harvestedConstraint);
  const harvestedCalibrationRecords = harvest.processCalibration.map(harvestedCalibration);
  const harvestedModernAnchors = harvest.modernAnchors.filter((record) => Number.isFinite(Number(record.value)));
  const sample = terrain777BedrockSample(latitude, longitude, {
    modernAnchorSigmaMeters: options.modernAnchorSigmaMeters ?? null,
    modernAnchorCandidates: [...(options.modernAnchorCandidates ?? []), ...harvestedModernAnchors],
    useCachedHighResolutionAnchors: options.useCachedHighResolutionAnchors ?? true,
    cachedAnchorRadiusKm: options.cachedAnchorRadiusKm ?? 1,
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
    modernElevationMeters: sample.modernElevationMeters,
    modernAnchorSourceId: sample.modernAnchorSourceId,
    modernAnchorResolutionMeters: sample.modernAnchorResolutionMeters,
    modernAnchorReplacementUsed: sample.modernAnchorReplacementUsed,
    reconstructedElevationMeters: sample.reconstructedElevationMeters,
    hindcastCorrectionMeters: sample.hindcastCorrectionMeters,
    shoreline: sample.shoreline,
    estimates: sample.estimates,
    historicalCalibration: sample.historicalCalibration
  });
}
