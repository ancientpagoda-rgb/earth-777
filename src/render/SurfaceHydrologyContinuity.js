const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const mix = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const smoothstep01 = (value) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

export const SURFACE_HYDROLOGY_CONTINUITY_POLICY = "world-coordinate-major-channel-lake-v1";

function organicField(branchSeed, xKm, zKm, salt = 0) {
  const phase = ((Number(branchSeed) || 0) % 10007) * 0.00071 + salt * 1.731;
  const macro = Math.sin((xKm * 0.105 + phase) + Math.sin(zKm * 0.057 - phase) * 1.45);
  const cross = Math.cos((zKm * 0.132 - phase * 0.7) + Math.sin(xKm * 0.071 + phase) * 1.15);
  const meso = Math.sin((xKm + zKm * 0.72) * 0.34 + phase * 1.9);
  return clamp(0.5 + macro * 0.23 + cross * 0.18 + meso * 0.09, 0, 1);
}

export function majorChannelPresenceAt({ geomorphologyPatch, chunkSizeKm = 8, branchSeed = 0 } = {}, xKm, zKm) {
  const patch = geomorphologyPatch;
  const angle = Number(patch?.channelBearingRadians);
  const discharge = Math.max(0, Number(patch?.meanDischargeM3s) || 0);
  const closestX = Number(patch?.channelClosestXKm);
  const closestZ = Number(patch?.channelClosestZKm);
  if (!Number.isFinite(angle) || !Number.isFinite(closestX) || !Number.isFinite(closestZ) || discharge <= 0.08) return 0;

  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const relX = Number(xKm) - closestX;
  const relZ = Number(zKm) - closestZ;
  const alongKm = relX * dirX + relZ * dirZ;
  const perpendicularKm = -relX * dirZ + relZ * dirX;
  const bankfullWidthMeters = clamp(4 + Math.sqrt(discharge) * 2.6, 4, 90);
  const physicalHalfWidthKm = clamp(bankfullWidthMeters / 1000 * 2.4, 0.012, 0.22);
  const mapHalfWidthKm = clamp(Number(chunkSizeKm) * 0.0125, 0.03, 1.15);
  const presentationHalfWidthKm = Math.max(physicalHalfWidthKm, mapHalfWidthKm);
  const phase = (Number(branchSeed) % 997) * 0.017;
  const meanderAmplitudeKm = clamp(physicalHalfWidthKm * 0.7, 0.004, 0.055);
  const meanderKm = Math.sin(alongKm * 0.85 + phase) * meanderAmplitudeKm;
  const distanceKm = Math.abs(perpendicularKm - meanderKm);
  const dischargeWeight = clamp(Math.log1p(discharge) / Math.log1p(25_000), 0.22, 1);
  return Math.exp(-((distanceKm / presentationHalfWidthKm) ** 2)) * dischargeWeight;
}

export function modelLakePresenceAt({ waterSystem, chunkSizeKm = 8, radius = 2, branchSeed = 0 } = {}, xKm, zKm, elevationMeters) {
  const lakeSurface = Number(waterSystem?.lakeSurfaceElevationMeters);
  const coverage = clamp(Number(waterSystem?.lakeCoverageFraction), 0, 1);
  const lakeAreaKm2 = Math.max(0, Number(waterSystem?.lakeAreaKm2) || 0);
  if (!Number.isFinite(lakeSurface) || coverage <= 0.005 || lakeAreaKm2 <= 0) return 0;
  if (Number(elevationMeters) > lakeSurface + 18) return 0;

  const centerX = Number.isFinite(Number(waterSystem?.channelClosestXKm)) ? Number(waterSystem.channelClosestXKm) : 0;
  const centerZ = Number.isFinite(Number(waterSystem?.channelClosestZKm)) ? Number(waterSystem.channelClosestZKm) : 0;
  const nominalRadiusKm = Math.sqrt(lakeAreaKm2 / Math.PI);
  const maxVisibleRadius = Math.max(1, Number(chunkSizeKm) * (Number(radius) + 0.65));
  const radiusKm = clamp(nominalRadiusKm, 0.35, maxVisibleRadius);
  const angle = ((Number(branchSeed) || 0) % 2048) / 2048 * TAU;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const dx = Number(xKm) - centerX;
  const dz = Number(zKm) - centerZ;
  const rx = dx * cosA - dz * sinA;
  const rz = dx * sinA + dz * cosA;
  const aspect = 0.72 + organicField(branchSeed, 0, 0, 9) * 0.52;
  const boundaryNoise = 0.84
    + organicField(branchSeed, Number(xKm) * 0.78, Number(zKm) * 0.78, 11) * 0.25
    + Math.sin(Math.atan2(rz, rx) * 5 + angle) * 0.055;
  const normalized = Math.hypot(rx / (radiusKm * aspect), rz / (radiusKm / aspect)) / Math.max(0.55, boundaryNoise);
  const shoreline = smoothstep01((1.08 - normalized) / 0.18);
  const basinFit = smoothstep01((lakeSurface + 18 - Number(elevationMeters)) / 34);
  return shoreline * basinFit;
}

function mixVertexColor(color, index, target, weight) {
  const amount = clamp(weight, 0, 1);
  color.setXYZ(
    index,
    mix(color.getX(index), target[0], amount),
    mix(color.getY(index), target[1], amount),
    mix(color.getZ(index), target[2], amount)
  );
}

export function applySurfaceHydrologyContinuity(mesh, {
  geomorphologyPatch = null,
  waterSystem = null,
  chunkSizeKm = 8,
  radius = 2,
  branchSeed = 0,
  baseElevationMeters = 0,
  verticalScale = 1
} = {}) {
  const geometry = mesh?.geometry;
  const position = geometry?.getAttribute?.("position");
  const color = geometry?.getAttribute?.("color");
  const elevation = geometry?.getAttribute?.("elevationMeters");
  if (!position || !color || !elevation) return Object.freeze({ changed: false, streamVertices: 0, lakeVertices: 0 });

  const streamColor = [0.045, 0.225, 0.30];
  const lakeColor = [0.055, 0.235, 0.305];
  const lakeSurface = Number(waterSystem?.lakeSurfaceElevationMeters);
  let streamVertices = 0;
  let lakeVertices = 0;
  let positionChanged = false;

  for (let index = 0; index < position.count; index += 1) {
    const xKm = position.getX(index);
    const zKm = position.getZ(index);
    const elevationMeters = elevation.getX(index);
    const stream = majorChannelPresenceAt({ geomorphologyPatch, chunkSizeKm, branchSeed }, xKm, zKm);
    const lake = modelLakePresenceAt({ waterSystem, chunkSizeKm, radius, branchSeed }, xKm, zKm, elevationMeters);

    if (stream > 0.035) {
      mixVertexColor(color, index, streamColor, smoothstep01(stream) * 0.84);
      streamVertices += 1;
    }
    if (lake > 0.035) {
      mixVertexColor(color, index, lakeColor, smoothstep01(lake) * 0.96);
      lakeVertices += 1;
      if (lake > 0.56 && Number.isFinite(lakeSurface)) {
        elevation.setX(index, lakeSurface);
        position.setY(index, (lakeSurface - Number(baseElevationMeters)) / 1000 * Number(verticalScale) + 0.00032);
        positionChanged = true;
      }
    }
  }

  if (streamVertices || lakeVertices) color.needsUpdate = true;
  if (positionChanged) {
    elevation.needsUpdate = true;
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
  const result = Object.freeze({
    changed: Boolean(streamVertices || lakeVertices),
    streamVertices,
    lakeVertices,
    policy: SURFACE_HYDROLOGY_CONTINUITY_POLICY
  });
  mesh.userData.hydrologyContinuity = result;
  return result;
}
