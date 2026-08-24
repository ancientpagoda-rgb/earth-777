import * as THREE from "three";
import { EARTH_MEAN_RADIUS_KM } from "./SurfacePlanetCurvature.js";

const DEG = Math.PI / 180;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const SURFACE_PLANET_FAR_FIELD_POLICY = "georeferenced-full-earth-tangent-continuation-v2-clean-blend";

export function geographicSurfaceFrame(latitude = 0, longitude = 0) {
  const lat = finite(latitude) * DEG;
  const lon = finite(longitude) * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  // This basis matches GlobePresentation's UV convention and TerrainChunkManager's
  // local axes: +x is east, +y is away from Earth's center and +z is north.
  const east = new THREE.Vector3(-sinLon, 0, -cosLon).normalize();
  const up = new THREE.Vector3(cosLat * cosLon, sinLat, -cosLat * sinLon).normalize();
  const north = new THREE.Vector3(-sinLat * cosLon, cosLat, sinLat * sinLon).normalize();
  return Object.freeze({ east, up, north });
}

export function globalToSurfaceMatrix(latitude = 0, longitude = 0, radiusKm = 0, tangentInsetKm = 0) {
  const { east, up, north } = geographicSurfaceFrame(latitude, longitude);
  // Terrain uses +x east and +z north, which is a reflected tangent frame when
  // +y is outward. A quaternion cannot represent that reflection, so retain the
  // exact geographic mapping as a matrix. Three.js handles its negative
  // determinant when choosing the rendered front face.
  return new THREE.Matrix4().set(
    east.x, east.y, east.z, 0,
    up.x, up.y, up.z, -Math.max(0, finite(radiusKm)) - Math.max(0, finite(tangentInsetKm)),
    north.x, north.y, north.z, 0,
    0, 0, 0, 1
  );
}

export function createSurfacePlanetFarField(scene, {
  radiusKm = EARTH_MEAN_RADIUS_KM,
  tangentInsetKm = 0.035,
  widthSegments = 128,
  heightSegments = 64
} = {}) {
  const radius = Math.max(1, finite(radiusKm, EARTH_MEAN_RADIUS_KM));
  const inset = Math.max(0, finite(tangentInsetKm, 0.035));
  const geometry = new THREE.SphereGeometry(
    radius,
    Math.max(32, Math.round(finite(widthSegments, 128))),
    Math.max(16, Math.round(finite(heightSegments, 64)))
  );
  const material = new THREE.MeshBasicMaterial({
    color: 0x6f8777,
    side: THREE.FrontSide,
    fog: true,
    toneMapped: false,
    // This sphere is the backdrop beneath the streamed regional mesh. Leaving
    // its depth unwritten lets the translucent handoff composite cleanly on
    // mobile GPUs instead of two nearly coincident surfaces fighting for the
    // same low-precision depth values at planetary viewing distances.
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.identity();
  mesh.visible = false;
  mesh.frustumCulled = true;
  mesh.renderOrder = -20;
  mesh.userData.presentation = SURFACE_PLANET_FAR_FIELD_POLICY;
  scene?.add?.(mesh);

  let originSignature = "none";
  let rasterTexture = null;

  const setOrigin = (origin) => {
    const latitude = Number(origin?.latitude);
    const longitude = Number(origin?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      mesh.visible = false;
      originSignature = "none";
      return false;
    }
    const signature = `${latitude.toFixed(8)}:${longitude.toFixed(8)}`;
    if (signature !== originSignature) {
      mesh.matrix.copy(globalToSurfaceMatrix(latitude, longitude, radius, inset));
      mesh.updateMatrixWorld(true);
      originSignature = signature;
    }
    mesh.visible = true;
    return true;
  };

  const setTexture = (texture = null) => {
    rasterTexture = texture ?? null;
    material.map = rasterTexture;
    material.color.setHex(rasterTexture ? 0xffffff : 0x6f8777);
    material.needsUpdate = true;
  };

  return Object.freeze({
    mesh,
    material,
    setOrigin,
    setTexture,
    diagnostics() {
      return Object.freeze({
        policy: SURFACE_PLANET_FAR_FIELD_POLICY,
        visible: mesh.visible,
        radiusKm: radius,
        tangentInsetKm: inset,
        originSignature,
        rasterMapped: Boolean(rasterTexture)
      });
    },
    dispose() {
      scene?.remove?.(mesh);
      material.map = null;
      geometry.dispose();
      material.dispose();
      rasterTexture = null;
    }
  });
}
