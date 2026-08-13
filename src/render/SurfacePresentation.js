import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TerrainChunkManager } from "./TerrainChunkManager.js";

export function createSurfacePresentation(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fa69c);
  scene.fog = new THREE.FogExp2(0x8fa69c, 0.027);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.02, 180);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = true;
  controls.minDistance = 0.35;
  controls.maxDistance = 35;
  controls.maxPolarAngle = Math.PI * 0.49;
  scene.add(new THREE.HemisphereLight(0xb7d0c7, 0x40392d, 1.6));
  const sun = new THREE.DirectionalLight(0xffe0ad, 3.1);
  sun.position.set(-8, 13, 4);
  scene.add(sun);
  const terrain = new TerrainChunkManager(scene, { chunkSizeKm: 8, radius: 2, segments: 18, verticalScale: 0.55 });
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshPhongMaterial({ color: 0x315b68, transparent: true, opacity: 0.72, shininess: 70, depthWrite: false })
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  return { scene, camera, controls, terrain, water };
}
