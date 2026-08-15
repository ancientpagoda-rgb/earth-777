import {
  accumulateRunoffNetwork,
  buildRunoffNetworkTopology,
  networkCellAt
} from "./RunoffRouting.js";

const EARTH_RADIUS_KM = 6371.0088;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits));

export const DYNAMIC_GEOMORPHOLOGY_POLICY = "stream-power-sediment-routing-landscape-response-v1";

function cellAt(topology, index) {
  const row = Math.floor(index / topology.cols);
  const col = index % topology.cols;
  return {
    latitude: 90 - (row + 0.5) * topology.spacingDegrees,
    longitude: -180 + (col + 0.5) * topology.spacingDegrees
  };
}

function distanceKm(a, b) {
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function downstreamSlope(topology, index) {
  const downstreamIndex = topology.downstream[index];
  if (downstreamIndex < 0) return 0;
  const here = cellAt(topology, index);
  const there = cellAt(topology, downstreamIndex);
  const distanceMeters = Math.max(1, distanceKm(here, there) * 1000);
  return Math.max(0, (topology.elevationMeters[index] - topology.elevationMeters[downstreamIndex]) / distanceMeters);
}

function effectiveResponseYears(elapsedYears, boundaryActivity) {
  const activity = clamp(boundaryActivity ?? 1, 0.05, 4);
  const tauYears = 280_000 / Math.sqrt(activity);
  return tauYears * (1 - Math.exp(-Math.max(0, Number(elapsedYears) || 0) / tauYears));
}

export function evolveRunoffNetworkTopography(
  globalState,
  preliminaryTopology,
  localRunoffMmPerYear,
  climateForcedMask = null
) {
  if (!preliminaryTopology?.routingOrder || !preliminaryTopology?.elevationMeters) {
    throw new TypeError("Dynamic geomorphology requires a preliminary runoff-network topology.");
  }
  if (!localRunoffMmPerYear || localRunoffMmPerYear.length !== preliminaryTopology.count) {
    throw new RangeError(`Dynamic geomorphology runoff length must equal ${preliminaryTopology.count}.`);
  }

  const elapsedYears = Math.max(0, Number(globalState?.elapsedYears) || 0);
  const preliminaryWater = accumulateRunoffNetwork(preliminaryTopology, localRunoffMmPerYear, climateForcedMask);
  const erosionRateMmPerYear = new Float32Array(preliminaryTopology.count);
  const depositionRateMmPerYear = new Float32Array(preliminaryTopology.count);
  const netElevationOffsetMeters = new Float32Array(preliminaryTopology.count);
  const sedimentIncomingM3PerYear = new Float64Array(preliminaryTopology.count);
  const sedimentOutgoingM3PerYear = new Float64Array(preliminaryTopology.count);
  const evolvedElevationMeters = new Float32Array(preliminaryTopology.elevationMeters);

  const productivity = clamp(globalState?.productivityIndex ?? 1, 0.03, 6);
  const vegetationProtection = 1 / (0.55 + 0.45 * Math.sqrt(productivity));
  const responseYears = effectiveResponseYears(elapsedYears, globalState?.tectonicBoundaryActivity);
  let generatedSedimentM3PerYear = 0;
  let depositedSedimentM3PerYear = 0;
  let oceanSedimentExportM3PerYear = 0;
  let closedBasinSedimentRetentionM3PerYear = 0;
  let activeErosionCells = 0;
  let activeDepositionCells = 0;

  // The preliminary topology provides a non-recursive first pass. Water is
  // accumulated on that surface, sediment is routed once, then the changed
  // elevation field is allowed to choose a new drainage topology.
  for (const index of preliminaryTopology.routingOrder) {
    const slope = downstreamSlope(preliminaryTopology, index);
    const discharge = Math.max(0, preliminaryWater.meanDischargeM3s[index]);
    const localRunoff = Math.max(0, Number(localRunoffMmPerYear[index]) || 0);
    const dischargeTerm = Math.log1p(discharge / 0.35) ** 0.48;
    const slopeTerm = Math.sqrt(Math.max(0, slope) / 0.001 + 0.015);
    const runoffTerm = Math.sqrt(localRunoff / 650 + 0.02);
    const erosionRate = Math.max(0, 0.0025 * vegetationProtection * runoffTerm + 0.009 * vegetationProtection * dischargeTerm * slopeTerm);
    erosionRateMmPerYear[index] = erosionRate;
    if (erosionRate > 0.005) activeErosionCells += 1;

    const cellAreaKm2 = preliminaryTopology.cellAreaKm2[index];
    const locallyGenerated = erosionRate * cellAreaKm2 * 1000;
    generatedSedimentM3PerYear += locallyGenerated;
    const availableSediment = sedimentIncomingM3PerYear[index] + locallyGenerated;
    const downstreamIndex = preliminaryTopology.downstream[index];

    let depositionFraction;
    if (downstreamIndex === -2) depositionFraction = 1;
    else if (downstreamIndex === -1) depositionFraction = clamp(0.035 + 0.18 / (1 + discharge / 80), 0.02, 0.2);
    else depositionFraction = clamp(
      0.34 * Math.exp(-slope / 0.0018) / (1 + Math.sqrt(discharge / 60)),
      0.002,
      0.42
    );

    const deposited = availableSediment * depositionFraction;
    const outgoing = availableSediment - deposited;
    depositedSedimentM3PerYear += deposited;
    sedimentOutgoingM3PerYear[index] = outgoing;
    const depositionRate = cellAreaKm2 > 0 ? deposited / (cellAreaKm2 * 1000) : 0;
    depositionRateMmPerYear[index] = depositionRate;
    if (depositionRate > 0.005) activeDepositionCells += 1;

    if (downstreamIndex >= 0) sedimentIncomingM3PerYear[downstreamIndex] += outgoing;
    else if (downstreamIndex === -1) oceanSedimentExportM3PerYear += outgoing;
    else closedBasinSedimentRetentionM3PerYear += outgoing;
  }

  for (const index of preliminaryTopology.routingOrder) {
    if (elapsedYears <= 0) continue;
    const rawOffsetMeters = (depositionRateMmPerYear[index] - erosionRateMmPerYear[index]) * responseYears / 1000;
    const elevation = preliminaryTopology.elevationMeters[index];
    // Landscape adjustment approaches a relief-dependent equilibrium rather
    // than using a hard elevation cap. This keeps coarse cells from inverting
    // unrealistically while still allowing drainage divides to migrate.
    const reliefResponseMeters = 85 + Math.sqrt(Math.max(0, Math.abs(elevation))) * 17;
    const offsetMeters = reliefResponseMeters * Math.tanh(rawOffsetMeters / reliefResponseMeters);
    netElevationOffsetMeters[index] = offsetMeters;
    evolvedElevationMeters[index] = elevation + offsetMeters;
  }

  const elevationAt = (latitude, longitude) => {
    const cell = networkCellAt(preliminaryTopology, latitude, longitude);
    return evolvedElevationMeters[cell.index];
  };
  const topology = buildRunoffNetworkTopology({
    spacingDegrees: preliminaryTopology.spacingDegrees,
    seaLevelMeters: preliminaryTopology.seaLevelMeters,
    elevationAt,
    elevationPolicy: "dynamic tectonic surface plus runoff-driven erosion and sediment redistribution"
  });

  let reroutedCellCount = 0;
  let shorelineChangedCellCount = 0;
  let maxAbsoluteElevationChangeMeters = 0;
  let meanAbsoluteElevationChangeMeters = 0;
  let comparedLandCells = 0;
  for (let index = 0; index < preliminaryTopology.count; index += 1) {
    if (preliminaryTopology.landMask[index] !== topology.landMask[index]) shorelineChangedCellCount += 1;
    if (preliminaryTopology.landMask[index] && topology.landMask[index]) {
      comparedLandCells += 1;
      if (preliminaryTopology.downstream[index] !== topology.downstream[index]) reroutedCellCount += 1;
    }
    const change = Math.abs(evolvedElevationMeters[index] - preliminaryTopology.elevationMeters[index]);
    maxAbsoluteElevationChangeMeters = Math.max(maxAbsoluteElevationChangeMeters, change);
    meanAbsoluteElevationChangeMeters += change;
  }
  meanAbsoluteElevationChangeMeters /= Math.max(1, preliminaryTopology.count);

  const sedimentClosureErrorM3PerYear = generatedSedimentM3PerYear
    - depositedSedimentM3PerYear
    - oceanSedimentExportM3PerYear
    - closedBasinSedimentRetentionM3PerYear;
  const sedimentRelativeClosureError = generatedSedimentM3PerYear > 0
    ? sedimentClosureErrorM3PerYear / generatedSedimentM3PerYear
    : 0;

  return Object.freeze({
    policy: DYNAMIC_GEOMORPHOLOGY_POLICY,
    topology,
    preliminaryTopology,
    preliminaryWater,
    erosionRateMmPerYear,
    depositionRateMmPerYear,
    netElevationOffsetMeters,
    evolvedElevationMeters,
    sedimentIncomingM3PerYear,
    sedimentOutgoingM3PerYear,
    effectiveResponseYears: responseYears,
    vegetationProtectionFactor: vegetationProtection,
    generatedSedimentM3PerYear,
    depositedSedimentM3PerYear,
    oceanSedimentExportM3PerYear,
    closedBasinSedimentRetentionM3PerYear,
    sedimentClosureErrorM3PerYear,
    sedimentRelativeClosureError,
    sedimentMassConserved: Math.abs(sedimentClosureErrorM3PerYear) <= Math.max(1e-5, generatedSedimentM3PerYear * 1e-11),
    activeErosionCells,
    activeDepositionCells,
    reroutedCellCount,
    shorelineChangedCellCount,
    comparedLandCells,
    maxAbsoluteElevationChangeMeters: round(maxAbsoluteElevationChangeMeters, 3),
    meanAbsoluteElevationChangeMeters: round(meanAbsoluteElevationChangeMeters, 4),
    epistemicStatus: "deterministic coarse-grid stream-power erosion and conservative sediment routing over a preliminary tectonic drainage network, followed by one drainage-topology rebuild; this is an intermediate-complexity effective landscape response, not resolved channel/floodplain morphodynamics"
  });
}
