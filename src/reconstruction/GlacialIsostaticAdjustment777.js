import { RECONSTRUCTION_STREAMS } from "./ReconstructionAssimilation.js";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const positiveSigma = (value) => finite(value) && Number(value) > 0 ? Number(value) : null;

export const GIA_777_POLICY = "gravitational-topographic-relative-sea-level-decomposition-v2";

export const GIA_777_MODEL_REFERENCE = Object.freeze({
  sourceId: "selen4",
  doi: "10.5194/gmd-12-5055-2019",
  role: "sea-level-equation-framework",
  note: "Reference framework for gravitationally and topographically self-consistent GIA. Earth 777 does not claim to have executed SELEN4 unless an external solver output is explicitly supplied."
});

/**
 * Sign convention at the 777 ka target relative to modern:
 * - positive solidEarthTargetMinusModernMeters means the solid surface is higher;
 * - positive localSeaSurfaceTargetMinusEustaticMeters means the local sea surface
 *   is higher than the global eustatic datum because of gravity/rotation/ocean-load effects.
 * Relative sea level is sea-surface height minus solid-Earth height, therefore the
 * local GIA correction is N - U.
 */
export function gia777RelativeSeaLevelSample({
  globalEustaticMetersVsModern = -12.76,
  globalEustaticSigmaMeters = 9.52,
  solidEarthTargetMinusModernMeters = 0,
  solidEarthSigmaMeters = null,
  localSeaSurfaceTargetMinusEustaticMeters = 0,
  localSeaSurfaceSigmaMeters = null,
  sourceId = null,
  method = null,
  solverExecuted = false,
  note = null
} = {}) {
  const eustatic = Number(globalEustaticMetersVsModern);
  if (!Number.isFinite(eustatic)) throw new TypeError("GIA reconstruction requires a finite global eustatic datum.");
  const solidEarth = Number(solidEarthTargetMinusModernMeters);
  const seaSurface = Number(localSeaSurfaceTargetMinusEustaticMeters);
  if (![solidEarth, seaSurface].every(Number.isFinite)) throw new TypeError("GIA displacement terms must be finite when supplied.");

  const localGiaCorrectionMeters = seaSurface - solidEarth;
  const relativeSeaLevelMetersVsModern = eustatic + localGiaCorrectionMeters;
  const targetSeaSurfaceMetersVsModern = eustatic + seaSurface;
  const eustaticSigma = positiveSigma(globalEustaticSigmaMeters);
  const solidSigma = positiveSigma(solidEarthSigmaMeters);
  const seaSigma = positiveSigma(localSeaSurfaceSigmaMeters);
  const localUncertaintyComplete = solidSigma != null && seaSigma != null;
  const totalSigmaMeters = eustaticSigma != null && localUncertaintyComplete
    ? Math.hypot(eustaticSigma, solidSigma, seaSigma)
    : null;
  const seaSurfaceDatumSigmaMeters = eustaticSigma != null && seaSigma != null
    ? Math.hypot(eustaticSigma, seaSigma)
    : null;

  const hasLocalCorrection = Math.abs(localGiaCorrectionMeters) > 1e-12;
  const externallySolved = Boolean(solverExecuted && sourceId);
  return Object.freeze({
    policy: GIA_777_POLICY,
    modelReference: GIA_777_MODEL_REFERENCE,
    sourceId,
    method: method ?? (externallySolved ? "external self-consistent GIA solution" : "unresolved local GIA correction"),
    solverExecuted: externallySolved,
    globalEustaticMetersVsModern: eustatic,
    globalEustaticSigmaMeters: eustaticSigma,
    solidEarthTargetMinusModernMeters: solidEarth,
    solidEarthSigmaMeters: solidSigma,
    localSeaSurfaceTargetMinusEustaticMeters: seaSurface,
    localSeaSurfaceSigmaMeters: seaSigma,
    targetSeaSurfaceMetersVsModern,
    targetSeaSurfaceSigmaMeters: seaSurfaceDatumSigmaMeters,
    localGiaCorrectionMeters,
    relativeSeaLevelMetersVsModern,
    sigmaMeters: totalSigmaMeters,
    lower95MetersVsModern: totalSigmaMeters == null ? null : relativeSeaLevelMetersVsModern - 1.96 * totalSigmaMeters,
    upper95MetersVsModern: totalSigmaMeters == null ? null : relativeSeaLevelMetersVsModern + 1.96 * totalSigmaMeters,
    localUncertaintyComplete,
    status: externallySolved
      ? "externally-solved-local-gia"
      : hasLocalCorrection
        ? "local-correction-supplied-without-verified-sle-solver"
        : "global-eustatic-only-local-gia-unresolved",
    note: note ?? "The default zero local correction is a neutral placeholder, not evidence that GIA was zero at 777 ka. Local relative sea level requires both sea-surface/gravity response and solid-Earth displacement."
  });
}

/** Component to add to a modern solid-bed anchor before target-epoch shoreline testing. */
export function gia777BedrockHindcastComponent(giaSample) {
  if (!giaSample || !finite(giaSample.solidEarthTargetMinusModernMeters)) return null;
  return Object.freeze({
    value: Number(giaSample.solidEarthTargetMinusModernMeters),
    sigma: positiveSigma(giaSample.solidEarthSigmaMeters),
    stream: RECONSTRUCTION_STREAMS.PROCESS,
    sourceId: giaSample.sourceId ?? "gia-777-unresolved",
    method: `${giaSample.method ?? "GIA"}: solid-Earth target-minus-modern displacement`,
    transformed: true,
    note: "This is only the GIA solid-Earth component. Other tectonic, erosion/deposition and dynamic-topography corrections remain separate."
  });
}

/** Sea-surface datum to compare against a target-epoch solid-bed elevation. */
export function gia777SeaSurfaceDatum(giaSample) {
  if (!giaSample || !finite(giaSample.targetSeaSurfaceMetersVsModern)) return null;
  const sigma = positiveSigma(giaSample.targetSeaSurfaceSigmaMeters);
  return Object.freeze({
    meanMetersVsModern: Number(giaSample.targetSeaSurfaceMetersVsModern),
    sigmaMeters: sigma,
    lower95MetersVsModern: sigma == null ? null : Number(giaSample.targetSeaSurfaceMetersVsModern) - 1.96 * sigma,
    upper95MetersVsModern: sigma == null ? null : Number(giaSample.targetSeaSurfaceMetersVsModern) + 1.96 * sigma,
    sourceId: giaSample.sourceId ?? "gia-777-unresolved",
    method: `${giaSample.method ?? "GIA"}: eustatic plus local sea-surface/gravity perturbation`,
    solverExecuted: Boolean(giaSample.solverExecuted)
  });
}

export function unresolvedGia777Sample(options = {}) {
  return gia777RelativeSeaLevelSample({
    ...options,
    solidEarthTargetMinusModernMeters: 0,
    solidEarthSigmaMeters: null,
    localSeaSurfaceTargetMinusEustaticMeters: 0,
    localSeaSurfaceSigmaMeters: null,
    sourceId: null,
    solverExecuted: false,
    method: "neutral placeholder pending spatial GIA solution"
  });
}
