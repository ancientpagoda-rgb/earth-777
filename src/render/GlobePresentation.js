import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const INTERACTION_PRESENTATION_SETTLE_MS = 900;
const INTERACTION_PIXEL_RATIO_CAP = 0.65;

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
  // OrbitControls' normal convention is wheel-up = zoom in and wheel-down = zoom out.
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

  // Direct manipulation gets a motion-specific presentation budget, but a plain
  // click must remain visually inert. OrbitControls emits `start` on pointer-down,
  // so entering the cheaper presentation there caused the first selection click
  // to resize the drawing buffer and blink transparent layers. We now wait for a
  // real camera `change`, which occurs on an actual drag/zoom but not a click.
  let presentationRestoreTimer = null;
  let restingPixelRatio = null;
  let restingCloudVisibility = null;
  let restingAtmosphereVisibility = null;
  let controlGestureActive = false;
  let interactionPresentationActive = false;

  function enterInteractionPresentation() {
    if (interactionPresentationActive) return;
    interactionPresentationActive = true;
    if (presentationRestoreTimer != null) clearTimeout(presentationRestoreTimer);
    presentationRestoreTimer = null;
    restingCloudVisibility = clouds.visible;
    restingAtmosphereVisibility = atmosphere.visible;
    clouds.visible = false;
    atmosphere.visible = false;

    if (restingPixelRatio == null) {
      restingPixelRatio = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
      const interactionRatio = Math.min(restingPixelRatio, INTERACTION_PIXEL_RATIO_CAP);
      if (interactionRatio < restingPixelRatio - 0.02) {
        canvas.width = Math.max(1, Math.round((canvas.clientWidth || canvas.width) * interactionRatio));
        canvas.height = Math.max(1, Math.round((canvas.clientHeight || canvas.height) * interactionRatio));
      }
    }
  }

  function restoreInteractionPresentation() {
    if (!interactionPresentationActive) return;
    if (restingPixelRatio != null) {
      canvas.width = Math.max(1, Math.round((canvas.clientWidth || canvas.width) * restingPixelRatio));
      canvas.height = Math.max(1, Math.round((canvas.clientHeight || canvas.height) * restingPixelRatio));
      restingPixelRatio = null;
    }
    if (restingCloudVisibility != null) clouds.visible = restingCloudVisibility;
    if (restingAtmosphereVisibility != null) atmosphere.visible = restingAtmosphereVisibility;
    restingCloudVisibility = null;
    restingAtmosphereVisibility = null;
    interactionPresentationActive = false;
    presentationRestoreTimer = null;
    controls.dispatchEvent({ type: "change" });
  }

  controls.addEventListener("start", () => {
    controlGestureActive = true;
    controls.enableDamping = false;
  });
  controls.addEventListener("change", () => {
    if (controlGestureActive) enterInteractionPresentation();
  });
  controls.addEventListener("end", () => {
    controlGestureActive = false;
    controls.enableDamping = true;
    if (!interactionPresentationActive) return;
    if (presentationRestoreTimer != null) clearTimeout(presentationRestoreTimer);
    presentationRestoreTimer = setTimeout(restoreInteractionPresentation, INTERACTION_PRESENTATION_SETTLE_MS);
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
