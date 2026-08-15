import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";
import {
  assimilateReconstructionScalar,
  reconstructionMethodSummary,
  RECONSTRUCTION_STREAMS
} from "./ReconstructionAssimilation.js";

const clampLatitude = (value) => Math.max(-90, Math.min(90, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;
const positiveSigma = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

export const TERRAIN_777_RECONSTRUCTION_POLICY = "modern-relief-explicit-hindcast-paleo-assimilation-v1";

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

  return Object.freeze({
    ...assimilation,
    policy: TERRAIN_777_RECONSTRUCTION_POLICY,
    latitude: lat,
    longitude: lon,
    modernElevationMeters,
    reconstructedElevationMeters: assimilation.value,
    hindcastCorrectionMeters: assimilation.value == null ? null : assimilation.value - modernElevationMeters,
    reconstructionMethod: reconstructionMethodSummary(assimilation),
    reconstructionStatus: hindcastCorrection == null && paleoConstraints.length === 0
      ? "provisional-modern-anchor-awaiting-local-hindcast"
      : "assimilated-target-epoch-terrain",
    epistemicStatus: "777 ka bedrock reconstruction. Modern ETOPO supplies spatial detail only after an explicit hindcast transform; historical observations calibrate process models and paleo constraints may directly update the target epoch."
  });
}

export function reconstructedBedrockElevation777At(latitude, longitude, options = undefined) {
  const sample = terrain777BedrockSample(latitude, longitude, options);
  return Number.isFinite(sample.reconstructedElevationMeters)
    ? sample.reconstructedElevationMeters
    : sample.modernElevationMeters;
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
    estimates: sample.estimates,
    historicalCalibration: sample.historicalCalibration
  });
}
