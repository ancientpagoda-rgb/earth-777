const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const smoothstep01 = (value) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

export const TERRAIN_COUPLED_HYDROLOGY_POLICY = "displayed-terrain-d8-basin-wetland-v1";

function neighbors(index, side) {
  const row = Math.floor(index / side);
  const col = index % side;
  const result = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= side || c < 0 || c >= side) continue;
      result.push(r * side + c);
    }
  }
  return result;
}

function isBoundary(index, side) {
  const row = Math.floor(index / side);
  const col = index % side;
  return row === 0 || col === 0 || row === side - 1 || col === side - 1;
}

function terminalFor(index, downstream, memo) {
  if (memo[index] !== -99) return memo[index];
  const visited = [];
  let current = index;
  const guard = downstream.length + 2;
  for (let steps = 0; steps < guard; steps += 1) {
    if (current < 0) {
      const terminal = current;
      for (const cell of visited) memo[cell] = terminal;
      return terminal;
    }
    if (memo[current] !== -99) {
      const terminal = memo[current];
      for (const cell of visited) memo[cell] = terminal;
      return terminal;
    }
    visited.push(current);
    const next = downstream[current];
    if (next === -2) {
      for (const cell of visited) memo[cell] = current;
      memo[current] = current;
      return current;
    }
    if (next < 0) {
      for (const cell of visited) memo[cell] = next;
      return next;
    }
    current = next;
  }
  for (const cell of visited) memo[cell] = -4;
  return -4;
}

export function solveTerrainCoupledHydrology({
  elevations,
  positions = null,
  vertexSide,
  seaLevelMeters = 0,
  runoffMmPerYear = 0,
  routedDischargeM3s = 0,
  lakeCoverageFraction = 0,
  lakeSurfaceElevationMeters = Number.NaN,
  boundaryOutletElevationMeters = null
} = {}) {
  const side = Math.max(2, Math.round(Number(vertexSide) || 0));
  const count = side * side;
  if (!elevations || elevations.length !== count) throw new RangeError(`Hydrology elevation grid must contain ${count} values.`);

  const downstream = new Int32Array(count);
  const accumulation = new Float32Array(count);
  const slope = new Float32Array(count);
  const streamStrength = new Float32Array(count);
  const wetlandStrength = new Float32Array(count);
  const lakeStrength = new Float32Array(count);
  const lakeSurfaceByCell = new Float32Array(count);
  lakeSurfaceByCell.fill(Number.NaN);
  downstream.fill(-3);

  const land = [];
  const sea = Number(seaLevelMeters) || 0;
  for (let index = 0; index < count; index += 1) {
    const elevation = Number(elevations[index]);
    if (!Number.isFinite(elevation) || elevation <= sea) continue;
    land.push(index);
    accumulation[index] = 1;

    let best = -1;
    let bestDrop = 0.05;
    for (const neighbor of neighbors(index, side)) {
      const drop = elevation - Number(elevations[neighbor]);
      if (drop > bestDrop) {
        bestDrop = drop;
        best = neighbor;
      }
    }

    if (isBoundary(index, side) && boundaryOutletElevationMeters && Number.isFinite(boundaryOutletElevationMeters[index])) {
      const externalDrop = elevation - Number(boundaryOutletElevationMeters[index]);
      if (externalDrop > bestDrop) {
        downstream[index] = -4;
        slope[index] = externalDrop;
        continue;
      }
    }

    if (best >= 0) {
      downstream[index] = Number(elevations[best]) <= sea ? -3 : best;
      slope[index] = bestDrop;
    } else {
      downstream[index] = isBoundary(index, side) ? -4 : -2;
      slope[index] = 0;
    }
  }

  land.sort((a, b) => Number(elevations[b]) - Number(elevations[a]) || a - b);
  for (const index of land) {
    const target = downstream[index];
    if (target >= 0) accumulation[target] += accumulation[index];
  }

  const terminalByCell = new Int32Array(count);
  terminalByCell.fill(-99);
  const basinMembers = new Map();
  for (const index of land) {
    const terminal = terminalFor(index, downstream, terminalByCell);
    if (terminal < 0) continue;
    if (!basinMembers.has(terminal)) basinMembers.set(terminal, []);
    basinMembers.get(terminal).push(index);
  }

  // One boundary scan resolves spill saddles for every closed basin. This keeps
  // the solver close to O(n) even on the denser center meshes.
  const spillByTerminal = new Map();
  for (const index of land) {
    const terminal = terminalByCell[index];
    if (terminal < 0) continue;
    for (const neighbor of neighbors(index, side)) {
      if (terminalByCell[neighbor] === terminal) continue;
      const saddle = Math.max(Number(elevations[index]), Number(elevations[neighbor]));
      const previous = spillByTerminal.get(terminal);
      if (!Number.isFinite(previous) || saddle < previous) spillByTerminal.set(terminal, saddle);
    }
  }

  const runoffScale = clamp(Math.log1p(Math.max(0, Number(runoffMmPerYear) || 0)) / Math.log1p(1800), 0, 1);
  const dischargeScale = clamp(Math.log1p(Math.max(0, Number(routedDischargeM3s) || 0)) / Math.log1p(25_000), 0, 1);
  let maxAccumulation = 2;
  for (const index of land) maxAccumulation = Math.max(maxAccumulation, Number(accumulation[index]) || 0);
  const logMax = Math.log1p(maxAccumulation);

  for (const index of land) {
    const normalizedAccumulation = logMax > 0 ? Math.log1p(accumulation[index]) / logMax : 0;
    const streamThreshold = 0.48 - runoffScale * 0.12 - dischargeScale * 0.10;
    const stream = downstream[index] >= 0
      ? smoothstep01((normalizedAccumulation - streamThreshold) / Math.max(0.08, 0.28 - runoffScale * 0.08))
      : 0;
    streamStrength[index] = stream;

    const flatness = 1 - smoothstep01((slope[index] - 0.2) / 12);
    const lowlandWetness = smoothstep01((normalizedAccumulation + runoffScale * 0.55 - 0.42) / 0.52);
    const floodplain = smoothstep01((stream + normalizedAccumulation * 0.45 - 0.48) / 0.52);
    wetlandStrength[index] = clamp(flatness * lowlandWetness * 0.72 + floodplain * flatness * 0.46, 0, 1);
  }

  const desiredLakeFraction = clamp(Number(lakeCoverageFraction), 0, 1);
  if (desiredLakeFraction > 0.002 && basinMembers.size) {
    const rankedBasins = [...basinMembers.entries()]
      .map(([terminal, members]) => ({ terminal, members, score: members.length + accumulation[terminal] * 0.75 }))
      .sort((a, b) => b.score - a.score);
    const desiredCells = Math.max(1, Math.round(count * Math.min(0.65, desiredLakeFraction)));
    let assigned = 0;

    for (const basin of rankedBasins) {
      if (assigned >= desiredCells) break;
      const sinkElevation = Number(elevations[basin.terminal]);
      const spill = spillByTerminal.get(basin.terminal);
      const finiteSpill = Number.isFinite(spill) && spill > sinkElevation + 0.02;
      const modelSurface = Number(lakeSurfaceElevationMeters);
      const spillCeiling = finiteSpill ? Math.max(sinkElevation, spill - 0.02) : Number.POSITIVE_INFINITY;
      const waterSurface = Number.isFinite(modelSurface)
        ? clamp(modelSurface, sinkElevation, spillCeiling)
        : sinkElevation + (finiteSpill ? Math.min(spill - sinkElevation, 3 + Math.log1p(basin.members.length) * 1.8) : 2);
      const sorted = [...basin.members].sort((a, b) => Number(elevations[a]) - Number(elevations[b]) || a - b);
      for (const index of sorted) {
        if (assigned >= desiredCells) break;
        if (Number(elevations[index]) > waterSurface + 0.01) break;
        const depth = Math.max(0, waterSurface - Number(elevations[index]));
        lakeStrength[index] = clamp(0.62 + depth / 12, 0.62, 1);
        lakeSurfaceByCell[index] = waterSurface;
        wetlandStrength[index] = Math.max(wetlandStrength[index], 0.75);
        assigned += 1;
      }
    }
  }

  const streamSegments = [];
  if (positions && positions.length === count * 3) {
    for (const index of land) {
      const target = downstream[index];
      if (target < 0 || streamStrength[index] < 0.38) continue;
      const a = index * 3;
      const b = target * 3;
      streamSegments.push(
        positions[a], positions[a + 1] + 0.00035, positions[a + 2],
        positions[b], positions[b + 1] + 0.00035, positions[b + 2],
        streamStrength[index]
      );
    }
  }

  return {
    policy: TERRAIN_COUPLED_HYDROLOGY_POLICY,
    downstream,
    accumulation,
    streamStrength,
    wetlandStrength,
    lakeStrength,
    lakeSurfaceByCell,
    streamSegments: new Float32Array(streamSegments),
    sinkCount: basinMembers.size,
    maxAccumulation,
    runoffScale,
    dischargeScale
  };
}
