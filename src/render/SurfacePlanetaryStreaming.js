const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value)));
const wrapLongitude = (value) => ((finite(value) + 540) % 360) - 180;

export const PLANETARY_SURFACE_STREAMING_POLICY = "whole-earth-floating-origin-chunk-rebase-v1";

export function geographicDestination(origin, eastKm = 0, northKm = 0) {
  const latitude = clamp(origin?.latitude, -90, 90);
  const longitude = wrapLongitude(origin?.longitude);
  const east = finite(eastKm);
  const north = finite(northKm);
  const distanceKm = Math.hypot(east, north);
  if (distanceKm < 1e-9) return Object.freeze({ latitude, longitude });

  const latitude1 = latitude * DEG;
  const longitude1 = longitude * DEG;
  const bearing = Math.atan2(east, north);
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const sinLatitude1 = Math.sin(latitude1);
  const cosLatitude1 = Math.cos(latitude1);
  const sinAngular = Math.sin(angularDistance);
  const cosAngular = Math.cos(angularDistance);
  const latitude2 = Math.asin(clamp(
    sinLatitude1 * cosAngular + cosLatitude1 * sinAngular * Math.cos(bearing),
    -1,
    1
  ));
  const longitude2 = longitude1 + Math.atan2(
    Math.sin(bearing) * sinAngular * cosLatitude1,
    cosAngular - sinLatitude1 * Math.sin(latitude2)
  );

  return Object.freeze({
    latitude: clamp(latitude2 * RAD, -90, 90),
    longitude: wrapLongitude(longitude2 * RAD)
  });
}

export function surfaceRebasePlan({
  origin,
  focusXKm = 0,
  focusZKm = 0,
  chunkSizeKm = 84,
  thresholdKm = null
} = {}) {
  if (!origin || !Number.isFinite(Number(origin.latitude)) || !Number.isFinite(Number(origin.longitude))) return null;
  const chunk = Math.max(0.1, finite(chunkSizeKm, 84));
  const x = finite(focusXKm);
  const z = finite(focusZKm);
  const threshold = Math.max(chunk * 1.35, finite(thresholdKm, 0), 96);
  if (Math.hypot(x, z) < threshold) return null;

  let chunkShiftX = Math.round(x / chunk);
  let chunkShiftZ = Math.round(z / chunk);
  if (chunkShiftX === 0 && chunkShiftZ === 0) {
    if (Math.abs(x) >= Math.abs(z)) chunkShiftX = Math.sign(x) || 1;
    else chunkShiftZ = Math.sign(z) || 1;
  }

  const shiftXKm = chunkShiftX * chunk;
  const shiftZKm = chunkShiftZ * chunk;
  const nextOrigin = geographicDestination(origin, shiftXKm, shiftZKm);
  return Object.freeze({
    policy: PLANETARY_SURFACE_STREAMING_POLICY,
    origin: nextOrigin,
    chunkShiftX,
    chunkShiftZ,
    shiftXKm,
    shiftZKm,
    residualXKm: x - shiftXKm,
    residualZKm: z - shiftZKm,
    distanceKm: Math.hypot(shiftXKm, shiftZKm),
    thresholdKm: threshold
  });
}

function queueExactTerrainRefresh(terrain) {
  const centerX = Number(terrain.lastCenter?.x);
  const centerZ = Number(terrain.lastCenter?.z);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ)) return 0;
  const candidates = [];
  for (const [key] of terrain.chunks ?? []) {
    const [x, z] = key.split(":").map(Number);
    const dx = x - centerX;
    const dz = z - centerZ;
    if (Math.abs(dx) > terrain.radius || Math.abs(dz) > terrain.radius) continue;
    if (terrain.queuedKeys?.has(key) || terrain.terrainInFlightKeys?.has(key)) continue;
    const distance = dx * dx + dz * dz;
    const segments = terrain._segmentsForCandidate?.({ distance }) ?? terrain.segments;
    candidates.push({ x, z, key, distance, replaceExisting: true, segments });
    terrain.queuedKeys?.add(key);
  }
  candidates.sort((a, b) => a.distance - b.distance);
  terrain.queue?.unshift?.(...candidates);
  return candidates.length;
}

function rekeyAndTranslateTerrain(terrain, plan, verticalShiftKm) {
  const nextChunks = new Map();
  for (const [key, mesh] of terrain.chunks ?? []) {
    const [x, z] = key.split(":").map(Number);
    const nextX = x - plan.chunkShiftX;
    const nextZ = z - plan.chunkShiftZ;
    const position = mesh.geometry?.getAttribute?.("position");
    if (position) {
      for (let index = 0; index < position.count; index += 1) {
        position.setXYZ(
          index,
          position.getX(index) - plan.shiftXKm,
          position.getY(index) + verticalShiftKm,
          position.getZ(index) - plan.shiftZKm
        );
      }
      position.needsUpdate = true;
      mesh.geometry.computeBoundingSphere?.();
    } else {
      mesh.position.x -= plan.shiftXKm;
      mesh.position.z -= plan.shiftZKm;
      mesh.position.y += verticalShiftKm;
    }
    mesh.userData.chunk = { x: nextX, z: nextZ };
    nextChunks.set(`${nextX}:${nextZ}`, mesh);
  }
  terrain.chunks = nextChunks;
}

function invalidateOldSurfaceWork(terrain) {
  terrain.terrainGeneration = (Number(terrain.terrainGeneration) || 0) + 1;
  terrain.queue = [];
  terrain.queuedKeys?.clear?.();
  terrain.terrainCompleted = [];
  terrain.terrainInFlightKeys?.clear?.();
  terrain.computeContextSignature = "";
  terrain.regionalTerrainRequestToken = (Number(terrain.regionalTerrainRequestToken) || 0) + 1;
  terrain.computeClient?.invalidateRegionalTerrainRequest?.();
  terrain.lastRequestedRefinementCenter = null;
}

function refreshScienceContextPreservingTerrain(terrain) {
  if (!terrain.surfaceContextActive || typeof terrain._refreshSurfaceContext !== "function") return;
  const preservedChunks = terrain.chunks;
  terrain.chunks = new Map();
  try {
    terrain.surfaceEcology?.clear?.();
    terrain.surfaceFauna?.clear?.();
    terrain._refreshSurfaceContext();
  } finally {
    terrain.chunks = preservedChunks;
  }
}

export function installPlanetarySurfaceStreaming({ terrain, controls, camera, thresholdKm = null } = {}) {
  if (!terrain || !controls || !camera || typeof terrain.update !== "function") return Object.freeze({ dispose() {} });
  const baseUpdate = terrain.update.bind(terrain);
  let rebaseCount = 0;
  let totalRebasedKm = 0;
  let lastRebase = null;
  let exactRefreshPending = false;

  const updateDiagnostics = () => {
    terrain.planetarySurfaceDiagnostics = Object.freeze({
      policy: PLANETARY_SURFACE_STREAMING_POLICY,
      rebaseCount,
      totalRebasedKm,
      origin: terrain.origin ? Object.freeze({ ...terrain.origin }) : null,
      lastRebase
    });
  };

  terrain.update = (cameraPosition) => {
    const focus = controls.target ?? cameraPosition;
    const plan = surfaceRebasePlan({
      origin: terrain.origin,
      focusXKm: focus?.x,
      focusZKm: focus?.z,
      chunkSizeKm: terrain.chunkSizeKm,
      thresholdKm
    });

    if (plan) {
      const oldBaseElevationMeters = Number(terrain.baseElevationMeters) || 0;
      invalidateOldSurfaceWork(terrain);

      terrain.origin = { ...plan.origin };
      terrain.baseElevationMeters = terrain._elevationAt?.(terrain.origin.latitude, terrain.origin.longitude) ?? oldBaseElevationMeters;
      refreshScienceContextPreservingTerrain(terrain);
      const newBaseElevationMeters = Number(terrain.baseElevationMeters) || 0;
      const verticalShiftKm = (oldBaseElevationMeters - newBaseElevationMeters) / 1000 * (Number(terrain.verticalScale) || 1);

      rekeyAndTranslateTerrain(terrain, plan, verticalShiftKm);
      for (const point of [cameraPosition, focus]) {
        if (!point) continue;
        point.x -= plan.shiftXKm;
        point.z -= plan.shiftZKm;
        point.y += verticalShiftKm;
      }

      terrain.lastCenter = { x: Number.NaN, z: Number.NaN };
      terrain.lastRefinementFocus = { x: Number(focus?.x) || 0, z: Number(focus?.z) || 0 };
      terrain.computeContextSignature = "";
      terrain.surfaceEcology?.invalidateComputeContext?.();
      exactRefreshPending = true;

      rebaseCount += 1;
      totalRebasedKm += plan.distanceKm;
      const geographicFocus = geographicDestination(terrain.origin, Number(focus?.x) || 0, Number(focus?.z) || 0);
      lastRebase = Object.freeze({
        shiftXKm: plan.shiftXKm,
        shiftZKm: plan.shiftZKm,
        distanceKm: plan.distanceKm,
        latitude: geographicFocus.latitude,
        longitude: geographicFocus.longitude
      });
      terrain.onPlanetaryRebase?.(Object.freeze({
        policy: PLANETARY_SURFACE_STREAMING_POLICY,
        origin: Object.freeze({ ...terrain.origin }),
        focus: geographicFocus,
        shiftXKm: plan.shiftXKm,
        shiftZKm: plan.shiftZKm,
        distanceKm: plan.distanceKm,
        rebaseCount
      }));
    }

    const result = baseUpdate(cameraPosition);
    if (exactRefreshPending) {
      queueExactTerrainRefresh(terrain);
      exactRefreshPending = false;
    }
    updateDiagnostics();
    return result;
  };

  updateDiagnostics();
  return Object.freeze({
    dispose() {
      terrain.update = baseUpdate;
    }
  });
}
