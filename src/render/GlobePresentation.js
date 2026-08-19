import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function createStars(count = 700) {
  const positions = new Float32Array(count * 3);
  let state = 0x777001;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < count; i += 1) {
    const radius = 18 + random() * 22;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xc7d1d9, size: 0.035, transparent: true, opacity: 0.66, sizeAttenuation: true })
  );
}

export function createGlobePresentation(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02060a);
  scene.fog = new THREE.FogExp2(0x02060a, 0.004);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.001, 500);
  camera.position.set(0, 0.7, 4.25);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.enablePan = false;
  controls.minDistance = 1.425;
  controls.maxDistance = 120;
  controls.rotateSpeed = 0.54;
  controls.zoomSpeed = 1.0;

  const earthMaterial = new THREE.MeshStandardMaterial({
    color: 0x48545c,
    roughness: 0.9,
    metalness: 0.01,
    emissive: 0x020304,
    emissiveIntensity: 0.08
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1.42, 64, 40), earthMaterial);
  earth.rotation.y = -0.35;
  scene.add(earth);

  const cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xf4f7f8, transparent: true, opacity: 0.2, depthWrite: false });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.438, 40, 28), cloudMaterial);
  clouds.rotation.y = 0.2;
  scene.add(clouds);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 40, 28),
    new THREE.MeshBasicMaterial({ color: 0x4d8fbd, side: THREE.BackSide, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  scene.add(atmosphere);

  // Keep renderer resolution and transparent layers stable throughout wheel/pinch
  // zooms. EarthView already owns adaptive pixel ratio / LOD decisions; changing
  // the canvas backing-store size here caused a visible zoom pop and briefly put
  // OrbitControls and the renderer on different viewport assumptions.
  controls.addEventListener("start", () => {
    controls.enableDamping = false;
  });
  controls.addEventListener("end", () => {
    controls.enableDamping = true;
  });

  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.025, 0.04, 24),
    new THREE.MeshBasicMaterial({ color: 0xb7cfdb, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  marker.visible = false;
  scene.add(marker);
  scene.add(createStars());

  // Neutral daylight preserves the raster's own colors instead of adding a green/yellow cast.
  scene.add(new THREE.AmbientLight(0xe8f0f5, 0.9));
  scene.add(new THREE.HemisphereLight(0xdcecf5, 0x1c252b, 1.05));

  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-3.5, 2.6, 4.8);
  scene.add(sun);

  const rim = new THREE.DirectionalLight(0x79a8c4, 0.34);
  rim.position.set(4, -1.5, -3);
  scene.add(rim);

  return { scene, camera, controls, earth, earthMaterial, clouds, cloudMaterial, atmosphere, marker };
}

export function textureFromRaster(message) {
  const texture = new THREE.DataTexture(new Uint8Array(message.buffer), message.width, message.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
