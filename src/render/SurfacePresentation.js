import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { WorkerSurfaceTerrainSystem } from "./WorkerSurfaceTerrainSystem.js";

export function createSurfacePresentation(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9eafb8);
  scene.fog = new THREE.Fog(0x9eafb8, 1.4, 440);

  const camera = new THREE.PerspectiveCamera(61, 1, 0.00005, 1200);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.00035;
  controls.maxDistance = 160;
  controls.minPolarAngle = 0.02;
  controls.maxPolarAngle = Math.PI * 0.499;
  controls.rotateSpeed = 0.42;
  controls.panSpeed = 0.48;
  controls.zoomSpeed = 1.0;

  const sky = new Sky();
  sky.scale.setScalar(420);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 3.2;
  uniforms.rayleigh.value = 2.1;
  uniforms.mieCoefficient.value = 0.004;
  uniforms.mieDirectionalG.value = 0.76;
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(238));
  uniforms.sunPosition.value.copy(sunDirection);
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xd6e8f2, 0x414850, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.copy(sunDirection).multiplyScalar(70);
  scene.add(sun);

  const terrain = new WorkerSurfaceTerrainSystem(scene, { chunkSizeKm: 2, radius: 2, segments: 18, verticalScale: 0.55 });

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshPhongMaterial({ color: 0x2f6078, transparent: true, opacity: 0.72, shininess: 70, depthWrite: false })
  );
  water.rotation.x = -Math.PI / 2;
  water.renderOrder = 1;
  scene.add(water);

  return { scene, camera, controls, terrain, water, sky, sun };
}
