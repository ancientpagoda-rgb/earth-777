import * as THREE from "three";
import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";
import { tectonicElevationOffsetMeters } from "../sim/DynamicLithosphere.js";

const KM_PER_DEGREE_LATITUDE = 111.32;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;
const wrapLongitudeDelta = (value) => ((Number(value) + 540) % 360) - 180;

function chunkKey(x, z) { return `${x}:${z}`; }

function terrainColor(latitude, elevationMeters, reliefMeters, groundTint = null) {
  const absLat = Math.abs(latitude);
  let base;
  if (elevationMeters < 0) base = [0.07, 0.16, 0.17];
  else if (absLat > 68 || elevationMeters > 3200) base = [0.57, 0.62, 0.57];
  else if (elevationMeters > 1900) base = [0.36, 0.34, 0.25];
  else {
    const relief = clamp(Math.abs(reliefMeters) / 900, 0, 1);
    if (absLat < 25) base = [0.24 + relief * 0.08, 0.36 + relief * 0.04, 0.18];
    else if (absLat < 48) base = [0.28 + relief * 0.08, 0.38, 0.2];
    else base = [0.31 + relief * 0.06, 0.36, 0.24];
  }
  if (!groundTint || elevationMeters < 0) return base;
  const blend = 0.38;
  return [mix(base[0], groundTint[0], blend), mix(base[1], groundTint[1], blend), mix(base[2], groundTint[2], blend)];
}

export class TerrainChunkManager {
  constructor(scene, { chunkSizeKm = 2, radius = 2, segments = 18, verticalScale = 0.55 } = {}) {
    this.scene = scene;
    this.chunkSizeKm = chunkSizeKm;
    this.radius = radius;
    this.segments = segments;
    this.verticalScale = verticalScale;
    this.origin = null;
    this.baseElevationMeters = 0;
    this.biomeProfile = null;
    this.earthState = null;
    this.branchSeed = 777001;
    this.topographySignature = "none";
    this.geomorphologyPatch = null;
    this.geomorphologySignature = "none";
    this.contourIntervalMeters = 20;
    this.contourOpacity = 0.50;
    this.contourUniforms = null;
    this.chunks = new Map();
    this.queue = [];
    this.queuedKeys = new Set();
    this.lastCenter = { x: Number.NaN, z: Number.NaN };
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.FrontSide });
    this._installContourShader();
  }

  _installContourShader() {
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uContourIntervalMeters = { value: this.contourIntervalMeters };
      shader.uniforms.uContourOpacity = { value: this.contourOpacity };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float elevationMeters;\nvarying float vTerrainElevationMeters;"
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvTerrainElevationMeters = elevationMeters;"
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vTerrainElevationMeters;\nuniform float uContourIntervalMeters;\nuniform float uContourOpacity;"
        )
        .replace(
          "#include <dithering_fragment>",
          `float contourCoord = vTerrainElevationMeters / max(1.0, uContourIntervalMeters);
float contourFraction = fract(contourCoord);
float contourDistance = min(contourFraction, 1.0 - contourFraction);
float contourAA = max(fwidth(contourCoord) * 1.15, 0.011);
float contourLine = 1.0 - smoothstep(contourAA * 0.35, contourAA * 1.85, contourDistance);
float contourIndex = floor(abs(contourCoord) + 0.5);
float majorContour = 1.0 - step(0.01, abs(mod(contourIndex, 5.0)));
float contourStrength = contourLine * mix(uContourOpacity, min(0.82, uContourOpacity * 1.45), majorContour);
gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.24, contourStrength);
#include <dithering_fragment>`
        );
      this.contourUniforms = shader.uniforms;
    };
    this.material.customProgramCacheKey = () => "earth777-terrain-contours-v2";
  }

  setEarthSystemState(state, seed = state?.seed ?? this.branchSeed) {
    this.earthState = state ?? null;
    this.branchSeed = Number(seed) >>> 0;
    const elapsedBand = Math.floor((Number(state?.elapsedYears) || 0) / 2_500);
    const boundaryBand = Math.round((Number(state?.tectonicBoundaryActivity) || 1) * 20);
    const nextSignature = `${elapsedBand}:${boundaryBand}:${this.branchSeed}`;
    if (nextSignature !== this.topographySignature) {
      this.topographySignature = nextSignature;
      if (this.origin) {
        this.baseElevationMeters = this._elevationAt(this.origin.latitude, this.origin.longitude);
        this.clear();
        this.lastCenter = { x: Number.NaN, z: Number.NaN };
      }
    }
  }

  setOrigin(latitude, longitude) {
    this.origin = { latitude: Number(latitude), longitude: Number(longitude) };
    this.baseElevationMeters = this._elevationAt(this.origin.latitude, this.origin.longitude);
    this.clear();
    this.lastCenter = { x: Number.NaN, z: Number.NaN };
  }

  setGeomorphologyPatch(patch) {
    const next = patch ?? null;
    const signature = next ? [
      next.policy ?? "geomorphology",
      Number(next.networkCellIndex ?? -1),
      Number(next.geomorphicElevationOffsetMeters ?? 0).toFixed(2),
      Number(next.geomorphicGradientEastMetersPerKm ?? 0).toFixed(4),
      Number(next.geomorphicGradientNorthMetersPerKm ?? 0).toFixed(4),
      Number(next.channelBearingRadians ?? 0).toFixed(4),
      Number(next.channelDistanceFromSelectionKm ?? -1).toFixed(2),
      Number(next.meanDischargeM3s ?? 0).toFixed(2)
    ].join("|") : "none";
    if (signature === this.geomorphologySignature) return false;
    this.geomorphologyPatch = next;
    this.geomorphologySignature = signature;
    if (this.origin) {
      this.baseElevationMeters = this._elevationAt(this.origin.latitude, this.origin.longitude);
      this.clear();
      this.lastCenter = { x: Number.NaN, z: Number.NaN };
    }
    return true;
  }

  setBiomeProfile(profile) {
    const next = profile ?? null;
    const previous = this.biomeProfile?.groundColor?.join(",") ?? "none";
    const signature = next?.groundColor?.join(",") ?? "none";
    this.biomeProfile = next;
    if (previous !== signature && this.origin) {
      this.clear();
      this.lastCenter = { x: Number.NaN, z: Number.NaN };
    }
  }

  setContourSettings({ intervalMeters = this.contourIntervalMeters, opacity = this.contourOpacity } = {}) {
    this.contourIntervalMeters = Math.max(5, Number(intervalMeters) || 20);
    this.contourOpacity = clamp(opacity, 0, 0.85);
    if (this.contourUniforms) {
      this.contourUniforms.uContourIntervalMeters.value = this.contourIntervalMeters;
      this.contourUniforms.uContourOpacity.value = this.contourOpacity;
    }
  }

  configure({ radius = this.radius, segments = this.segments } = {}) {
    const nextRadius = clamp(Math.round(radius), 1, 4);
    const nextSegments = clamp(Math.round(segments), 8, 32);
    const topologyChanged = nextSegments !== this.segments;
    this.radius = nextRadius;
    this.segments = nextSegments;
    const intervalMeters = nextSegments >= 24 ? 10 : nextSegments >= 18 ? 20 : nextSegments >= 14 ? 25 : 50;
    const opacity = nextSegments >= 18 ? 0.52 : nextSegments >= 14 ? 0.46 : 0.38;
    this.setContourSettings({ intervalMeters, opacity });
    if (topologyChanged) {
      this.clear();
      this.lastCenter = { x: Number.NaN, z: Number.NaN };
    }
  }

  _geomorphicOffsetAt(latitude, longitude) {
    const patch = this.geomorphologyPatch;
    if (!patch) return 0;
    const northKm = (Number(latitude) - Number(patch.networkLatitude)) * KM_PER_DEGREE_LATITUDE;
    const eastKm = wrapLongitudeDelta(Number(longitude) - Number(patch.networkLongitude))
      * KM_PER_DEGREE_LATITUDE
      * Math.max(0.12, Math.cos(Number(patch.networkLatitude) * Math.PI / 180));
    return (Number(patch.geomorphicElevationOffsetMeters) || 0)
      + eastKm * (Number(patch.geomorphicGradientEastMetersPerKm) || 0)
      + northKm * (Number(patch.geomorphicGradientNorthMetersPerKm) || 0);
  }

  _elevationAt(latitude, longitude) {
    const bedrock = bedrockElevationAt(latitude, longitude);
    if (!this.earthState) return bedrock + this._geomorphicOffsetAt(latitude, longitude);
    return bedrock
      + tectonicElevationOffsetMeters(this.earthState, latitude, longitude, this.branchSeed)
      + this._geomorphicOffsetAt(latitude, longitude);
  }

  _geographicAt(xKm, zKm) {
    const latitude = this.origin.latitude + zKm / KM_PER_DEGREE_LATITUDE;
    const longitudeScale = Math.max(12, KM_PER_DEGREE_LATITUDE * Math.cos(this.origin.latitude * Math.PI / 180));
    const longitude = this.origin.longitude + xKm / longitudeScale;
    return { latitude, longitude };
  }

  _channelIncisionMeters(xKm, zKm) {
    const patch = this.geomorphologyPatch;
    const angle = Number(patch?.channelBearingRadians);
    const discharge = Math.max(0, Number(patch?.meanDischargeM3s) || 0);
    const closestX = Number(patch?.channelClosestXKm);
    const closestZ = Number(patch?.channelClosestZKm);
    const channelDistance = Number(patch?.channelDistanceFromSelectionKm);
    if (!Number.isFinite(angle) || !Number.isFinite(closestX) || !Number.isFinite(closestZ) || !(discharge > 0.08)) return 0;
    const visibleReachKm = this.chunkSizeKm * (this.radius + 1.7);
    if (Number.isFinite(channelDistance) && channelDistance > visibleReachKm) return 0;

    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const relX = xKm - closestX;
    const relZ = zKm - closestZ;
    const alongKm = relX * dirX + relZ * dirZ;
    const perpendicularKm = -relX * dirZ + relZ * dirX;
    const bankfullWidthMeters = clamp(4 + Math.sqrt(discharge) * 2.6, 4, 90);
    const valleyHalfWidthKm = clamp(bankfullWidthMeters / 1000 * 2.4, 0.012, 0.22);
    const phase = (this.branchSeed % 997) * 0.017;
    const meanderAmplitudeKm = clamp(valleyHalfWidthKm * 0.7, 0.004, 0.055);
    const meanderKm = Math.sin(alongKm * 0.85 + phase) * meanderAmplitudeKm;
    const distanceKm = Math.abs(perpendicularKm - meanderKm);
    const erosionRate = Math.max(0, Number(patch.erosionRateMmPerYear) || 0);
    const incisionDepthMeters = clamp(1.2 + Math.log1p(discharge) * 1.35 + erosionRate * 160, 1.2, 28);
    const profile = Math.exp(-((distanceKm / valleyHalfWidthKm) ** 2));
    return incisionDepthMeters * profile;
  }

  _microreliefKm(xKm, zKm, elevationMeters) {
    if (elevationMeters < -80) return 0;
    const reliefMeters = Math.abs(elevationMeters - this.baseElevationMeters);
    const amplitudeMeters = clamp(4 + reliefMeters * 0.0045, 4, 16);
    const wave =
      Math.sin((xKm + this.origin.longitude * 0.013) * 23.7) * 0.52 +
      Math.cos((zKm + this.origin.latitude * 0.017) * 19.3) * 0.31 +
      Math.sin((xKm * 0.73 + zKm * 0.91) * 41.7) * 0.17;
    return wave * amplitudeMeters / 1000 * this.verticalScale;
  }

  heightAt(xKm, zKm) {
    if (!this.origin) return 0;
    const { latitude, longitude } = this._geographicAt(xKm, zKm);
    const elevationMeters = this._elevationAt(latitude, longitude);
    const channelIncisionMeters = this._channelIncisionMeters(xKm, zKm);
    return (elevationMeters - this.baseElevationMeters - channelIncisionMeters) / 1000 * this.verticalScale
      + this._microreliefKm(xKm, zKm, elevationMeters);
  }

  update(cameraPosition) {
    if (!this.origin) return;
    const centerX = Math.floor(cameraPosition.x / this.chunkSizeKm);
    const centerZ = Math.floor(cameraPosition.z / this.chunkSizeKm);
    if (centerX === this.lastCenter.x && centerZ === this.lastCenter.z && this.queue.length) return;
    this.lastCenter = { x: centerX, z: centerZ };
    const wanted = new Set();
    const candidates = [];
    for (let dz = -this.radius; dz <= this.radius; dz += 1) {
      for (let dx = -this.radius; dx <= this.radius; dx += 1) {
        const x = centerX + dx;
        const z = centerZ + dz;
        const key = chunkKey(x, z);
        wanted.add(key);
        if (!this.chunks.has(key) && !this.queuedKeys.has(key)) {
          candidates.push({ x, z, key, distance: dx * dx + dz * dz });
          this.queuedKeys.add(key);
        }
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    this.queue.push(...candidates);
    const evictionRadius = this.radius + 1;
    for (const [key, mesh] of this.chunks) {
      const [x, z] = key.split(":").map(Number);
      if (Math.abs(x - centerX) <= evictionRadius && Math.abs(z - centerZ) <= evictionRadius) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.chunks.delete(key);
    }
    this.queue = this.queue.filter((candidate) => wanted.has(candidate.key));
    this.queuedKeys = new Set(this.queue.map((candidate) => candidate.key));
  }

  pump(budgetMs = 2.5) {
    const started = performance.now();
    let created = 0;
    while (this.queue.length && performance.now() - started < budgetMs) {
      const next = this.queue.shift();
      this.queuedKeys.delete(next.key);
      if (this.chunks.has(next.key)) continue;
      const mesh = this._createChunk(next.x, next.z);
      this.chunks.set(next.key, mesh);
      this.scene.add(mesh);
      created += 1;
    }
    return created;
  }

  _createChunk(chunkX, chunkZ) {
    const segments = this.segments;
    const vertexSide = segments + 1;
    const positions = new Float32Array(vertexSide * vertexSide * 3);
    const colors = new Float32Array(vertexSide * vertexSide * 3);
    const elevations = new Float32Array(vertexSide * vertexSide);
    const indices = new Uint32Array(segments * segments * 6);
    const half = this.chunkSizeKm / 2;
    const centerX = chunkX * this.chunkSizeKm;
    const centerZ = chunkZ * this.chunkSizeKm;
    let vertexOffset = 0;
    for (let z = 0; z <= segments; z += 1) {
      const localZ = centerZ + (z / segments) * this.chunkSizeKm - half;
      for (let x = 0; x <= segments; x += 1) {
        const localX = centerX + (x / segments) * this.chunkSizeKm - half;
        const { latitude, longitude } = this._geographicAt(localX, localZ);
        const elevationMeters = this._elevationAt(latitude, longitude);
        const channelIncisionMeters = this._channelIncisionMeters(localX, localZ);
        const visualElevationMeters = elevationMeters - channelIncisionMeters;
        const microreliefKm = this._microreliefKm(localX, localZ, elevationMeters);
        const microreliefMeters = this.verticalScale > 0 ? microreliefKm / this.verticalScale * 1000 : 0;
        const displayedElevationMeters = visualElevationMeters + microreliefMeters;
        const y = (visualElevationMeters - this.baseElevationMeters) / 1000 * this.verticalScale + microreliefKm;
        positions[vertexOffset * 3] = localX;
        positions[vertexOffset * 3 + 1] = y;
        positions[vertexOffset * 3 + 2] = localZ;
        elevations[vertexOffset] = displayedElevationMeters;
        const [r, g, b] = terrainColor(latitude, displayedElevationMeters, displayedElevationMeters - this.baseElevationMeters, this.biomeProfile?.groundColor);
        colors[vertexOffset * 3] = r;
        colors[vertexOffset * 3 + 1] = g;
        colors[vertexOffset * 3 + 2] = b;
        vertexOffset += 1;
      }
    }
    let indexOffset = 0;
    for (let z = 0; z < segments; z += 1) {
      for (let x = 0; x < segments; x += 1) {
        const a = z * vertexSide + x;
        const b = a + 1;
        const c = a + vertexSide;
        const d = c + 1;
        indices[indexOffset++] = a; indices[indexOffset++] = c; indices[indexOffset++] = b;
        indices[indexOffset++] = b; indices[indexOffset++] = c; indices[indexOffset++] = d;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("elevationMeters", new THREE.BufferAttribute(elevations, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    mesh.userData.chunk = { x: chunkX, z: chunkZ };
    return mesh;
  }

  diagnostics() {
    const patch = this.geomorphologyPatch;
    return Object.freeze({
      loadedChunks: this.chunks.size,
      queuedChunks: this.queue.length,
      radius: this.radius,
      segments: this.segments,
      chunkSizeKm: this.chunkSizeKm,
      contourIntervalMeters: this.contourIntervalMeters,
      contourOpacity: this.contourOpacity,
      contourMajorEvery: 5,
      contoursFollowDisplayedTerrain: true,
      dynamicTopography: Boolean(this.earthState),
      geomorphologyProjected: Boolean(patch),
      geomorphicElevationOffsetMeters: patch?.geomorphicElevationOffsetMeters ?? null,
      geomorphicGradientEastMetersPerKm: patch?.geomorphicGradientEastMetersPerKm ?? null,
      geomorphicGradientNorthMetersPerKm: patch?.geomorphicGradientNorthMetersPerKm ?? null,
      routedChannelDistanceKm: patch?.channelDistanceFromSelectionKm ?? null,
      routedChannelDischargeM3s: patch?.meanDischargeM3s ?? null,
      subgridChannelPresentation: Boolean(patch && Number.isFinite(patch.channelBearingRadians) && Number(patch.meanDischargeM3s) > 0.08)
    });
  }

  clear() {
    for (const mesh of this.chunks.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.queue = [];
    this.queuedKeys.clear();
  }

  dispose() { this.clear(); this.material.dispose(); }
}
