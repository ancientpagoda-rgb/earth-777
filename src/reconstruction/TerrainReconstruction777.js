import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";
import {
  assimilateReconstructionScalar,
  reconstructionMethodSummary,
  RECONSTRUCTION_STREAMS
} from "./ReconstructionAssimilation.js";
import { shoreline777Sample } from "./ShorelineReconstruction777.js";
import { EVIDENCE_RELATIONS, harvestEvidence } from "./EvidenceHarvester.js";

const clampLatitude = (value) => Math.max(-90, Math.min(90, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;
const positiveSigma = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

export const TERRAIN_777_RECONSTRUCTION_POLICY = "modern-relief-explicit-hindcast-paleo-assimilation-v3";

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
    note: "Numerical placeholder only. Modern ETOPO is not being claimed as observed 777 ka relief."
  });
}

export function terrain777BedrockSample(latitude, longitude, {
  modernAnchorSigmaMeters = null,
  hindcastCorrection = null,
  paleoConstraints = [],
  historicalCalibration = [],
  modelCompletion = null
} = {}) {
  const lat = clampLatitude(latitude);
  const lon = wrapLongitude(longitude);
  const modernElevationMeters = bedrockElevationAt(lat, lon);
  const correction = hindcastCorrection ?? unresolvedHindcastCorrection();

  const assimilation = assimilateReconstructionScalar({
    field: "bedrockElevationMeters",
    targetYearBP: 777_000,
    modernAnchor: {
      value: modernElevationMeters,
      sigma: positiveSigma(modernAnchorSigmaMeters),
      stream: RECONSTRUCTION_STREAMS.MODERN,
      sourceId: "etopo-2022",
      method: "modern ETOPO 2022 bedrock/bathymetry spatial anchor",
      note: "Modern elevation is an anchor and must be transformed before interpretation at 777 ka."
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
    epistemicStatus: "777 ka bedrock reconstruction plus uncertainty-aware global shoreline classification. Modern ETOPO supplies spatial detail only after an explicit hindcast transform; historical observations calibrate process models and paleo constraints may directly update the target epoch."
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
 * Raw nearby paleo records, modern anchors and untransformed historical rates are
 * deliberately retained in evidenceHarvest but do not change the target elevation.
 * Only target-overlapping observations and explicitly target-transformed hindcasts
 * are forwarded as numerical 777 ka constraints.
 */
export function terrain777BedrockSampleFromEvidence(latitude, longitude, evidenceRecords = [], options = {}) {
  const harvest = harvestEvidence(evidenceRecords, {
    targetYearBP: 777_000,
    latitude,
    longitude,
    field: "bedrockElevationMeters",
    uncertaintyScale: options.uncertaintyScaleMeters ?? 100
  });
  const harvestedConstraints = harvest.targetConstraints.map(harvestedConstraint);
  const harvestedCalibrationRecords = harvest.processCalibration.map(harvestedCalibration);
  const sample = terrain777BedrockSample(latitude, longitude, {
    modernAnchorSigmaMeters: options.modernAnchorSigmaMeters ?? null,
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
    modernAnchorEvidenceCount: harvest.modernAnchors.length
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
    reconstructedElevationMeters: sample.reconstructedElevationMeters,
    hindcastCorrectionMeters: sample.hindcastCorrectionMeters,
    shoreline: sample.shoreline,
    estimates: sample.estimates,
    historicalCalibration: sample.historicalCalibration
  });
}
