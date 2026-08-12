import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { feature } from "topojson-client";
import landTopology from "world-atlas/land-110m.json";

const TAU = Math.PI * 2;
const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 512;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;

function noise(longitude, latitude) {
  return (
    Math.sin(longitude * 0.071 + latitude * 0.053) * 0.45 +
    Math.sin(longitude * 0.019 - latitude * 0.127) * 0.3 +
    Math.cos(longitude * 0.173 + latitude * 0.011) * 0.25
  );
}

function drawRing(context, ring) {
  let previousX = null;
  for (const [longitude, latitude] of ring) {
    const x = ((longitude + 180) / 360) * TEXTURE_WIDTH;
    const y = ((90 - latitude) / 180) * TEXTURE_HEIGHT;
    if (previousX === null || Math.abs(x - previousX) > TEXTURE_WIDTH * 0.5) context.moveTo(x, y);
    else context.lineTo(x, y);
    previousX = x;
  }
}

function createLandMask() {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#fff";
  const land = feature(landTopology, landTopology.objects.land);
  const geometries = land.type === "FeatureCollection"
    ? land.features.map((item) => item.geometry)
    : [land.geometry];
  for (const geometry of geometries) {
    if (!geometry) continue;
    const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
    for (const polygon of polygons) {
      context.beginPath();
      for (const ring of polygon) drawRing(context, ring);
      context.fill("evenodd");
    }
  }
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function colorEarthPixel(data, offset, land, latitude, longitude, state) {
  if (!land) {
    const polar = Math.abs(latitude) / 90;
    const depth = 0.5 + noise(longitude * 0.8, latitude * 0.8) * 0.18;
    data[offset] = 4 + depth * 7;
    data[offset + 1] = 19 + depth * 13;
    data[offset + 2] = 24 + depth * 19;
    if (polar > 0.84 + state.iceIndex * 0.05) {
      const ice = clamp((polar - 0.84) * 5, 0, 0.7);
      data[offset] = mix(data[offset], 154, ice);
      data[offset + 1] = mix(data[offset + 1], 181, ice);
      data[offset + 2] = mix(data[offset + 2], 177, ice);
    }
    data[offset + 3] = 255;
    return;
  }

  const absLat = Math.abs(latitude);
  const temperature = 28 - absLat * 0.58 + state.temperatureAnomaly * (1 + absLat / 110);
  const moisture = clamp(0.58 + Math.cos(latitude * Math.PI / 45) * 0.18 + noise(longitude, latitude) * 0.28, 0, 1);
  const rugged = noise(longitude * 2.4, latitude * 2.2);
  let red;
  let green;
  let blue;

  if (absLat > 73 - state.iceIndex * 9 || temperature < -10) {
    red = 182 + rugged * 18;
    green = 198 + rugged * 15;
    blue = 190 + rugged * 13;
  } else if (temperature < 2) {
    red = 82 + rugged * 12;
    green = 93 + rugged * 13;
    blue = 81 + rugged * 10;
  } else if (moisture > 0.69) {
    red = 30 + rugged * 10;
    green = 69 + rugged * 18;
    blue = 48 + rugged * 10;
  } else if (moisture > 0.39) {
    red = 69 + rugged * 18;
    green = 88 + rugged * 21;
    blue = 52 + rugged * 12;
  } else {
    red = 111 + rugged * 24;
    green = 93 + rugged * 20;
    blue = 52 + rugged * 12;
  }

  data[offset] = clamp(red, 0, 255);
  data[offset + 1] = clamp(green, 0, 255);
  data[offset + 2] = clamp(blue, 0, 255);
  data[offset + 3] = 255;
}

function createEarthTexture(mask, state) {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  const image = context.createImageData(TEXTURE_WIDTH, TEXTURE_HEIGHT);
  for (let y = 0; y < TEXTURE_HEIGHT; y += 1) {
    const latitude = 90 - (y / (TEXTURE_HEIGHT - 1)) * 180;
    for (let x = 0; x < TEXTURE_WIDTH; x += 1) {
      const offset = (y * TEXTURE_WIDTH + x) * 4;
      const longitude = (x / (TEXTURE_WIDTH - 1)) * 360 - 180;
      colorEarthPixel(image.data, offset, mask[offset] > 127, latitude, longitude, state);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createCloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 420; i += 1) {
    const x = (Math.sin(i * 913.17) * 0.5 + 0.5) * canvas.width;
    const y = (Math.sin(i * 271.91 + 2) * 0.5 + 0.5) * canvas.height;
    const latitude = 90 - y / canvas.height * 180;
    if (Math.abs(latitude) > 76) continue;
    const width = 12 + (Math.sin(i * 71.3) * 0.5 + 0.5) * 44;
    const height = 3 + (Math.cos(i * 37.4) * 0.5 + 0.5) * 10;
    const gradient = context.createRadialGradient(x, y, 0, x, y, width);
    gradient.addColorStop(0, "rgba(210,226,217,0.22)");
    gradient.addColorStop(1, "rgba(210,226,217,0)");
    context.fillStyle = gradient;
    context.save();
    context.translate(x, y);
    context.scale(1, height / width);
    context.beginPath();
    context.arc(0, 0, width, 0, TAU);
    context.fill();
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStars(count = 1700) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const radius = 18 + Math.random() * 22;
    const theta = Math.random() * TAU;
    const phi = Math.acos(2 * Math.random() - 1);
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

export class EarthView {
  constructor(canvas, initialState, onSelect) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.mask = createLandMask();
    this.lastTextureYear = initialState.yearBP;
    this.pointerStart = null;
    this.selectedNormal = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030907);
    this.scene.fog = new THREE.FogExp2(0x030907, 0.016);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    this.camera.position.set(0, 0.7, 4.25);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 8.2;
    this.controls.rotateSpeed = 0.48;
    this.controls.zoomSpeed = 0.7;

    this.earthMaterial = new THREE.MeshStandardMaterial({
      map: createEarthTexture(this.mask, initialState),
      roughness: 0.88,
      metalness: 0.02
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1.42, 128, 80), this.earthMaterial);
    this.earth.rotation.y = -0.35;
    this.scene.add(this.earth);

    const cloudMaterial = new THREE.MeshLambertMaterial({
      map: createCloudTexture(),
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.438, 96, 64), cloudMaterial);
    this.clouds.rotation.y = 0.2;
    this.scene.add(this.clouds);

    const atmosphereMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.3);
          gl_FragColor = vec4(0.24, 0.55, 0.50, 1.0) * intensity * 0.72;
        }
      `
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.55, 96, 64), atmosphereMaterial);
    this.scene.add(this.atmosphere);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.025, 0.04, 32),
      new THREE.MeshBasicMaterial({ color: 0xd1a15c, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.scene.add(createStars());
    this.scene.add(new THREE.HemisphereLight(0x9bc9b3, 0x10130f, 0.82));
    const sun = new THREE.DirectionalLight(0xffe1a9, 2.9);
    sun.position.set(-3.5, 2.6, 4.8);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x5f9e91, 0.85);
    rim.position.set(4, -1.5, -3);
    this.scene.add(rim);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener("pointerdown", (event) => this._pointerDown(event));
    canvas.addEventListener("pointerup", (event) => this._pointerUp(event));
    this.resize();
  }

  _pointerDown(event) {
    this.pointerStart = { x: event.clientX, y: event.clientY };
  }

  _pointerUp(event) {
    if (!this.pointerStart || Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 7) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.earth)[0];
    if (!hit?.uv) return;
    const longitude = hit.uv.x * 360 - 180;
    const latitude = hit.uv.y * 180 - 90;
    this.selectedNormal = hit.point.clone().normalize();
    this.marker.position.copy(this.selectedNormal).multiplyScalar(1.445);
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.selectedNormal);
    this.marker.visible = true;
    this.onSelect?.({ latitude, longitude, normal: this.selectedNormal.clone() });
  }

  focusSelection() {
    if (!this.selectedNormal) return;
    this.camera.position.copy(this.selectedNormal).multiplyScalar(2.28);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  updateState(state, force = false) {
    if (!force && Math.abs(state.yearBP - this.lastTextureYear) < 2_500) return;
    const next = createEarthTexture(this.mask, state);
    this.earthMaterial.map?.dispose();
    this.earthMaterial.map = next;
    this.earthMaterial.needsUpdate = true;
    this.lastTextureYear = state.yearBP;
  }

  resize() {
    const width = this.canvas.clientWidth || innerWidth;
    const height = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(deltaSeconds) {
    this.controls.update();
    this.clouds.rotation.y += deltaSeconds * 0.004;
    if (this.marker.visible) {
      const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.16;
      this.marker.scale.setScalar(pulse);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
