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
    new THREE.PointsMaterial({ color: 0xb8c9c0, size: 0.035, transparent: true, opacity: 0.66, sizeAttenuation: true })
  );
}

export function createGlobePresentation(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030907);
  scene.fog = new THREE.FogExp2(0x030907, 0.016);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  camera.position.set(0, 0.7, 4.25);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.enablePan = false;
  controls.minDistance = 2.2;
  controls.maxDistance = 8.2;
  controls.rotateSpeed = 0.48;
  controls.zoomSpeed = 0.7;

  const earthMaterial = new THREE.MeshStandardMaterial({ color: 0x36503c, roughness: 0.88, metalness: 0.02 });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1.42, 64, 40), earthMaterial);
  earth.rotation.y = -0.35;
  scene.add(earth);

  const cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xd2e2d9, transparent: true, opacity: 0.18, depthWrite: false });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.438, 40, 28), cloudMaterial);
  clouds.rotation.y = 0.2;
  scene.add(clouds);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 40, 28),
    new THREE.MeshBasicMaterial({ color: 0x5f9e91, side: THREE.BackSide, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  scene.add(atmosphere);

  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.025, 0.04, 24),
    new THREE.MeshBasicMaterial({ color: 0xd1a15c, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  marker.visible = false;
  scene.add(marker);
  scene.add(createStars());
  scene.add(new THREE.HemisphereLight(0x9bc9b3, 0x10130f, 0.82));
  const sun = new THREE.DirectionalLight(0xffe1a9, 2.9);
  sun.position.set(-3.5, 2.6, 4.8);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x5f9e91, 0.85);
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
