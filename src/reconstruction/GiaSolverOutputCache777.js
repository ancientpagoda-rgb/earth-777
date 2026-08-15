import { gia777RelativeSeaLevelSample } from "./GlacialIsostaticAdjustment777.js";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clampLatitude = (value) => Math.max(-90, Math.min(90, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;
const positiveSigma = (value) => finite(value) && Number(value) > 0 ? Number(value) : null;

export const GIA_SOLVER_CACHE_777_POLICY = "external-sle-output-explicit-run-provenance-v1";

function validRunMetadata(run = {}) {
  return Boolean(
    run.solverId &&
    run.runId &&
    finite(run.targetYearBP) && Number(run.targetYearBP) === 777_000 &&
    run.iceHistoryId &&
    run.earthModelId &&
    run.configurationHash
  );
}

export function normalizeGia777RunMetadata(run = {}) {
  const valid = validRunMetadata(run);
  return Object.freeze({
    policy: GIA_SOLVER_CACHE_777_POLICY,
    solverId: run.solverId ?? null,
    solverVersion: run.solverVersion ?? null,
    solverSourceDoi: run.solverSourceDoi ?? null,
    runId: run.runId ?? null,
    targetYearBP: finite(run.targetYearBP) ? Number(run.targetYearBP) : null,
    iceHistoryId: run.iceHistoryId ?? null,
    earthModelId: run.earthModelId ?? null,
    rheologyDescription: run.rheologyDescription ?? null,
    shorelineIteration: run.shorelineIteration ?? null,
    rotationIncluded: run.rotationIncluded ?? null,
    configurationHash: run.configurationHash ?? null,
    inputManifestHash: run.inputManifestHash ?? null,
    outputHash: run.outputHash ?? null,
    validForTargetAssimilation: valid,
    status: valid ? "documented-target-sle-run" : "incomplete-run-provenance"
  });
}

export function normalizeGia777OutputCell(record = {}, runMetadata = {}) {
  const run = normalizeGia777RunMetadata(runMetadata);
  const U = finite(record.solidEarthTargetMinusModernMeters) ? Number(record.solidEarthTargetMinusModernMeters) : null;
  const N = finite(record.localSeaSurfaceTargetMinusEustaticMeters) ? Number(record.localSeaSurfaceTargetMinusEustaticMeters) : null;
  const numeric = U != null && N != null;
  const targetEligible = run.validForTargetAssimilation && numeric;
  const sample = numeric ? gia777RelativeSeaLevelSample({
    globalEustaticMetersVsModern: finite(record.globalEustaticMetersVsModern) ? Number(record.globalEustaticMetersVsModern) : -12.76,
    globalEustaticSigmaMeters: positiveSigma(record.globalEustaticSigmaMeters) ?? 9.52,
    solidEarthTargetMinusModernMeters: U,
    solidEarthSigmaMeters: positiveSigma(record.solidEarthSigmaMeters),
    localSeaSurfaceTargetMinusEustaticMeters: N,
    localSeaSurfaceSigmaMeters: positiveSigma(record.localSeaSurfaceSigmaMeters),
    sourceId: `${run.solverId ?? "gia-solver"}:${run.runId ?? "undocumented"}`,
    method: `${run.solverId ?? "external solver"} cached sea-level-equation output`,
    solverExecuted: targetEligible,
    note: record.note ?? null
  }) : null;
  return Object.freeze({
    policy: GIA_SOLVER_CACHE_777_POLICY,
    latitude: finite(record.latitude) ? clampLatitude(record.latitude) : null,
    longitude: finite(record.longitude) ? wrapLongitude(record.longitude) : null,
    cellId: record.cellId ?? null,
    targetEligible,
    run,
    sample,
    status: targetEligible ? "target-gia-output" : numeric ? "numeric-output-with-incomplete-run-provenance" : "missing-gia-components"
  });
}

export function validateGia777OutputCache(records = [], runMetadata = {}) {
  const run = normalizeGia777RunMetadata(runMetadata);
  const cells = records.map((record) => normalizeGia777OutputCell(record, run));
  const eligible = cells.filter((cell) => cell.targetEligible);
  return Object.freeze({
    policy: GIA_SOLVER_CACHE_777_POLICY,
    run,
    cells: Object.freeze(cells),
    eligible: Object.freeze(eligible),
    eligibleCellCount: eligible.length,
    rejectedCellCount: cells.length - eligible.length,
    status: !run.validForTargetAssimilation ? "run-rejected" : eligible.length ? "usable-spatial-gia-cache" : "valid-run-without-usable-cells",
    rule: "Numerical U/N fields are not trusted solely because they exist. A target-age GIA cache requires documented solver identity, ice history, Earth model and configuration hash before any cell can alter terrain or shoreline."
  });
}
