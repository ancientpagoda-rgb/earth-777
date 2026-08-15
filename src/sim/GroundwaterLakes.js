const SECONDS_PER_YEAR = 365.2425 * 86_400;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits));

export const GROUNDWATER_POLICY = "recharge-storage-baseflow-response-v1";
export const CLOSED_BASIN_LAKE_POLICY = "closed-basin-water-balance-spill-capture-v1";

function cellAt(topology, index) {
  const row = Math.floor(index / topology.cols);
  const col = index % topology.cols;
  return {
    row,
    col,
    latitude: 90 - (row + 0.5) * topology.spacingDegrees,
    longitude: -180 + (col + 0.5) * topology.spacingDegrees
  };
}

function neighborIndices(topology, index) {
  const { row, col } = cellAt(topology, index);
  const neighbors = [];
  for (let dRow = -1; dRow <= 1; dRow += 1) {
    for (let dCol = -1; dCol <= 1; dCol += 1) {
      if (dRow === 0 && dCol === 0) continue;
      const nextRow = row + dRow;
      if (nextRow < 0 || nextRow >= topology.rows) continue;
      const nextCol = ((col + dCol) % topology.cols + topology.cols) % topology.cols;
      neighbors.push(nextRow * topology.cols + nextCol);
    }
  }
  return neighbors;
}

function topologicalRoutingOrder(topology, downstream) {
  const indegree = new Uint16Array(topology.count);
  let landCount = 0;
  for (let index = 0; index < topology.count; index += 1) {
    if (!topology.landMask[index]) continue;
    landCount += 1;
    const target = downstream[index];
    if (target >= 0 && topology.landMask[target]) indegree[target] += 1;
  }
  const queue = [];
  for (let index = 0; index < topology.count; index += 1) {
    if (topology.landMask[index] && indegree[index] === 0) queue.push(index);
  }
  const order = [];
  let cursor = 0;
  while (cursor < queue.length) {
    const index = queue[cursor++];
    order.push(index);
    const target = downstream[index];
    if (target >= 0 && topology.landMask[target]) {
      indegree[target] -= 1;
      if (indegree[target] === 0) queue.push(target);
    }
  }
  return order.length === landCount ? Int32Array.from(order) : null;
}

function basinTerminals(topology) {
  const terminal = new Int32Array(topology.count);
  terminal.fill(-3);
  const reversed = Array.from(topology.routingOrder).reverse();
  for (const index of reversed) {
    const downstream = topology.downstream[index];
    if (downstream === -2) terminal[index] = index;
    else if (downstream === -1) terminal[index] = -1;
    else if (downstream >= 0) terminal[index] = terminal[downstream];
  }
  return terminal;
}

function volumeFromDepthMm(depthMm, areaKm2) {
  return Math.max(0, Number(depthMm) || 0) * Math.max(0, Number(areaKm2) || 0) * 1000;
}

export function resolveGroundwaterBaseflow(globalState, topology, fields) {
  if (!topology?.routingOrder || !topology?.cellAreaKm2) throw new TypeError("Groundwater requires a runoff topology.");
  const count = topology.count;
  const surface = fields?.surfaceRunoffMmPerYear;
  const deep = fields?.deepDrainageMmPerYear;
  const total = fields?.totalRunoffMmPerYear;
  if (!total || total.length !== count) throw new RangeError(`Groundwater total-runoff length must equal ${count}.`);

  const effectiveRunoffMmPerYear = new Float32Array(count);
  const baseflowMmPerYear = new Float32Array(count);
  const groundwaterStorageChangeMmPerYear = new Float32Array(count);
  const residenceTimeYears = new Float32Array(count);
  const baseflowFraction = new Float32Array(count);
  const elapsedYears = Math.max(0, Number(globalState?.elapsedYears) || 0);

  let landWaterInputM3PerYear = 0;
  let effectiveRoutedM3PerYear = 0;
  let groundwaterStorageChangeM3PerYear = 0;

  for (const index of topology.routingOrder) {
    const area = topology.cellAreaKm2[index];
    const totalRunoff = Math.max(0, Number(total[index]) || 0);
    const surfaceRunoff = Math.max(0, Number(surface?.[index]) || 0);
    const inferredDeep = Math.max(0, totalRunoff - surfaceRunoff);
    const recharge = Math.max(0, Number(deep?.[index]) || inferredDeep);
    const precipitationScale = clamp(fields?.precipitationScale?.[index] ?? 1, 0.12, 8);
    const soilCapacity = clamp(fields?.soilWaterCapacityMm?.[index] ?? 260, 40, 1400);

    // The checkpoint is treated as an equilibrated aquifer, not a newly empty
    // reservoir. Branch recharge departures then relax toward a new baseflow
    // state over a capacity- and aridity-dependent residence time.
    const baselineRecharge = recharge / (precipitationScale ** 0.72);
    const aridityResidence = 5200 / (1 + surfaceRunoff / 170);
    const residence = clamp(550 + soilCapacity * 6.5 + aridityResidence, 600, 18_000);
    const response = 1 - Math.exp(-elapsedYears / residence);
    const unconstrainedBaseflow = baselineRecharge + (recharge - baselineRecharge) * response;
    const baseflow = clamp(unconstrainedBaseflow, 0, Math.max(recharge * 2.5 + 2, baselineRecharge * 1.45 + 2));
    const storageChange = recharge - baseflow;
    const effective = Math.max(0, surfaceRunoff + baseflow);

    effectiveRunoffMmPerYear[index] = effective;
    baseflowMmPerYear[index] = baseflow;
    groundwaterStorageChangeMmPerYear[index] = storageChange;
    residenceTimeYears[index] = residence;
    baseflowFraction[index] = effective > 0 ? baseflow / effective : 0;

    landWaterInputM3PerYear += volumeFromDepthMm(surfaceRunoff + recharge, area);
    effectiveRoutedM3PerYear += volumeFromDepthMm(effective, area);
    groundwaterStorageChangeM3PerYear += storageChange * area * 1000;
  }

  const closureErrorM3PerYear = landWaterInputM3PerYear - effectiveRoutedM3PerYear - groundwaterStorageChangeM3PerYear;
  return Object.freeze({
    policy: GROUNDWATER_POLICY,
    effectiveRunoffMmPerYear,
    baseflowMmPerYear,
    groundwaterStorageChangeMmPerYear,
    residenceTimeYears,
    baseflowFraction,
    landWaterInputM3PerYear,
    effectiveRoutedM3PerYear,
    groundwaterStorageChangeM3PerYear,
    closureErrorM3PerYear,
    relativeClosureError: landWaterInputM3PerYear > 0 ? closureErrorM3PerYear / landWaterInputM3PerYear : 0,
    massConserved: Math.abs(closureErrorM3PerYear) <= Math.max(1e-5, landWaterInputM3PerYear * 1e-11),
    epistemicStatus: "deterministic coarse groundwater response: deep drainage recharges an equilibrated checkpoint aquifer, branch recharge departures relax through finite residence time into baseflow, and the unresolved remainder is tracked explicitly as aquifer storage change"
  });
}

function preliminaryAccumulation(topology, runoffMmPerYear) {
  const accumulated = new Float64Array(topology.count);
  for (const index of topology.routingOrder) accumulated[index] = volumeFromDepthMm(runoffMmPerYear[index], topology.cellAreaKm2[index]);
  for (const index of topology.routingOrder) {
    const downstream = topology.downstream[index];
    if (downstream >= 0) accumulated[downstream] += accumulated[index];
  }
  return accumulated;
}

function basinGeometry(topology, terminal) {
  const membersBySink = new Map();
  for (const index of topology.routingOrder) {
    const sink = terminal[index];
    if (sink < 0) continue;
    if (!membersBySink.has(sink)) membersBySink.set(sink, []);
    membersBySink.get(sink).push(index);
  }

  const infoBySink = new Map();
  for (const [sink, members] of membersBySink) {
    let basinAreaKm2 = 0;
    let spillElevationMeters = Infinity;
    let spillFromIndex = -1;
    let spillTargetIndex = -2;
    let spillTargetTerminal = -3;
    for (const index of members) {
      basinAreaKm2 += topology.cellAreaKm2[index];
      for (const neighbor of neighborIndices(topology, index)) {
        if (terminal[neighbor] === sink) continue;
        const neighborIsLand = Boolean(topology.landMask[neighbor]);
        const saddle = Math.max(
          topology.elevationMeters[index],
          neighborIsLand ? topology.elevationMeters[neighbor] : topology.seaLevelMeters
        );
        if (saddle < spillElevationMeters) {
          spillElevationMeters = saddle;
          spillFromIndex = index;
          spillTargetIndex = neighborIsLand ? neighbor : -1;
          spillTargetTerminal = neighborIsLand ? terminal[neighbor] : -1;
        }
      }
    }
    infoBySink.set(sink, {
      sink,
      members,
      basinAreaKm2,
      spillElevationMeters,
      spillFromIndex,
      spillTargetIndex,
      spillTargetTerminal
    });
  }
  return infoBySink;
}

function assignLakeCoverage(topology, info, areaKm2, surfaceElevationMeters, lakeIdByCell, lakeCoverageFractionByCell, lakeSurfaceElevationMetersByCell) {
  let remainingArea = Math.max(0, areaKm2);
  const members = [...info.members].sort((a, b) => topology.elevationMeters[a] - topology.elevationMeters[b] || a - b);
  for (const index of members) {
    if (remainingArea <= 0) break;
    if (topology.elevationMeters[index] > surfaceElevationMeters + 0.01) continue;
    const cellArea = topology.cellAreaKm2[index];
    const fraction = clamp(remainingArea / Math.max(1e-9, cellArea), 0, 1);
    if (fraction <= 0) continue;
    lakeIdByCell[index] = info.sink;
    lakeCoverageFractionByCell[index] = fraction;
    lakeSurfaceElevationMetersByCell[index] = surfaceElevationMeters;
    remainingArea -= cellArea * fraction;
  }
}

export function resolveClosedBasinLakes(globalState, topology, runoffMmPerYear, fields = {}) {
  if (!topology?.routingOrder || !topology?.downstream) throw new TypeError("Lake solver requires a runoff topology.");
  if (!runoffMmPerYear || runoffMmPerYear.length !== topology.count) throw new RangeError(`Lake runoff length must equal ${topology.count}.`);

  const terminal = basinTerminals(topology);
  const infoBySink = basinGeometry(topology, terminal);
  const preliminaryVolume = preliminaryAccumulation(topology, runoffMmPerYear);
  const downstream = new Int32Array(topology.downstream);
  const adjustedRunoffMmPerYear = new Float32Array(runoffMmPerYear);
  const lakeIdByCell = new Int32Array(topology.count);
  lakeIdByCell.fill(-1);
  const lakeCoverageFractionByCell = new Float32Array(topology.count);
  const lakeSurfaceElevationMetersByCell = new Float32Array(topology.count);
  lakeSurfaceElevationMetersByCell.fill(Number.NaN);
  const lakeDepthMetersByCell = new Float32Array(topology.count);
  const lakeRecords = [];

  let spillingLakeCount = 0;
  let closedLakeCount = 0;
  let lakeEvaporationM3PerYear = 0;
  let totalLakeAreaKm2 = 0;
  let totalLakeStorageM3 = 0;

  // Spill saddles define a strictly decreasing potential for basin-to-basin
  // transfers. That prevents two neighboring filled basins from pointing into
  // each other while still allowing capture cascades toward a lower basin or ocean.
  for (const info of infoBySink.values()) {
    const sink = info.sink;
    const inflowM3PerYear = Math.max(0, preliminaryVolume[sink]);
    const sinkAreaKm2 = topology.cellAreaKm2[sink];
    const memberCount = info.members.length;
    const maxLakeAreaKm2 = Math.max(
      Math.min(info.basinAreaKm2 * 0.24, sinkAreaKm2 * (1 + Math.sqrt(memberCount) * 0.82)),
      Math.min(sinkAreaKm2, info.basinAreaKm2)
    );
    const sinkElevation = topology.elevationMeters[sink];
    const finiteSpill = Number.isFinite(info.spillElevationMeters);
    const depthToSpillMeters = finiteSpill ? Math.max(0.25, info.spillElevationMeters - sinkElevation) : 0;
    const precipitation = Math.max(0, Number(fields.precipitationMmPerYear?.[sink]) || 0);
    const pet = Math.max(0, Number(fields.potentialEvapotranspirationMmPerYear?.[sink]) || 0);
    const netEvaporationMmPerYear = Math.max(0, pet - precipitation);
    const fullLakeEvaporationM3PerYear = volumeFromDepthMm(netEvaporationMmPerYear, maxLakeAreaKm2);
    const equilibriumAreaKm2 = netEvaporationMmPerYear > 1e-6
      ? Math.min(maxLakeAreaKm2, inflowM3PerYear / (netEvaporationMmPerYear * 1000))
      : maxLakeAreaKm2;
    const fillFraction = maxLakeAreaKm2 > 0 ? clamp(equilibriumAreaKm2 / maxLakeAreaKm2, 0, 1) : 0;
    const theoreticalOverflowM3PerYear = Math.max(0, inflowM3PerYear - fullLakeEvaporationM3PerYear);

    let canSpill = theoreticalOverflowM3PerYear > 0 && finiteSpill && info.spillTargetIndex !== -2;
    if (canSpill && info.spillTargetTerminal >= 0) {
      const targetInfo = infoBySink.get(info.spillTargetTerminal);
      const targetPotential = targetInfo?.spillElevationMeters ?? Infinity;
      canSpill = targetPotential < info.spillElevationMeters - 0.01;
    }

    let lakeAreaKm2 = equilibriumAreaKm2;
    let lakeSurfaceElevationMeters = sinkElevation + depthToSpillMeters * (fillFraction ** 0.7);
    let evaporationM3PerYear = Math.min(inflowM3PerYear, volumeFromDepthMm(netEvaporationMmPerYear, lakeAreaKm2));
    let overflowM3PerYear = 0;
    let spillTargetIndex = -2;

    if (canSpill) {
      lakeAreaKm2 = maxLakeAreaKm2;
      lakeSurfaceElevationMeters = info.spillElevationMeters;
      evaporationM3PerYear = Math.min(inflowM3PerYear, fullLakeEvaporationM3PerYear);
      overflowM3PerYear = Math.max(0, inflowM3PerYear - evaporationM3PerYear);
      spillTargetIndex = info.spillTargetIndex;
      downstream[sink] = spillTargetIndex;
      const transmission = inflowM3PerYear > 0 ? overflowM3PerYear / inflowM3PerYear : 0;
      for (const member of info.members) adjustedRunoffMmPerYear[member] *= transmission;
      spillingLakeCount += 1;
    } else {
      closedLakeCount += 1;
    }

    const meanDepthMeters = depthToSpillMeters * (canSpill ? 0.42 : 0.42 * fillFraction);
    const storageM3 = lakeAreaKm2 * 1_000_000 * meanDepthMeters;
    totalLakeAreaKm2 += lakeAreaKm2;
    totalLakeStorageM3 += storageM3;
    if (canSpill) lakeEvaporationM3PerYear += evaporationM3PerYear;
    assignLakeCoverage(topology, info, lakeAreaKm2, lakeSurfaceElevationMeters, lakeIdByCell, lakeCoverageFractionByCell, lakeSurfaceElevationMetersByCell);
    for (const member of info.members) {
      if (lakeIdByCell[member] === sink) lakeDepthMetersByCell[member] = Math.max(0, lakeSurfaceElevationMeters - topology.elevationMeters[member]);
    }

    lakeRecords.push(Object.freeze({
      sinkIndex: sink,
      basinCellCount: memberCount,
      basinAreaKm2: round(info.basinAreaKm2, 3),
      lakeAreaKm2: round(lakeAreaKm2, 3),
      lakeSurfaceElevationMeters: round(lakeSurfaceElevationMeters, 2),
      meanDepthMeters: round(meanDepthMeters, 2),
      storageM3: round(storageM3, 0),
      inflowM3PerYear: round(inflowM3PerYear, 0),
      evaporationM3PerYear: round(evaporationM3PerYear, 0),
      overflowM3PerYear: round(overflowM3PerYear, 0),
      spillElevationMeters: finiteSpill ? round(info.spillElevationMeters, 2) : null,
      spillTargetIndex,
      spilling: canSpill,
      fillFraction: round(canSpill ? 1 : fillFraction, 4)
    }));
  }

  let routingOrder = topologicalRoutingOrder(topology, downstream);
  if (!routingOrder) {
    // Extremely pathological coarse grids can still produce a spill-cycle if
    // equal saddles collapse under floating-point rounding. Preserve safety by
    // falling back to ocean spills only; closed basins remain explicit lakes.
    downstream.set(topology.downstream);
    adjustedRunoffMmPerYear.set(runoffMmPerYear);
    spillingLakeCount = 0;
    lakeEvaporationM3PerYear = 0;
    for (const record of lakeRecords) {
      if (record.spilling && record.spillTargetIndex === -1) {
        downstream[record.sinkIndex] = -1;
        const transmission = record.inflowM3PerYear > 0 ? record.overflowM3PerYear / record.inflowM3PerYear : 0;
        const info = infoBySink.get(record.sinkIndex);
        for (const member of info.members) adjustedRunoffMmPerYear[member] *= transmission;
        lakeEvaporationM3PerYear += record.evaporationM3PerYear;
        spillingLakeCount += 1;
      }
    }
    routingOrder = topologicalRoutingOrder(topology, downstream) ?? topology.routingOrder;
  }

  let adjustedLocalRunoffM3PerYear = 0;
  for (const index of topology.routingOrder) adjustedLocalRunoffM3PerYear += volumeFromDepthMm(adjustedRunoffMmPerYear[index], topology.cellAreaKm2[index]);
  let oceanOutletCells = 0;
  let closedBasinSinkCells = 0;
  for (const index of topology.routingOrder) {
    if (downstream[index] === -1) oceanOutletCells += 1;
    else if (downstream[index] === -2) closedBasinSinkCells += 1;
  }

  const hydrologicTopology = Object.freeze({
    ...topology,
    downstream,
    routingOrder,
    oceanOutletCells,
    closedBasinSinkCells,
    elevationPolicy: `${topology.elevationPolicy}; overflowing closed-basin lakes add hydraulic spill links`,
    hydraulicLakeLinks: spillingLakeCount,
    epistemicStatus: `${topology.epistemicStatus}; overflowing closed basins are routed over explicit spill saddles while non-spilling basins retain water`
  });

  return Object.freeze({
    policy: CLOSED_BASIN_LAKE_POLICY,
    topology: hydrologicTopology,
    adjustedRunoffMmPerYear,
    lakeIdByCell,
    lakeCoverageFractionByCell,
    lakeSurfaceElevationMetersByCell,
    lakeDepthMetersByCell,
    lakes: Object.freeze(lakeRecords),
    lakeCount: lakeRecords.length,
    spillingLakeCount,
    closedLakeCount,
    totalLakeAreaKm2,
    totalLakeStorageM3,
    lakeEvaporationM3PerYear,
    adjustedLocalRunoffM3PerYear,
    meanLakeDischargeM3s: lakeRecords.reduce((sum, lake) => sum + lake.overflowM3PerYear, 0) / SECONDS_PER_YEAR,
    epistemicStatus: "coarse closed-basin lake water balance over the evolved geomorphic drainage surface; basin inflow competes with net lake evaporation, lakes occupy the lowest basin cells, and only hydraulically full basins may cross a spill saddle into a lower-potential basin or the ocean"
  });
}
