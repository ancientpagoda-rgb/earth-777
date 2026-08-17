import { reconstructedBedrockElevation777At } from "../reconstruction/TerrainReconstruction777.js";
import { tectonicElevationOffsetMeters } from "../sim/DynamicLithosphere.js";

const KM_PER_DEGREE_LATITUDE = 111.32;
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const mix = (a, b, t) => a + (b - a) * t;
const wrapLongitudeDelta = (value) => ((Number(value) + 540) % 360) - 180;
const fract = (value) => value - Math.floor(value);
const random01 = (seed) => fract(Math.sin(seed * 12.9898 + 78.233) * 43758.5453123);
const seedFor = (latitude, longitude, x, z, salt = 0) => (latitude + 90) * 197.3 + (longitude + 180) * 389.7 + x * 911.1 + z * 617.3 + salt * 131.9;

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
  if (!config.earthState) return reconstructed + geomorphicOffsetAt(config, latitude, longitude);
  return reconstructed
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

export function surfaceHeightAt(config, xKm, zKm) {
  const { latitude, longitude } = geographicAt(config, xKm, zKm);
  const elevationMeters = elevationAt(config, latitude, longitude);
  const channel = channelIncisionMeters(config, xKm, zKm);
  return (elevationMeters - config.baseElevationMeters - channel) / 1000 * config.verticalScale
    + microreliefKm(config, xKm, zKm, elevationMeters);
}

function terrainColor(latitude, elevationMeters, reliefMeters, groundTint = null) {
  const absLat = Math.abs(latitude);
  let base;
  if (elevationMeters < 0) base = [0.07, 0.16, 0.17];
  else if (absLat > 68 || elevationMeters > 3200) base = [0.57, 0.62, 0.57];
  else if (elevationMeters > 1900) base = [0.36, 0.34, 0.25];
  else {
    const relief = clamp(Math.abs(reliefMeters) / 900, 0, 1);
    if (absLat < 25) base = [0.24 + relief * 0.08, 0.36 + relief * 0.04, 0.18];
    else if (absLat < 48) base = [0.28 + relief * 0.08, 0.38, 0.2];
    else base = [0.31 + relief * 0.06, 0.36, 0.24];
  }
  if (!groundTint || elevationMeters < 0) return base;
  const blend = 0.38;
  return [mix(base[0], groundTint[0], blend), mix(base[1], groundTint[1], blend), mix(base[2], groundTint[2], blend)];
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

export function buildTerrainChunkData(config, chunkX, chunkZ) {
  const segments = config.segments;
  const vertexSide = segments + 1;
  const positions = new Float32Array(vertexSide * vertexSide * 3);
  const colors = new Float32Array(vertexSide * vertexSide * 3);
  const elevations = new Float32Array(vertexSide * vertexSide);
  const indices = new Uint32Array(segments * segments * 6);
  const half = config.chunkSizeKm / 2;
  const centerX = chunkX * config.chunkSizeKm;
  const centerZ = chunkZ * config.chunkSizeKm;
  let vertexOffset = 0;
  for (let z = 0; z <= segments; z += 1) {
    const localZ = centerZ + (z / segments) * config.chunkSizeKm - half;
    for (let x = 0; x <= segments; x += 1) {
      const localX = centerX + (x / segments) * config.chunkSizeKm - half;
      const { latitude, longitude } = geographicAt(config, localX, localZ);
      const elevationMeters = elevationAt(config, latitude, longitude);
      const channel = channelIncisionMeters(config, localX, localZ);
      const visualElevationMeters = elevationMeters - channel;
      const microKm = microreliefKm(config, localX, localZ, elevationMeters);
      const microMeters = config.verticalScale > 0 ? microKm / config.verticalScale * 1000 : 0;
      const displayedElevationMeters = visualElevationMeters + microMeters;
      const y = (visualElevationMeters - config.baseElevationMeters) / 1000 * config.verticalScale + microKm;
      positions[vertexOffset * 3] = localX;
      positions[vertexOffset * 3 + 1] = y;
      positions[vertexOffset * 3 + 2] = localZ;
      elevations[vertexOffset] = displayedElevationMeters;
      const [r, g, b] = terrainColor(latitude, displayedElevationMeters, displayedElevationMeters - config.baseElevationMeters, config.biomeGroundColor);
      colors[vertexOffset * 3] = r;
      colors[vertexOffset * 3 + 1] = g;
      colors[vertexOffset * 3 + 2] = b;
      vertexOffset += 1;
    }
  }
  let indexOffset = 0;
  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const a = z * vertexSide + x;
      const b = a + 1;
      const c = a + vertexSide;
      const d = c + 1;
      indices[indexOffset++] = a; indices[indexOffset++] = c; indices[indexOffset++] = b;
      indices[indexOffset++] = b; indices[indexOffset++] = c; indices[indexOffset++] = d;
    }
  }
  const normals = computeNormals(positions, indices);
  return { positions, colors, elevations, indices, normals };
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
