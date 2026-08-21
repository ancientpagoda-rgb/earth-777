import * as THREE from "three";

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

export function geographicSelection(hit) {
  if (!hit?.uv) return null;
  return {
    latitude: hit.uv.y * 180 - 90,
    longitude: hit.uv.x * 360 - 180,
    direction: hit.point.clone().normalize()
  };
}

export function globeDirectionFromGeographic(latitude, longitude, rotationY = 0) {
  const lat = Number(latitude) * DEG;
  const lon = Number(longitude) * DEG;
  const cosLat = Math.cos(lat);
  const direction = new THREE.Vector3(
    cosLat * Math.cos(lon),
    Math.sin(lat),
    -cosLat * Math.sin(lon)
  );
  if (Number(rotationY)) direction.applyAxisAngle(UP, Number(rotationY));
  return direction.normalize();
}
