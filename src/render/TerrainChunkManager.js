import * as THREE from "three";
import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";

const KM_PER_DEGREE_LATITUDE = 111.32;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;

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
    this.chunks = new Map();
    this.queue = [];
    this.queuedKeys = new Set();
    this.lastCenter = { x: Number.NaN, z: Number.NaN };
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.FrontSide });
  }

  setOrigin(latitude, longitude) {
    this.origin = { latitude: Number(latitude), longitude: Number(longitude) };
    this.baseElevationMeters = bedrockElevationAt(this.origin.latitude, this.origin.longitude);
    this.clear();
    this.lastCenter = { x: Number.NaN, z: Number.NaN };
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

  configure({ radius = this.radius, segments = this.segments } = {}) {
    const nextRadius = clamp(Math.round(radius), 1, 4);
    const nextSegments = clamp(Math.round(segments), 8, 32);
    const topologyChanged = nextSegments !== this.segments;
    this.radius = nextRadius;
    this.segments = nextSegments;
    if (topologyChanged) {
      this.clear();
      this.lastCenter = { x: Number.NaN, z: Number.NaN };
    }
  }

  _geographicAt(xKm, zKm) {
    const latitude = this.origin.latitude + zKm / KM_PER_DEGREE_LATITUDE;
    const longitudeScale = Math.max(12, KM_PER_DEGREE_LATITUDE * Math.cos(this.origin.latitude * Math.PI / 180));
    const longitude = this.origin.longitude + xKm / longitudeScale;
    return { latitude, longitude };
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
    const elevationMeters = bedrockElevationAt(latitude, longitude);
    return (elevationMeters - this.baseElevationMeters) / 1000 * this.verticalScale + this._microreliefKm(xKm, zKm, elevationMeters);
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
        const elevationMeters = bedrockElevationAt(latitude, longitude);
        const y = (elevationMeters - this.baseElevationMeters) / 1000 * this.verticalScale + this._microreliefKm(localX, localZ, elevationMeters);
        positions[vertexOffset * 3] = localX;
        positions[vertexOffset * 3 + 1] = y;
        positions[vertexOffset * 3 + 2] = localZ;
        const [r, g, b] = terrainColor(latitude, elevationMeters, elevationMeters - this.baseElevationMeters, this.biomeProfile?.groundColor);
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
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    mesh.userData.chunk = { x: chunkX, z: chunkZ };
    return mesh;
  }

  diagnostics() {
    return Object.freeze({ loadedChunks: this.chunks.size, queuedChunks: this.queue.length, radius: this.radius, segments: this.segments, chunkSizeKm: this.chunkSizeKm });
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
