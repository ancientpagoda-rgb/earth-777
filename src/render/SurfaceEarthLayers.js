import * as THREE from "three";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export const EARTH_RADIUS_KM = 6371;
export const ATMOSPHERE_REFERENCE_TOP_KM = 100;

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
  // Preserve ordering and rough relative importance without pretending the local
  // 84 km scene can display 6,371 km of depth at 1:1 vertical scale.
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
    displayScaleNote: "Deep-Earth and atmosphere heights are vertically compressed for regional visualization; labels retain real radial/depth boundaries."
  });
}

function makeLayerBox(scene, layer) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: layer.color,
    roughness: 0.94,
    metalness: layer.id.includes("core") ? 0.08 : 0,
    transparent: true,
    opacity: layer.id.includes("core") ? 0.88 : 0.82
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.earthLayerId = layer.id;
  mesh.userData.earthLayerLabel = layer.label;
  mesh.userData.trueTopDepthKm = layer.topKm;
  mesh.userData.trueBottomDepthKm = layer.bottomKm;
  scene.add(mesh);
  return mesh;
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

    for (const layer of this.layout.geology) {
      let mesh = this.geologyMeshes.get(layer.id);
      if (!mesh) {
        mesh = makeLayerBox(this.group, layer);
        this.geologyMeshes.set(layer.id, mesh);
      }
      const thickness = layer.thicknessDisplayKm;
      mesh.scale.set(insetSpan, thickness, insetSpan);
      mesh.position.set(0, Number(groundY) - layer.topDisplayKm - thickness * 0.5 - 0.035, 0);
      mesh.visible = true;
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
    return this.layout;
  }

  diagnostics() {
    return this.layout ? Object.freeze({
      visible: this.group.visible,
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
    for (const mesh of this.geologyMeshes.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const boundary of this.atmosphereBoundaries.values()) {
      boundary.geometry.dispose();
      boundary.material.dispose();
    }
    this.geologyMeshes.clear();
    this.atmosphereBoundaries.clear();
    this.scene.remove(this.group);
  }
}
