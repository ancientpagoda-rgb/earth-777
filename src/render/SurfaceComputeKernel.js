import { reconstructedBedrockElevation777At } from "../reconstruction/TerrainReconstruction777.js";
import { regionalTerrainResidualAt, regionalTerrainResidualAtPatches } from "../reconstruction/RuntimeRegionalTerrainPatch.js";
import { tectonicElevationOffsetMeters } from "../sim/DynamicLithosphere.js";
import { solveTerrainCoupledHydrology } from "./TerrainCoupledHydrology.js";
import { gridIndicesForSegments } from "./TerrainGridTopology.js";

const KM_PER_DEGREE_LATITUDE = 111.32;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const mix = (a, b, t) => a + (b - a) * t;
const wrapLongitudeDelta = (value) => ((Number(value) + 540) % 360) - 180;
const fract = (value) => value - Math.floor(value);
const random01 = (seed) => fract(Math.sin(seed * 12.9898 + 78.233) * 43758.5453123);
const seedFor = (latitude, longitude, x, z, salt = 0) => (latitude + 90) * 197.3 + (longitude + 180) * 389.7 + x * 911.1 + z * 617.3 + salt * 131.9;
const smoothstep01 = (value) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

function geographicAt(config, xKm, zKm) {
  const latitude = config.origin.latitude + zKm / KM_PER_DEGREE_LATITUDE;
  const longitudeScale = Math.max(12, KM_PER_DEGREE_LATITUDE * Math.cos(config.origin.latitude * Math.PI / 180));
  const longitude = config.origin.longitude + xKm / longitudeScale;
  return { latitude, longitude };
}

function geomorphicOffsetAt(config, latitude, longitude) {
  const patch = config.geomorphologyPatch;
  if (!patch) return 0;
  const northKm = (Number(latitude) - Number(patch.networkLatitude)) * KM_PER_DEGREE_LATITUDE;
  const eastKm = wrapLongitudeDelta(Number(longitude) - Number(patch.networkLongitude))
    * KM_PER_DEGREE_LATITUDE
    * Math.max(0.12, Math.cos(Number(patch.networkLatitude) * Math.PI / 180));
  return (Number(patch.geomorphicElevationOffsetMeters) || 0)
    + eastKm * (Number(patch.geomorphicGradientEastMetersPerKm) || 0)
    + northKm * (Number(patch.geomorphicGradientNorthMetersPerKm) || 0);
}

function elevationAt(config, latitude, longitude) {
  const reconstructed = reconstructedBedrockElevation777At(latitude, longitude);
  const regionalResidual = Array.isArray(config.regionalTerrainPatches)
    ? regionalTerrainResidualAtPatches(config.regionalTerrainPatches, latitude, longitude)
    : regionalTerrainResidualAt(config.regionalTerrainPatch, latitude, longitude);
  if (!config.earthState) return reconstructed + regionalResidual + geomorphicOffsetAt(config, latitude, longitude);
  return reconstructed
    + regionalResidual
    + tectonicElevationOffsetMeters(config.earthState, latitude, longitude, config.branchSeed)
    + geomorphicOffsetAt(config, latitude, longitude);
}

function channelIncisionMeters(config, xKm, zKm) {
  const patch = config.geomorphologyPatch;
  const angle = Number(patch?.channelBearingRadians);
  const discharge = Math.max(0, Number(patch?.meanDischargeM3s) || 0);
  const closestX = Number(patch?.channelClosestXKm);
  const closestZ = Number(patch?.channelClosestZKm);
  const channelDistance = Number(patch?.channelDistanceFromSelectionKm);
  if (!Number.isFinite(angle) || !Number.isFinite(closestX) || !Number.isFinite(closestZ) || !(discharge > 0.08)) return 0;
  const visibleReachKm = config.chunkSizeKm * (config.radius + 1.7);
  if (Number.isFinite(channelDistance) && channelDistance > visibleReachKm) return 0;

  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const relX = xKm - closestX;
  const relZ = zKm - closestZ;
  const alongKm = relX * dirX + relZ * dirZ;
  const perpendicularKm = -relX * dirZ + relZ * dirX;
  const bankfullWidthMeters = clamp(4 + Math.sqrt(discharge) * 2.6, 4, 90);
  const valleyHalfWidthKm = clamp(bankfullWidthMeters / 1000 * 2.4, 0.012, 0.22);
  const phase = (config.branchSeed % 997) * 0.017;
  const meanderAmplitudeKm = clamp(valleyHalfWidthKm * 0.7, 0.004, 0.055);
  const meanderKm = Math.sin(alongKm * 0.85 + phase) * meanderAmplitudeKm;
  const distanceKm = Math.abs(perpendicularKm - meanderKm);
  const erosionRate = Math.max(0, Number(patch?.erosionRateMmPerYear) || 0);
  const incisionDepthMeters = clamp(1.2 + Math.log1p(discharge) * 1.35 + erosionRate * 160, 1.2, 28);
  const profile = Math.exp(-((distanceKm / valleyHalfWidthKm) ** 2));
  return incisionDepthMeters * profile;
}

function landscapeEvolutionOffsetMeters(config, xKm, zKm, elevationMeters) {
  const elapsedYears = Math.max(0, Number(config.earthState?.elapsedYears) || 0);
  // Landscape evolution is a coupled surface-process signal. Keep the kernel
  // exactly aligned with the static TerrainChunkManager when those drivers are
  // absent (tests, fallback rendering, and non-simulated previews).
  if (!config.surfaceVisualDrivers || elapsedYears <= 0 || elevationMeters < -180) return 0;
  const drivers = surfaceDrivers(config);
  const relief = clamp(Math.abs(elevationMeters - Number(config.baseElevationMeters)) / 1800, 0, 1);
  const lowland = clamp(1 - Math.abs(elevationMeters - (Number(config.earthState?.seaLevel) || 0)) / 280, 0, 1);
  const drainage = organicField(config, xKm * 0.41, zKm * 0.41, 19);
  const erosionRateMmPerYear = 0.018 + drivers.runoff * 0.14 + relief * 0.16 + Math.max(0, drainage - 0.58) * 0.09;
  const depositionRateMmPerYear = lowland * drivers.runoff * (0.045 + (1 - drainage) * 0.07);
  const integratedYears = Math.min(elapsedYears, 240_000);
  const fluvialMeters = (depositionRateMmPerYear - erosionRateMmPerYear) * integratedYears / 1000;
  const seaLevel = Number(config.earthState?.seaLevel) || 0;
  const coastalExposure = clamp(1 - Math.abs(elevationMeters - seaLevel) / 90, 0, 1);
  const coastalPlanationMeters = -coastalExposure * drivers.runoff * Math.min(18, integratedYears / 18_000);
  return clamp(fluvialMeters + coastalPlanationMeters, -140, 70);
}

function microreliefKm(config, xKm, zKm, elevationMeters) {
  if (elevationMeters < -80) return 0;
  const reliefMeters = Math.abs(elevationMeters - config.baseElevationMeters);
  const amplitudeMeters = clamp(4 + reliefMeters * 0.0045, 4, 16);
  const wave =
    Math.sin((xKm + config.origin.longitude * 0.013) * 23.7) * 0.52 +
    Math.cos((zKm + config.origin.latitude * 0.017) * 19.3) * 0.31 +
    Math.sin((xKm * 0.73 + zKm * 0.91) * 41.7) * 0.17;
  return wave * amplitudeMeters / 1000 * config.verticalScale;
}

function displayedTerrainElevationMeters(config, xKm, zKm) {
  const { latitude, longitude } = geographicAt(config, xKm, zKm);
  const bedrock = elevationAt(config, latitude, longitude);
  const channel = channelIncisionMeters(config, xKm, zKm);
  const landscapeEvolution = landscapeEvolutionOffsetMeters(config, xKm, zKm, bedrock);
  const microKm = microreliefKm(config, xKm, zKm, bedrock);
  const microMeters = config.verticalScale > 0 ? microKm / config.verticalScale * 1000 : 0;
  return bedrock + landscapeEvolution - channel + microMeters;
}

function organicField(config, xKm, zKm, salt = 0) {
  const phase = ((Number(config.branchSeed) || 0) % 10007) * 0.00071 + salt * 1.731;
  const macro = Math.sin((xKm * 0.105 + phase) + Math.sin(zKm * 0.057 - phase) * 1.45);
  const cross = Math.cos((zKm * 0.132 - phase * 0.7) + Math.sin(xKm * 0.071 + phase) * 1.15);
  const meso = Math.sin((xKm + zKm * 0.72) * 0.34 + phase * 1.9);
  const fine = Math.cos((xKm * 0.81 - zKm * 0.53) + phase * 2.7);
  return clamp(0.5 + macro * 0.22 + cross * 0.17 + meso * 0.08 + fine * 0.03, 0, 1);
}

function ecologicalSuccessionAt(config, xKm, zKm) {
  const elapsedYears = Math.max(0, Number(config.earthState?.elapsedYears) || 0);
  if (elapsedYears <= 0) return 0;
  // Bedrock is nearly static on a centennial clock, but vegetation, soil
  // moisture, wetlands, and openings can reorganize visibly. Advance a smooth,
  // deterministic succession field instead of making mountains pulse.
  const phase = elapsedYears / 900;
  const establishment = smoothstep01(elapsedYears / 400);
  const broad = Math.sin(xKm * 0.055 + zKm * 0.041 + phase);
  const cross = Math.cos(xKm * 0.031 - zKm * 0.067 - phase * 0.73);
  return (broad * 0.075 + cross * 0.045) * establishment;
}

function surfaceDrivers(config) {
  const drivers = config.surfaceVisualDrivers ?? {};
  return {
    lai: clamp((Number(drivers.lai) || 0) / 7.12, 0, 1),
    npp: clamp(Math.log1p(Math.max(0, Number(drivers.npp) || 0)) / Math.log1p(2214), 0, 1),
    runoff: clamp(Math.log1p(Math.max(0, Number(drivers.runoffMmPerYear) || 0)) / Math.log1p(1400), 0, 1),
    runoffMmPerYear: Math.max(0, Number(drivers.runoffMmPerYear) || 0),
    treeDensity: clamp(Number(drivers.treeDensity), 0, 1.15),
    grassDensity: clamp(Number(drivers.grassDensity), 0, 1.15),
    shrubDensity: clamp(Number(drivers.shrubDensity), 0, 1.15),
    lakeSurfaceElevationMeters: Number(drivers.lakeSurfaceElevationMeters),
    lakeCoverageFraction: clamp(Number(drivers.lakeCoverageFraction), 0, 1),
    lakeAreaKm2: Math.max(0, Number(drivers.lakeAreaKm2) || 0),
    lakeCenterXKm: Number(drivers.lakeCenterXKm) || 0,
    lakeCenterZKm: Number(drivers.lakeCenterZKm) || 0,
    meanDischargeM3s: Math.max(0, Number(drivers.meanDischargeM3s) || 0)
  };
}

function regionalLakePresence(config, xKm, zKm, elevationMeters) {
  if (Number(config.chunkSizeKm) < 8) return 0;
  const drivers = surfaceDrivers(config);
  if (!Number.isFinite(drivers.lakeSurfaceElevationMeters) || drivers.lakeCoverageFraction <= 0.005 || drivers.lakeAreaKm2 <= 0) return 0;
  if (elevationMeters > drivers.lakeSurfaceElevationMeters + 18) return 0;

  const nominalRadiusKm = Math.sqrt(drivers.lakeAreaKm2 / Math.PI);
  const radiusKm = clamp(nominalRadiusKm, 0.35, Math.max(1, config.chunkSizeKm * (config.radius + 0.65)));
  const angle = ((Number(config.branchSeed) || 0) % 2048) / 2048 * TAU;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const dx = xKm - drivers.lakeCenterXKm;
  const dz = zKm - drivers.lakeCenterZKm;
  const rx = dx * cosA - dz * sinA;
  const rz = dx * sinA + dz * cosA;
  const aspect = 0.72 + organicField(config, 0, 0, 9) * 0.52;
  const boundaryNoise = 0.84
    + organicField(config, xKm * 0.78, zKm * 0.78, 11) * 0.25
    + Math.sin(Math.atan2(rz, rx) * 5 + angle) * 0.055;
  const normalized = Math.hypot(rx / (radiusKm * aspect), rz / (radiusKm / aspect)) / Math.max(0.55, boundaryNoise);
  const shoreline = smoothstep01((1.08 - normalized) / 0.18);
  const basinFit = smoothstep01((drivers.lakeSurfaceElevationMeters + 18 - elevationMeters) / 34);
  return shoreline * basinFit;
}

export function surfaceHeightAt(config, xKm, zKm) {
  const { latitude, longitude } = geographicAt(config, xKm, zKm);
  const elevationMeters = elevationAt(config, latitude, longitude);
  const channel = channelIncisionMeters(config, xKm, zKm);
  const landscapeEvolution = landscapeEvolutionOffsetMeters(config, xKm, zKm, elevationMeters);
  return (elevationMeters + landscapeEvolution - config.baseElevationMeters - channel) / 1000 * config.verticalScale
    + microreliefKm(config, xKm, zKm, elevationMeters);
}

function mixColor(a, b, t) {
  const amount = clamp(t, 0, 1);
  return [mix(a[0], b[0], amount), mix(a[1], b[1], amount), mix(a[2], b[2], amount)];
}

function baseTerrainColor(latitude, elevationMeters, reliefMeters) {
  const absLat = Math.abs(latitude);
  const seaLevel = 0;
  if (elevationMeters < seaLevel) return [0.07, 0.16, 0.17];
  if (absLat > 68 || elevationMeters > 3200) return [0.57, 0.62, 0.57];
  if (elevationMeters > 1900) return [0.36, 0.34, 0.25];
  const relief = clamp(Math.abs(reliefMeters) / 900, 0, 1);
  if (absLat < 25) return [0.24 + relief * 0.08, 0.36 + relief * 0.04, 0.18];
  if (absLat < 48) return [0.28 + relief * 0.08, 0.38, 0.2];
  return [0.31 + relief * 0.06, 0.36, 0.24];
}

export function regionalLandCoverColorAt(config, xKm, zKm, latitude, elevationMeters, reliefMeters, groundTint = null, lakePresence = 0) {
  const seaLevel = Number(config.earthState?.seaLevel) || 0;
  if (elevationMeters < seaLevel - 120 && lakePresence <= 0.05) return [0.055, 0.135, 0.16];

  const base = baseTerrainColor(latitude, elevationMeters, reliefMeters);
  if (!config.surfaceVisualDrivers) {
    return groundTint && elevationMeters >= seaLevel ? mixColor(base, groundTint, 0.38) : base;
  }
  const drivers = surfaceDrivers(config);
  const macro = organicField(config, xKm, zKm, 1);
  const meso = organicField(config, xKm * 1.8, zKm * 1.8, 2);
  const drainage = organicField(config, xKm * 0.62 + zKm * 0.18, zKm * 0.62 - xKm * 0.18, 4);
  const succession = ecologicalSuccessionAt(config, xKm, zKm);
  const vigor = clamp(drivers.lai * 0.48 + drivers.npp * 0.28 + drivers.treeDensity * 0.24 + succession, 0, 1);
  const lowland = clamp(0.58 - Math.max(-250, reliefMeters) / 1100, 0, 1);
  const moisture = clamp(drivers.runoff * 0.60 + lowland * 0.22 + (drainage - 0.5) * 0.36 + succession * 0.58, 0, 1);
  const forestWeight = smoothstep01((macro + vigor * 0.82 - 0.68) / 0.52) * clamp(0.22 + drivers.treeDensity * 0.9, 0, 1);
  const wetlandWeight = smoothstep01((moisture + meso * 0.28 - 0.72) / 0.38) * lowland;
  const dryOpeningWeight = smoothstep01((0.48 - moisture + (0.48 - macro) * 0.22) / 0.42);
  const sedimentWeight = smoothstep01((0.39 - vigor + (0.5 - meso) * 0.18) / 0.38) * (1 - wetlandWeight);

  const forest = [0.095, 0.235, 0.105];
  const woodland = [0.18, 0.315, 0.14];
  const grassland = [0.31, 0.39, 0.19];
  const wetland = [0.115, 0.275, 0.235];
  const dryGround = [0.46, 0.385, 0.235];
  const sediment = [0.50, 0.43, 0.29];
  const water = [0.075, 0.245, 0.285];

  let color = mixColor(base, grassland, 0.44 + drivers.grassDensity * 0.14);
  color = mixColor(color, woodland, clamp(vigor * 0.34, 0, 0.34));
  color = mixColor(color, forest, forestWeight * 0.74);
  color = mixColor(color, wetland, wetlandWeight * 0.78);
  color = mixColor(color, dryGround, dryOpeningWeight * 0.48);
  color = mixColor(color, sediment, sedimentWeight * 0.36);
  // Make centuries of local green-up or drying legible at surface scale while
  // retaining the biome palette and the underlying reconstructed relief.
  color = succession >= 0
    ? mixColor(color, forest, succession * 2.4)
    : mixColor(color, dryGround, -succession * 2.1);

  if (groundTint && elevationMeters >= seaLevel) color = mixColor(color, groundTint, 0.18);

  const tonalVariation = (meso - 0.5) * 0.10 + (macro - 0.5) * 0.05;
  color = color.map((channel) => clamp(channel + tonalVariation, 0.025, 0.78));
  if (lakePresence > 0) color = mixColor(color, water, smoothstep01(lakePresence) * 0.96);
  return color;
}

function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const abx = positions[ib] - positions[ia];
    const aby = positions[ib + 1] - positions[ia + 1];
    const abz = positions[ib + 2] - positions[ia + 2];
    const acx = positions[ic] - positions[ia];
    const acy = positions[ic + 1] - positions[ia + 1];
    const acz = positions[ic + 2] - positions[ia + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const offset of [ia, ib, ic]) {
      normals[offset] += nx;
      normals[offset + 1] += ny;
      normals[offset + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
  return normals;
}

function boundaryOutletElevations(config, chunkX, chunkZ, segments) {
  const side = segments + 1;
  const result = new Float32Array(side * side);
  result.fill(Number.NaN);
  const half = config.chunkSizeKm / 2;
  const centerX = chunkX * config.chunkSizeKm;
  const centerZ = chunkZ * config.chunkSizeKm;
  const step = config.chunkSizeKm / Math.max(1, segments);
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      if (row !== 0 && col !== 0 && row !== side - 1 && col !== side - 1) continue;
      const x = centerX + (col / segments) * config.chunkSizeKm - half;
      const z = centerZ + (row / segments) * config.chunkSizeKm - half;
      let lowest = Number.POSITIVE_INFINITY;
      if (row === 0) lowest = Math.min(lowest, displayedTerrainElevationMeters(config, x, z - step));
      if (row === side - 1) lowest = Math.min(lowest, displayedTerrainElevationMeters(config, x, z + step));
      if (col === 0) lowest = Math.min(lowest, displayedTerrainElevationMeters(config, x - step, z));
      if (col === side - 1) lowest = Math.min(lowest, displayedTerrainElevationMeters(config, x + step, z));
      if (Number.isFinite(lowest)) result[row * side + col] = lowest;
    }
  }
  return result;
}

export function buildTerrainChunkData(config, chunkX, chunkZ) {
  const segments = Math.max(6, Math.round(Number(config.segments) || 18));
  const vertexSide = segments + 1;
  const positions = new Float32Array(vertexSide * vertexSide * 3);
  const colors = new Float32Array(vertexSide * vertexSide * 3);
  const elevations = new Float32Array(vertexSide * vertexSide);
  const sharedIndices = gridIndicesForSegments(segments);
  const half = config.chunkSizeKm / 2;
  const centerX = chunkX * config.chunkSizeKm;
  const centerZ = chunkZ * config.chunkSizeKm;
  const visualDrivers = surfaceDrivers(config);
  let vertexOffset = 0;

  for (let z = 0; z <= segments; z += 1) {
    const localZ = centerZ + (z / segments) * config.chunkSizeKm - half;
    for (let x = 0; x <= segments; x += 1) {
      const localX = centerX + (x / segments) * config.chunkSizeKm - half;
      const { latitude } = geographicAt(config, localX, localZ);
      const displayedElevationMeters = displayedTerrainElevationMeters(config, localX, localZ);
      const y = (displayedElevationMeters - config.baseElevationMeters) / 1000 * config.verticalScale;
      positions[vertexOffset * 3] = localX;
      positions[vertexOffset * 3 + 1] = y;
      positions[vertexOffset * 3 + 2] = localZ;
      elevations[vertexOffset] = displayedElevationMeters;
      const [r, g, b] = regionalLandCoverColorAt(
        config,
        localX,
        localZ,
        latitude,
        displayedElevationMeters,
        displayedElevationMeters - config.baseElevationMeters,
        config.biomeGroundColor,
        0
      );
      colors[vertexOffset * 3] = r;
      colors[vertexOffset * 3 + 1] = g;
      colors[vertexOffset * 3 + 2] = b;
      vertexOffset += 1;
    }
  }

  const hydrology = solveTerrainCoupledHydrology({
    elevations,
    positions,
    vertexSide,
    seaLevelMeters: Number(config.earthState?.seaLevel) || 0,
    runoffMmPerYear: visualDrivers.runoffMmPerYear,
    routedDischargeM3s: visualDrivers.meanDischargeM3s,
    lakeCoverageFraction: visualDrivers.lakeCoverageFraction,
    lakeSurfaceElevationMeters: visualDrivers.lakeSurfaceElevationMeters,
    boundaryOutletElevationMeters: boundaryOutletElevations(config, chunkX, chunkZ, segments)
  });

  const streamColor = [0.055, 0.235, 0.285];
  const wetlandColor = [0.105, 0.285, 0.235];
  const lakeColor = [0.07, 0.245, 0.30];
  let streamVertexCount = 0;
  let wetlandVertexCount = 0;
  let lakeVertexCount = 0;
  // The fallback renderer has no coupled water/vegetation state, so preserve
  // its exact geometry and colors. Surface mode supplies these drivers and gets
  // the full routed-water presentation below.
  if (config.surfaceVisualDrivers) for (let index = 0; index < elevations.length; index += 1) {
    const colorOffset = index * 3;
    let color = [colors[colorOffset], colors[colorOffset + 1], colors[colorOffset + 2]];
    const wetland = Number(hydrology.wetlandStrength[index]) || 0;
    const stream = Number(hydrology.streamStrength[index]) || 0;
    const lake = Number(hydrology.lakeStrength[index]) || 0;

    if (wetland > 0.08) {
      color = mixColor(color, wetlandColor, wetland * 0.58);
      wetlandVertexCount += 1;
    }
    if (stream > 0.08) {
      color = mixColor(color, streamColor, stream * 0.78);
      streamVertexCount += 1;
    }
    if (lake > 0.05) {
      const lakeSurface = hydrology.lakeSurfaceByCell[index];
      if (Number.isFinite(lakeSurface)) {
        elevations[index] = lakeSurface;
        positions[colorOffset + 1] = (lakeSurface - config.baseElevationMeters) / 1000 * config.verticalScale + 0.00025;
      }
      color = mixColor(color, lakeColor, lake * 0.96);
      lakeVertexCount += 1;
    }
    colors[colorOffset] = color[0];
    colors[colorOffset + 1] = color[1];
    colors[colorOffset + 2] = color[2];
  }

  const normals = computeNormals(positions, sharedIndices);
  return {
    positions,
    colors,
    elevations,
    // All chunks with the same segment count share this topology template.
    indices: sharedIndices.slice(),
    normals,
    hydrology: Object.freeze({
      policy: hydrology.policy,
      sinkCount: hydrology.sinkCount,
      maxAccumulation: hydrology.maxAccumulation,
      streamVertexCount,
      wetlandVertexCount,
      lakeVertexCount
    })
  };
}

function pushTransform(target, config, x, z, sx, sy, sz, yaw, waterLevelKm) {
  const y = surfaceHeightAt(config, x, z);
  if (y <= waterLevelKm + 0.0003) return;
  target.push(x, y, z, sx, sy, sz, yaw);
}

export function buildEcologyChunkPlan(config, { chunkX, chunkZ, profile, quality, waterLevelKm }) {
  const pools = { grass: [], trunk: [], crown: [], shrub: [], rock: [] };
  const size = config.chunkSizeKm;
  const half = size / 2;
  const centerX = chunkX * size;
  const centerZ = chunkZ * size;
  const seed = seedFor(config.origin.latitude, config.origin.longitude, chunkX, chunkZ);
  const q = clamp(quality, 0.35, 1);
  const water = Number.isFinite(waterLevelKm) ? waterLevelKm : -Infinity;

  const scatter = (name, count, baseScale, salt, density = 1) => {
    const wanted = Math.round(count * q * density);
    for (let i = 0; i < wanted; i += 1) {
      const x = centerX + (random01(seed + salt + i * 17.1) * 2 - 1) * half;
      const z = centerZ + (random01(seed + salt + i * 29.7 + 3) * 2 - 1) * half;
      const scale = baseScale * (0.68 + random01(seed + salt + i * 7.7 + 11) * 0.75);
      pushTransform(pools[name], config, x, z, scale, scale * (0.78 + random01(seed + i) * 0.6), scale, random01(seed + i * 13.9) * TAU, water);
    }
  };

  scatter("grass", 120, 1.0, 100, profile.grassDensity);
  const treeCount = Math.round(26 * profile.treeDensity * q);
  for (let i = 0; i < treeCount; i += 1) {
    const x = centerX + (random01(seed + 220 + i * 19.3) * 2 - 1) * half;
    const z = centerZ + (random01(seed + 240 + i * 23.1) * 2 - 1) * half;
    const scale = 0.72 + random01(seed + 260 + i * 11.3) * 1.25;
    const yaw = random01(seed + i * 3.1) * TAU;
    const y = surfaceHeightAt(config, x, z);
    if (y <= water + 0.0003) continue;
    pools.trunk.push(x, y, z, scale, scale, scale, yaw);
    pools.crown.push(x, y, z, scale, scale, scale, yaw);
  }
  scatter("shrub", 38, 1.0, 330, profile.shrubDensity);
  scatter("rock", 18, 0.8, 440, profile.rockDensity);

  return Object.fromEntries(Object.entries(pools).map(([key, values]) => [key, new Float32Array(values)]));
}
