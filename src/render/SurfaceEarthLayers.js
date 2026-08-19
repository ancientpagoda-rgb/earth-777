import * as THREE from "three";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export const EARTH_RADIUS_KM = 6371;
export const ATMOSPHERE_REFERENCE_TOP_KM = 100;
export const EARTH_LAYER_PRESENTATION = "open-sidewall-cutaway-v2";

export const DEEP_EARTH_BOUNDARIES_KM = Object.freeze({
  mohoContinental: 35,
  mohoOceanic: 7,
  lithosphere: 100,
  transitionZone: 660,
  coreMantleBoundary: 2890,
  innerCoreBoundary: 5150,
  center: 6371
});

const GEOLOGY_COLORS = Object.freeze({
  upperCrust: 0x735444,
  lowerCrust: 0x5c4038,
  lithosphericMantle: 0x6f4939,
  upperMantle: 0x8b5036,
  lowerMantle: 0xa45d36,
  outerCore: 0xc9853d,
  innerCore: 0xe0b76a
});

const ATMOSPHERE_COLORS = Object.freeze({
  troposphere: 0x78b8d5,
  stratosphere: 0x72a7d0,
  mesosphere: 0x648ab7,
  karman: 0xa9d6ea
});

export function surfaceEarthLayerProfile({ baseElevationMeters = 0, seaLevelMeters = 0 } = {}) {
  const base = Number(baseElevationMeters) || 0;
  const sea = Number(seaLevelMeters) || 0;
  const oceanic = base < sea - 450;
  const crustThicknessKm = oceanic ? DEEP_EARTH_BOUNDARIES_KM.mohoOceanic : DEEP_EARTH_BOUNDARIES_KM.mohoContinental;
  const upperCrustBottomKm = oceanic ? 2 : 15;

  return Object.freeze({
    crustType: oceanic ? "oceanic" : "continental",
    crustThicknessKm,
    geology: Object.freeze([
      Object.freeze({ id: "upper-crust", label: `upper ${oceanic ? "oceanic" : "continental"} crust`, topKm: 0, bottomKm: upperCrustBottomKm, color: GEOLOGY_COLORS.upperCrust }),
      Object.freeze({ id: "lower-crust", label: `lower ${oceanic ? "oceanic" : "continental"} crust`, topKm: upperCrustBottomKm, bottomKm: crustThicknessKm, color: GEOLOGY_COLORS.lowerCrust }),
      Object.freeze({ id: "lithospheric-mantle", label: "lithospheric mantle", topKm: crustThicknessKm, bottomKm: DEEP_EARTH_BOUNDARIES_KM.lithosphere, color: GEOLOGY_COLORS.lithosphericMantle }),
      Object.freeze({ id: "upper-mantle", label: "upper mantle / transition zone", topKm: DEEP_EARTH_BOUNDARIES_KM.lithosphere, bottomKm: DEEP_EARTH_BOUNDARIES_KM.transitionZone, color: GEOLOGY_COLORS.upperMantle }),
      Object.freeze({ id: "lower-mantle", label: "lower mantle", topKm: DEEP_EARTH_BOUNDARIES_KM.transitionZone, bottomKm: DEEP_EARTH_BOUNDARIES_KM.coreMantleBoundary, color: GEOLOGY_COLORS.lowerMantle }),
      Object.freeze({ id: "outer-core", label: "liquid outer core", topKm: DEEP_EARTH_BOUNDARIES_KM.coreMantleBoundary, bottomKm: DEEP_EARTH_BOUNDARIES_KM.innerCoreBoundary, color: GEOLOGY_COLORS.outerCore }),
      Object.freeze({ id: "inner-core", label: "solid inner core", topKm: DEEP_EARTH_BOUNDARIES_KM.innerCoreBoundary, bottomKm: DEEP_EARTH_BOUNDARIES_KM.center, color: GEOLOGY_COLORS.innerCore })
    ]),
    atmosphere: Object.freeze([
      Object.freeze({ id: "troposphere", label: "troposphere", topKm: 12, color: ATMOSPHERE_COLORS.troposphere }),
      Object.freeze({ id: "stratosphere", label: "stratosphere", topKm: 50, color: ATMOSPHERE_COLORS.stratosphere }),
      Object.freeze({ id: "mesosphere", label: "mesosphere", topKm: 85, color: ATMOSPHERE_COLORS.mesosphere }),
      Object.freeze({ id: "karman-line", label: "100 km atmosphere reference / Kármán line", topKm: ATMOSPHERE_REFERENCE_TOP_KM, color: ATMOSPHERE_COLORS.karman })
    ])
  });
}

function compressedGeologyWeights(profile) {
  const weights = {
    "upper-crust": 0.85,
    "lower-crust": 0.95,
    "lithospheric-mantle": 0.90,
    "upper-mantle": 1.15,
    "lower-mantle": 1.45,
    "outer-core": 1.60,
    "inner-core": 1.20
  };
  return profile.geology.map((layer) => weights[layer.id] ?? 1);
}

export function surfaceEarthLayerLayout({
  spanKm = 84,
  baseElevationMeters = 0,
  seaLevelMeters = 0
} = {}) {
  const span = Math.max(1, Number(spanKm) || 84);
  const profile = surfaceEarthLayerProfile({ baseElevationMeters, seaLevelMeters });
  const geologyDisplayDepthKm = clamp(span * 0.16, 8, 15);
  const atmosphereDisplayHeightKm = clamp(span * 0.12, 6, 12);
  const weights = compressedGeologyWeights(profile);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  let geologyTop = 0;
  const geology = profile.geology.map((layer, index) => {
    const thickness = geologyDisplayDepthKm * weights[index] / weightSum;
    const topDisplayKm = geologyTop;
    const bottomDisplayKm = geologyTop + thickness;
    geologyTop = bottomDisplayKm;
    return Object.freeze({ ...layer, topDisplayKm, bottomDisplayKm, thicknessDisplayKm: thickness });
  });

  const atmosphere = profile.atmosphere.map((layer) => Object.freeze({
    ...layer,
    heightDisplayKm: atmosphereDisplayHeightKm * clamp(layer.topKm / ATMOSPHERE_REFERENCE_TOP_KM, 0, 1)
  }));

  return Object.freeze({
    spanKm: span,
    crustType: profile.crustType,
    crustThicknessKm: profile.crustThicknessKm,
    geologyDisplayDepthKm,
    atmosphereDisplayHeightKm,
    geology: Object.freeze(geology),
    atmosphere: Object.freeze(atmosphere),
    presentation: EARTH_LAYER_PRESENTATION,
    displayScaleNote: "Deep-Earth and atmosphere heights are vertically compressed for regional visualization; labels retain real radial/depth boundaries."
  });
}

function makeGeologySidewall(layer) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: layer.color,
    roughness: 0.95,
    metalness: layer.id.includes("core") ? 0.06 : 0,
    side: THREE.DoubleSide
  });
  const sideGeometry = new THREE.PlaneGeometry(1, 1);

  const front = new THREE.Mesh(sideGeometry, material);
  const back = new THREE.Mesh(sideGeometry, material);
  const left = new THREE.Mesh(sideGeometry, material);
  const right = new THREE.Mesh(sideGeometry, material);
  back.rotation.y = Math.PI;
  left.rotation.y = Math.PI / 2;
  right.rotation.y = -Math.PI / 2;

  for (const mesh of [front, back, left, right]) {
    mesh.userData.earthLayerId = layer.id;
    mesh.userData.earthLayerLabel = layer.label;
    mesh.userData.trueTopDepthKm = layer.topKm;
    mesh.userData.trueBottomDepthKm = layer.bottomKm;
    mesh.renderOrder = -2;
    group.add(mesh);
  }

  group.userData.earthLayerId = layer.id;
  group.userData.earthLayerLabel = layer.label;
  group.userData.trueTopDepthKm = layer.topKm;
  group.userData.trueBottomDepthKm = layer.bottomKm;
  group.userData.presentation = EARTH_LAYER_PRESENTATION;
  group.userData.sideMeshes = { front, back, left, right };
  return group;
}

function configureGeologySidewall(group, span, topY, thickness) {
  const { front, back, left, right } = group.userData.sideMeshes;
  const half = span * 0.5;
  const centerY = topY - thickness * 0.5;

  front.scale.set(span, thickness, 1);
  front.position.set(0, centerY, half);
  back.scale.set(span, thickness, 1);
  back.position.set(0, centerY, -half);

  left.scale.set(span, thickness, 1);
  left.position.set(-half, centerY, 0);
  right.scale.set(span, thickness, 1);
  right.position.set(half, centerY, 0);
}

function makeDepthBoundary(layer) {
  const points = [
    new THREE.Vector3(-0.5, 0, -0.5),
    new THREE.Vector3(0.5, 0, -0.5),
    new THREE.Vector3(0.5, 0, 0.5),
    new THREE.Vector3(-0.5, 0, 0.5),
    new THREE.Vector3(-0.5, 0, -0.5)
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: 0xe4d0bd, transparent: true, opacity: 0.28, depthWrite: false });
  const line = new THREE.Line(geometry, material);
  line.userData.earthLayerId = `${layer.id}-boundary`;
  line.userData.earthLayerLabel = `${layer.label} lower boundary`;
  line.userData.trueDepthKm = layer.bottomKm;
  line.renderOrder = -1;
  return line;
}

function makeAtmosphereBoundary(scene, layer) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(geometry);
  geometry.dispose();
  const material = new THREE.LineBasicMaterial({
    color: layer.color,
    transparent: true,
    opacity: layer.id === "karman-line" ? 0.42 : 0.20,
    depthWrite: false
  });
  const lines = new THREE.LineSegments(edges, material);
  lines.userData.earthLayerId = layer.id;
  lines.userData.earthLayerLabel = layer.label;
  lines.userData.trueAltitudeKm = layer.topKm;
  scene.add(lines);
  return lines;
}

export class SurfaceEarthLayers {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geologyMeshes = new Map();
    this.depthBoundaries = new Map();
    this.atmosphereBoundaries = new Map();
    this.layout = null;
    this.visible = true;
  }

  configure({ spanKm, groundY = 0, baseElevationMeters = 0, seaLevelMeters = 0, visible = true } = {}) {
    this.visible = Boolean(visible);
    this.group.visible = this.visible;
    if (!this.visible) return null;

    this.layout = surfaceEarthLayerLayout({ spanKm, baseElevationMeters, seaLevelMeters });
    const insetSpan = this.layout.spanKm * 0.985;
    const surfaceY = Number(groundY) - 0.035;

    for (const layer of this.layout.geology) {
      let mesh = this.geologyMeshes.get(layer.id);
      if (!mesh) {
        mesh = makeGeologySidewall(layer);
        this.geologyMeshes.set(layer.id, mesh);
        this.group.add(mesh);
      }
      const thickness = layer.thicknessDisplayKm;
      const layerTopY = surfaceY - layer.topDisplayKm;
      configureGeologySidewall(mesh, insetSpan, layerTopY, thickness);
      mesh.visible = true;

      let boundary = this.depthBoundaries.get(layer.id);
      if (!boundary) {
        boundary = makeDepthBoundary(layer);
        this.depthBoundaries.set(layer.id, boundary);
        this.group.add(boundary);
      }
      boundary.scale.set(insetSpan, 1, insetSpan);
      boundary.position.set(0, surfaceY - layer.bottomDisplayKm, 0);
      boundary.visible = true;
    }

    for (const layer of this.layout.atmosphere) {
      let boundary = this.atmosphereBoundaries.get(layer.id);
      if (!boundary) {
        boundary = makeAtmosphereBoundary(this.group, layer);
        this.atmosphereBoundaries.set(layer.id, boundary);
      }
      const height = layer.heightDisplayKm;
      boundary.scale.set(this.layout.spanKm, Math.max(0.05, height), this.layout.spanKm);
      boundary.position.set(0, Number(groundY) + height * 0.5, 0);
      boundary.visible = true;
    }

    this.group.userData.earthLayerLayout = this.layout;
    this.group.userData.presentation = EARTH_LAYER_PRESENTATION;
    return this.layout;
  }

  diagnostics() {
    return this.layout ? Object.freeze({
      visible: this.group.visible,
      presentation: EARTH_LAYER_PRESENTATION,
      surfaceOcclusionFree: true,
      crustType: this.layout.crustType,
      crustThicknessKm: this.layout.crustThicknessKm,
      geologyDisplayDepthKm: this.layout.geologyDisplayDepthKm,
      atmosphereReferenceTopKm: ATMOSPHERE_REFERENCE_TOP_KM,
      atmosphereDisplayHeightKm: this.layout.atmosphereDisplayHeightKm,
      geologyLayers: this.layout.geology.map((layer) => layer.label),
      atmosphereBoundaries: this.layout.atmosphere.map((layer) => layer.label),
      displayScaleNote: this.layout.displayScaleNote
    }) : Object.freeze({ visible: false });
  }

  dispose() {
    for (const group of this.geologyMeshes.values()) {
      const meshes = Object.values(group.userData.sideMeshes ?? {});
      const disposedGeometries = new Set();
      const disposedMaterials = new Set();
      for (const mesh of meshes) {
        if (!disposedGeometries.has(mesh.geometry)) {
          mesh.geometry.dispose();
          disposedGeometries.add(mesh.geometry);
        }
        if (!disposedMaterials.has(mesh.material)) {
          mesh.material.dispose();
          disposedMaterials.add(mesh.material);
        }
      }
    }
    for (const boundary of this.depthBoundaries.values()) {
      boundary.geometry.dispose();
      boundary.material.dispose();
    }
    for (const boundary of this.atmosphereBoundaries.values()) {
      boundary.geometry.dispose();
      boundary.material.dispose();
    }
    this.geologyMeshes.clear();
    this.depthBoundaries.clear();
    this.atmosphereBoundaries.clear();
    this.scene.remove(this.group);
  }
}
