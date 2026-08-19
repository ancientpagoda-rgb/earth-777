import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { WorkerSurfaceTerrainSystem } from "./WorkerSurfaceTerrainSystem.js";
import { installSurfaceScaleController } from "./SurfaceScaleController.js";
import { SurfaceEarthLayers } from "./SurfaceEarthLayers.js";

export function createSurfacePresentation(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7899aa);
  scene.fog = new THREE.Fog(0x7899aa, 110, 360);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.00005, 1200);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.00035;
  controls.maxDistance = 220;
  controls.minPolarAngle = 0.02;
  controls.maxPolarAngle = Math.PI * 0.499;
  controls.rotateSpeed = 0.42;
  controls.panSpeed = 0.48;
  controls.zoomSpeed = 1.0;

  const sky = new Sky();
  sky.scale.setScalar(420);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 4.0;
  uniforms.rayleigh.value = 1.9;
  uniforms.mieCoefficient.value = 0.0035;
  uniforms.mieDirectionalG.value = 0.78;
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(238));
  uniforms.sunPosition.value.copy(sunDirection);
  sky.visible = false;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xd6e8f2, 0x414850, 0.82));
  const sun = new THREE.DirectionalLight(0xffffff, 1.55);
  sun.position.copy(sunDirection).multiplyScalar(90);
  scene.add(sun);

  const terrain = new WorkerSurfaceTerrainSystem(scene, { chunkSizeKm: 28, radius: 1, segments: 32, verticalScale: 0.90 });

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshPhongMaterial({ color: 0x315d70, transparent: true, opacity: 0.64, shininess: 44, depthWrite: false })
  );
  water.rotation.x = -Math.PI / 2;
  water.renderOrder = 1;
  scene.add(water);

  // Regional/landscape views deliberately expose vertical structure. The
  // cutaway is compressed vertically, but its metadata preserves the real
  // atmosphere, crust, mantle, outer-core and inner-core boundaries.
  const earthLayers = new SurfaceEarthLayers(scene);

  installSurfaceScaleController({ scene, terrain, controls, water, earthLayers });

  return { scene, camera, controls, terrain, water, sky, sun, earthLayers };
}
