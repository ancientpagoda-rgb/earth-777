import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Sky } from "three/addons/objects/Sky.js";
import { WorkerSurfaceTerrainSystem } from "./WorkerSurfaceTerrainSystem.js";
import { installSurfaceScaleController } from "./SurfaceScaleController.js";
import { SurfaceEarthLayers } from "./SurfaceEarthLayers.js";
import { createRegionalAerialMaterial } from "./RegionalAerialMaterial.js";

function createSeaLevelOutline() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, 0, -0.5),
    new THREE.Vector3(0.5, 0, -0.5),
    new THREE.Vector3(0.5, 0, 0.5),
    new THREE.Vector3(-0.5, 0, 0.5)
  ]);
  const material = new THREE.LineBasicMaterial({
    color: 0x71aec7,
    transparent: true,
    opacity: 0.78,
    depthWrite: false
  });
  const outline = new THREE.LineLoop(geometry, material);
  outline.visible = false;
  outline.renderOrder = 2;
  outline.userData.presentation = "regional-sea-level-reference";
  return outline;
}

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

  // Regional/landscape rendering is an aerial reconstruction. Broad color comes
  // from simulated vegetation, hydrology and elevation vertex data; this shared
  // world-coordinate fragment material adds continuous sub-kilometer texture
  // without exposing chunk borders or pretending modern satellite imagery exists.
  const aerialMaterial = createRegionalAerialMaterial();
  const baseMeshFromResult = terrain._meshFromResult.bind(terrain);
  terrain._meshFromResult = (result, candidate) => {
    const mesh = baseMeshFromResult(result, candidate);
    if (terrain.chunkSizeKm >= 8) {
      mesh.material = aerialMaterial;
      mesh.userData.surfacePresentation = "science-colored-aerial-fragment-mosaic-v2";
    }
    return mesh;
  };

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshPhongMaterial({ color: 0x315d70, transparent: true, opacity: 0.64, shininess: 44, depthWrite: false })
  );
  water.rotation.x = -Math.PI / 2;
  water.renderOrder = 1;
  scene.add(water);

  // At regional/landscape scale, a filled ocean plane is visually misleading
  // because we do not yet have a shoreline mask at the same resolution. Keep
  // sea level visible as a precise horizontal reference outline instead.
  const seaLevelOutline = createSeaLevelOutline();
  scene.add(seaLevelOutline);

  const earthLayers = new SurfaceEarthLayers(scene);
  const baseConfigureEarthLayers = earthLayers.configure.bind(earthLayers);
  earthLayers.configure = (options = {}) => baseConfigureEarthLayers({
    ...options,
    cameraPosition: camera.position
  });

  const surfaceScale = installSurfaceScaleController({ scene, terrain, controls, water, seaLevelOutline, earthLayers });

  // A routed river that is scientifically meaningful at local scale is far
  // narrower than one regional mesh cell. Drawing that ribbon from orbit aliases
  // into long trench-like lines. Keep regional drainage in the aerial color field
  // and reveal explicit river geometry only once the ecology/local bands are active.
  const baseApplyVisibility = surfaceScale._applyVisibility.bind(surfaceScale);
  surfaceScale._applyVisibility = (band = surfaceScale.band) => {
    baseApplyVisibility(band);
    if (terrain.surfaceEcology?.river) {
      terrain.surfaceEcology.river.visible = band?.id === "ecology" || band?.id === "ground";
    }
  };

  // Satellite-style landscape is the normal view. Press L while the regional
  // surface controls are active to inspect atmosphere + deep-Earth cutaway.
  const toggleEarthLayers = (event) => {
    if (event.code !== "KeyL" || event.repeat || !controls.enabled) return;
    if (event.target instanceof HTMLElement && event.target.closest("button, input, a, textarea, select, summary")) return;
    event.preventDefault();
    terrain.toggleEarthLayerInspection?.();
    controls.dispatchEvent({ type: "change" });
  };
  addEventListener("keydown", toggleEarthLayers);

  const baseDispose = terrain.dispose.bind(terrain);
  terrain.dispose = () => {
    removeEventListener("keydown", toggleEarthLayers);
    aerialMaterial.dispose();
    baseDispose();
  };

  return { scene, camera, controls, terrain, water, seaLevelOutline, sky, sun, earthLayers };
}
