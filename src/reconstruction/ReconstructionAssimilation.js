const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const finite = (value) => Number.isFinite(Number(value));

export const RECONSTRUCTION_ASSIMILATION_POLICY = "modern-hindcast-paleo-historical-assimilation-v1";

export const RECONSTRUCTION_STREAMS = Object.freeze({
  MODERN: "modern-anchor",
  HISTORICAL: "historical-process-calibration",
  PALEO: "paleo-observation",
  PROCESS: "physics-hindcast",
  MODEL: "model-completion"
});

function freezeRecord(record) {
  return Object.freeze({ ...record });
}

function normalizeEstimate(estimate, fallbackStream) {
  if (!estimate || !finite(estimate.value)) return null;
  const sigma = finite(estimate.sigma) && Number(estimate.sigma) > 0 ? Number(estimate.sigma) : null;
  return freezeRecord({
    value: Number(estimate.value),
    sigma,
    stream: estimate.stream ?? fallbackStream,
    sourceId: estimate.sourceId ?? null,
    method: estimate.method ?? null,
    transformed: Boolean(estimate.transformed),
    note: estimate.note ?? null
  });
}

function precisionWeight(estimate) {
  if (!estimate || !finite(estimate.value)) return 0;
  if (estimate.sigma == null) return 0;
  return 1 / (estimate.sigma * estimate.sigma);
}

function combineIndependentEstimates(estimates) {
  const weighted = estimates
    .map((estimate) => ({ estimate, weight: precisionWeight(estimate) }))
    .filter(({ weight }) => weight > 0);
  if (!weighted.length) return null;
  const precision = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const value = weighted.reduce((sum, entry) => sum + entry.estimate.value * entry.weight, 0) / precision;
  return Object.freeze({ value, sigma: Math.sqrt(1 / precision) });
}

function transformedModernEstimate(modernAnchor, hindcastCorrection) {
  const modern = normalizeEstimate(modernAnchor, RECONSTRUCTION_STREAMS.MODERN);
  if (!modern) return null;
  const correction = normalizeEstimate(hindcastCorrection, RECONSTRUCTION_STREAMS.PROCESS);
  if (!correction) return null;
  if (modern.sigma == null || correction.sigma == null) return freezeRecord({
    value: modern.value + correction.value,
    sigma: null,
    stream: RECONSTRUCTION_STREAMS.PROCESS,
    sourceId: correction.sourceId,
    method: correction.method ?? "modern-anchor-plus-hindcast-correction",
    transformed: true,
    note: "Modern anchor transformed to the target epoch; uncertainty is incomplete."
  });
  return freezeRecord({
    value: modern.value + correction.value,
    sigma: Math.hypot(modern.sigma, correction.sigma),
    stream: RECONSTRUCTION_STREAMS.PROCESS,
    sourceId: correction.sourceId,
    method: correction.method ?? "modern-anchor-plus-hindcast-correction",
    transformed: true,
    note: "Modern anchor transformed to the target epoch by an explicit process hindcast."
  });
}

function normalizeHistoricalCalibration(records = []) {
  return Object.freeze(records
    .filter((record) => record && (record.parameter || record.sourceId || record.method))
    .map((record) => freezeRecord({
      stream: RECONSTRUCTION_STREAMS.HISTORICAL,
      parameter: record.parameter ?? null,
      value: finite(record.value) ? Number(record.value) : null,
      sigma: finite(record.sigma) && Number(record.sigma) > 0 ? Number(record.sigma) : null,
      sourceId: record.sourceId ?? null,
      method: record.method ?? null,
      note: record.note ?? null
    })));
}

/**
 * Reconstruct one scalar field value at a target epoch.
 *
 * The solver fuses only estimates that are already estimates of the target epoch:
 * - a modern observation may enter only after an explicit hindcast correction;
 * - paleo observations may enter directly when they constrain the target epoch;
 * - model completion may fill otherwise unconstrained space;
 * - historical observations calibrate the hindcast/process model and are carried as
 *   provenance, but are never naively extrapolated as target-epoch values.
 */
export function assimilateReconstructionScalar({
  field,
  targetYearBP = 777_000,
  modernAnchor = null,
  hindcastCorrection = null,
  paleoConstraints = [],
  historicalCalibration = [],
  modelCompletion = null
} = {}) {
  const modernHindcast = transformedModernEstimate(modernAnchor, hindcastCorrection);
  const paleo = paleoConstraints
    .map((constraint) => normalizeEstimate(constraint, RECONSTRUCTION_STREAMS.PALEO))
    .filter(Boolean);
  const completion = normalizeEstimate(modelCompletion, RECONSTRUCTION_STREAMS.MODEL);

  const targetEstimates = [modernHindcast, ...paleo, completion].filter(Boolean);
  const fused = combineIndependentEstimates(targetEstimates);
  const historical = normalizeHistoricalCalibration(historicalCalibration);

  let value = fused?.value ?? targetEstimates[0]?.value ?? null;
  let sigma = fused?.sigma ?? targetEstimates[0]?.sigma ?? null;
  const constrainedEstimateCount = targetEstimates.filter((estimate) => estimate.stream !== RECONSTRUCTION_STREAMS.MODEL).length;
  const confidence = value == null ? 0 : clamp01(
    0.18
      + Math.min(0.48, constrainedEstimateCount * 0.16)
      + Math.min(0.18, paleo.length * 0.06)
      + (modernHindcast ? 0.10 : 0)
      + (historical.length ? 0.06 : 0)
      - (completion && constrainedEstimateCount === 0 ? 0.16 : 0)
  );

  return Object.freeze({
    policy: RECONSTRUCTION_ASSIMILATION_POLICY,
    field: field ?? "unnamed-field",
    targetYearBP: Math.max(0, Number(targetYearBP) || 0),
    value,
    sigma,
    lower95: value != null && sigma != null ? value - 1.96 * sigma : null,
    upper95: value != null && sigma != null ? value + 1.96 * sigma : null,
    confidence,
    method: fused ? "inverse-variance fusion of target-epoch estimates" : targetEstimates.length ? "single available target-epoch estimate" : "unresolved",
    estimates: Object.freeze(targetEstimates),
    historicalCalibration: historical,
    provenance: Object.freeze({
      modernAnchor: normalizeEstimate(modernAnchor, RECONSTRUCTION_STREAMS.MODERN),
      hindcastCorrection: normalizeEstimate(hindcastCorrection, RECONSTRUCTION_STREAMS.PROCESS),
      paleoConstraints: Object.freeze(paleo),
      modelCompletion: completion
    }),
    caveat: "Historical observations calibrate process behavior; they are not linearly projected to 777 ka unless a separate process model transforms them into a target-epoch estimate."
  });
}

export function reconstructionMethodSummary(result) {
  if (!result || result.value == null) return "unresolved";
  const streams = new Set((result.estimates ?? []).map((estimate) => estimate.stream));
  if (streams.has(RECONSTRUCTION_STREAMS.PALEO) && streams.has(RECONSTRUCTION_STREAMS.PROCESS)) return "bidirectionally constrained";
  if (streams.has(RECONSTRUCTION_STREAMS.PALEO)) return "paleo constrained";
  if (streams.has(RECONSTRUCTION_STREAMS.PROCESS)) return "modern-data hindcast";
  if (streams.has(RECONSTRUCTION_STREAMS.MODEL)) return "model completion";
  return "reconstructed";
}
