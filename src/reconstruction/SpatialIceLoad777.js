const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clampLatitude = (value) => Math.max(-90, Math.min(90, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 540) % 360) - 180;
const positiveSigma = (value) => finite(value) && Number(value) > 0 ? Number(value) : null;

export const SPATIAL_ICE_LOAD_777_POLICY = "explicit-target-ice-load-provenance-v1";
export const ICE_DENSITY_KG_M3 = 917;

function normalizeSource(record) {
  return Object.freeze({
    modelId: record.modelId ?? null,
    runId: record.runId ?? null,
    sourceId: record.sourceId ?? null,
    sourceDoi: record.sourceDoi ?? null,
    configurationId: record.configurationId ?? null,
    transformedToTargetIceLoad: Boolean(record.transformedToTargetIceLoad),
    directThicknessConstraint: Boolean(record.directThicknessConstraint),
    method: record.method ?? null
  });
}

/**
 * Normalize one spatial ice-load cell at the 777 ka target.
 *
 * Unknown ice is represented by absence of a record, never by an implicit 0 m cell.
 * A numeric thickness is eligible only when it is either a direct target-age
 * thickness constraint or the output of an explicitly documented transformation /
 * dynamic ice reconstruction to 777 ka.
 */
export function normalizeIceLoad777Cell(record = {}) {
  const source = normalizeSource(record);
  const thickness = finite(record.iceThicknessMeters) ? Math.max(0, Number(record.iceThicknessMeters)) : null;
  const eligible = thickness != null && (source.directThicknessConstraint || source.transformedToTargetIceLoad);
  const cellAreaM2 = finite(record.cellAreaM2) && Number(record.cellAreaM2) > 0 ? Number(record.cellAreaM2) : null;
  const sigma = positiveSigma(record.sigmaMeters);
  const iceVolumeM3 = eligible && cellAreaM2 != null ? thickness * cellAreaM2 : null;
  const iceMassKg = iceVolumeM3 == null ? null : iceVolumeM3 * ICE_DENSITY_KG_M3;
  return Object.freeze({
    policy: SPATIAL_ICE_LOAD_777_POLICY,
    latitude: finite(record.latitude) ? clampLatitude(record.latitude) : null,
    longitude: finite(record.longitude) ? wrapLongitude(record.longitude) : null,
    targetYearBP: finite(record.targetYearBP) ? Math.max(0, Number(record.targetYearBP)) : 777_000,
    iceThicknessMeters: thickness,
    sigmaMeters: sigma,
    cellAreaM2,
    iceVolumeM3,
    iceMassKg,
    groundedFraction: finite(record.groundedFraction) ? Math.max(0, Math.min(1, Number(record.groundedFraction))) : null,
    source,
    targetEligible: eligible,
    status: eligible ? "target-ice-load" : thickness == null ? "no-thickness-value" : "thickness-not-authorized-as-target-load",
    note: record.note ?? "A spatial ice thickness can affect Earth 777 only when direct target-age evidence or an explicit target reconstruction authorizes it."
  });
}

export function validateIceLoad777Grid(records = [], {
  requireExactTargetAge = true,
  targetYearBP = 777_000
} = {}) {
  const cells = records.map(normalizeIceLoad777Cell);
  const eligible = cells.filter((cell) => cell.targetEligible && (!requireExactTargetAge || cell.targetYearBP === targetYearBP));
  const rejected = cells.filter((cell) => !eligible.includes(cell));
  const totalKnownIceVolumeM3 = eligible.reduce((sum, cell) => sum + (cell.iceVolumeM3 ?? 0), 0);
  const totalKnownIceMassKg = eligible.reduce((sum, cell) => sum + (cell.iceMassKg ?? 0), 0);
  const areaComplete = eligible.every((cell) => cell.cellAreaM2 != null);
  return Object.freeze({
    policy: SPATIAL_ICE_LOAD_777_POLICY,
    targetYearBP,
    cells: Object.freeze(cells),
    eligible: Object.freeze(eligible),
    rejected: Object.freeze(rejected),
    eligibleCellCount: eligible.length,
    rejectedCellCount: rejected.length,
    totalKnownIceVolumeM3: areaComplete ? totalKnownIceVolumeM3 : null,
    totalKnownIceMassKg: areaComplete ? totalKnownIceMassKg : null,
    volumeClosureAvailable: areaComplete && eligible.length > 0,
    rule: "Missing cells are unknown rather than ice-free. A complete global or regional ice-volume claim requires explicit spatial coverage metadata in addition to finite cell areas."
  });
}

export function iceLoad777VolumeClosure(grid, {
  targetSeaLevelEquivalentVolumeM3 = null,
  targetSeaLevelEquivalentSigmaM3 = null,
  coverageFraction = null
} = {}) {
  const modeled = grid?.totalKnownIceVolumeM3;
  const target = finite(targetSeaLevelEquivalentVolumeM3) ? Number(targetSeaLevelEquivalentVolumeM3) : null;
  const sigma = positiveSigma(targetSeaLevelEquivalentSigmaM3);
  const coverage = finite(coverageFraction) ? Math.max(0, Math.min(1, Number(coverageFraction))) : null;
  const completeCoverage = coverage === 1;
  const residualM3 = modeled != null && target != null && completeCoverage ? modeled - target : null;
  return Object.freeze({
    modeledIceVolumeM3: modeled,
    targetSeaLevelEquivalentVolumeM3: target,
    targetSigmaM3: sigma,
    coverageFraction: coverage,
    completeCoverage,
    residualM3,
    normalizedResidualSigma: residualM3 != null && sigma != null ? residualM3 / sigma : null,
    closureStatus: residualM3 == null ? "insufficient-coverage-or-target" : "comparable",
    caveat: "A global eustatic sea-level estimate can constrain net ocean-volume/land-ice balance, but it does not locate ice. Thermal, density, chronology, shoreline and model assumptions must be documented before treating a sea-level equivalent as an ice-volume target."
  });
}
