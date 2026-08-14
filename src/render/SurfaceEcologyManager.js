import * as THREE from "three";
import { surfaceBiomeProfile } from "./SurfaceBiomeProfile.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const TAU = Math.PI * 2;

function fract(value) { return value - Math.floor(value); }
function random01(seed) { return fract(Math.sin(seed * 12.9898 + 78.233) * 43758.5453123); }
function seedFor(latitude, longitude, x, z, salt = 0) {
  return (latitude + 90) * 197.3 + (longitude + 180) * 389.7 + x * 911.1 + z * 617.3 + salt * 131.9;
}

function translated(geometry, y) {
  geometry.translate(0, y, 0);
  return geometry;
}

function createPool(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function riverRibbon(points, widthKm) {
  if (points.length < 2) return null;
  const positions = new Float32Array(points.length * 2 * 3);
  const indices = new Uint32Array((points.length - 1) * 6);
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const dx = after.x - before.x;
    const dz = after.z - before.z;
    const length = Math.hypot(dx, dz) || 1;
    const ox = -dz / length * widthKm;
    const oz = dx / length * widthKm;
    const base = i * 6;
    positions[base] = current.x + ox;
    positions[base + 1] = current.y + 0.00035;
    positions[base + 2] = current.z + oz;
    positions[base + 3] = current.x - ox;
    positions[base + 4] = current.y + 0.00035;
    positions[base + 5] = current.z - oz;
  }
  let offset = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices[offset++] = a; indices[offset++] = c; indices[offset++] = b;
    indices[offset++] = b; indices[offset++] = c; indices[offset++] = d;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

export class SurfaceEcologyManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.origin = null;
    this.profile = surfaceBiomeProfile();
    this.quality = 1;
    this.radius = 2;
    this.queue = [];
    this.lastCenter = { x: Number.NaN, z: Number.NaN };
    this.dirty = true;
    this.contextSignature = "";
    this.river = null;
    this.riverSample = null;
    this.hydrologySample = null;
    this.waterLevelKm = -Infinity;

    this.materials = {
      grass: new THREE.MeshStandardMaterial({ color: 0x6b7a3a, roughness: 1 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x4e3b25, roughness: 1 }),
      crown: new THREE.MeshStandardMaterial({ color: 0x365b32, roughness: 0.95 }),
      shrub: new THREE.MeshStandardMaterial({ color: 0x52663a, roughness: 1 }),
      rock: new THREE.MeshStandardMaterial({ color: 0x77756c, roughness: 1 }),
      animal: new THREE.MeshStandardMaterial({ color: 0x4b3c2d, roughness: 1 }),
      hominin: new THREE.MeshStandardMaterial({ color: 0x5c4737, roughness: 1 }),
      river: new THREE.MeshPhongMaterial({ color: 0x365f6d, transparent: true, opacity: 0.82, shininess: 95, depthWrite: false })
    };

    this.pools = {
      grass: createPool(translated(new THREE.ConeGeometry(0.00045, 0.0018, 3), 0.0009), this.materials.grass, 12000),
      trunk: createPool(translated(new THREE.CylinderGeometry(0.00055, 0.00085, 0.0065, 5), 0.00325), this.materials.trunk, 2600),
      crown: createPool(translated(new THREE.ConeGeometry(0.0036, 0.011, 6), 0.0115), this.materials.crown, 2600),
      shrub: createPool(translated(new THREE.IcosahedronGeometry(0.0015, 0), 0.0015), this.materials.shrub, 3200),
      rock: createPool(translated(new THREE.DodecahedronGeometry(0.0012, 0), 0.0008), this.materials.rock, 2000),
      animal: createPool(translated(new THREE.SphereGeometry(0.0012, 5, 3), 0.0014), this.materials.animal, 640),
      hominin: createPool(translated(new THREE.CapsuleGeometry(0.00038, 0.00125, 2, 4), 0.00135), this.materials.hominin, 96)
    };
    for (const mesh of Object.values(this.pools)) scene.add(mesh);
    this.tempMatrix = new THREE.Matrix4();
    this.tempPosition = new THREE.Vector3();
    this.tempQuaternion = new THREE.Quaternion();
    this.tempScale = new THREE.Vector3(1, 1, 1);
    this.counts = Object.fromEntries(Object.keys(this.pools).map((key) => [key, 0]));
  }

  setContext({ latitude, longitude, state, vegetationSample = null, hydrologySample = null, riverSample = null }) {
    const signature = [latitude.toFixed(3), longitude.toFixed(3), Math.round((state?.yearBP ?? 0) / 2500), vegetationSample?.biomeCode ?? "x"].join("|");
    if (signature === this.contextSignature) return false;
    this.contextSignature = signature;
    this.origin = { latitude, longitude };
    this.profile = surfaceBiomeProfile(vegetationSample, state, latitude, longitude);
    this.hydrologySample = hydrologySample;
    this.riverSample = riverSample;
    this.waterLevelKm = (Number(state?.seaLevel) - this.terrain.baseElevationMeters) / 1000 * this.terrain.verticalScale;
    this.terrain.setBiomeProfile?.(this.profile);
    if (this.profile.biomeCode === 21) {
      this.materials.grass.color.setHex(0x8a7945);
      this.materials.crown.color.setHex(0x687044);
      this.materials.shrub.color.setHex(0x756b43);
    } else if (this.profile.biomeCode === 28) {
      this.materials.grass.color.setHex(0x9aa49a);
      this.materials.crown.color.setHex(0x7e8a80);
      this.materials.shrub.color.setHex(0x879184);
    } else if (this.profile.biomeCode >= 22 && this.profile.biomeCode <= 27) {
      this.materials.grass.color.setHex(0x73805a);
      this.materials.crown.color.setHex(0x52654d);
      this.materials.shrub.color.setHex(0x667259);
    } else {
      this.materials.grass.color.setHex(0x6b7a3a);
      this.materials.crown.color.setHex(0x365b32);
      this.materials.shrub.color.setHex(0x52663a);
    }
    this._rebuildRiver();
    this.dirty = true;
    return true;
  }

  configure({ quality = this.quality, radius = this.radius } = {}) {
    const nextQuality = clamp(quality, 0.35, 1);
    const nextRadius = clamp(Math.round(radius), 1, 3);
    if (Math.abs(nextQuality - this.quality) > 0.02 || nextRadius !== this.radius) {
      this.quality = nextQuality;
      this.radius = nextRadius;
      this.dirty = true;
    }
  }

  _rebuildRiver() {
    if (this.river) {
      this.scene.remove(this.river);
      this.river.geometry.dispose();
      this.river = null;
    }
    const discharge = Number(this.riverSample?.meanDischargeM3s);
    const runoff = Number(this.hydrologySample?.surfaceRunoffMmPerYear ?? this.hydrologySample?.runoffPotentialMmPerYear);
    if (!(discharge > 0.08 || runoff > 220)) return;

    const directionSeed = seedFor(this.origin.latitude, this.origin.longitude, 0, 0, 77);
    let angle = random01(directionSeed) * TAU;
    let x = Math.cos(angle + Math.PI) * 1.1;
    let z = Math.sin(angle + Math.PI) * 1.1;
    const step = 0.075;
    const points = [];
    for (let i = 0; i < 42; i += 1) {
      const y = this.terrain.heightAt(x, z);
      points.push(new THREE.Vector3(x, y, z));
      let best = null;
      for (let candidate = -2; candidate <= 2; candidate += 1) {
        const candidateAngle = angle + candidate * 0.28;
        const nx = x + Math.cos(candidateAngle) * step;
        const nz = z + Math.sin(candidateAngle) * step;
        const nh = this.terrain.heightAt(nx, nz);
        const score = nh + Math.abs(candidate) * 0.00028;
        if (!best || score < best.score) best = { x: nx, z: nz, height: nh, angle: candidateAngle, score };
      }
      if (!best) break;
      x = best.x; z = best.z; angle = best.angle;
    }
    const widthMeters = clamp(2 + Math.log1p(Math.max(0, discharge || runoff / 80)) * 2.4, 2, 18);
    const geometry = riverRibbon(points, widthMeters / 2000);
    if (!geometry) return;
    this.river = new THREE.Mesh(geometry, this.materials.river);
    this.river.renderOrder = 2;
    this.scene.add(this.river);
  }

  update(cameraPosition) {
    if (!this.origin) return false;
    const chunkSize = this.terrain.chunkSizeKm;
    const centerX = Math.floor(cameraPosition.x / chunkSize);
    const centerZ = Math.floor(cameraPosition.z / chunkSize);
    if (!this.dirty && centerX === this.lastCenter.x && centerZ === this.lastCenter.z) return false;
    this.lastCenter = { x: centerX, z: centerZ };
    this.dirty = false;
    this.queue = [];
    for (let dz = -this.radius; dz <= this.radius; dz += 1) {
      for (let dx = -this.radius; dx <= this.radius; dx += 1) {
        this.queue.push({ x: centerX + dx, z: centerZ + dz, distance: dx * dx + dz * dz });
      }
    }
    this.queue.sort((a, b) => a.distance - b.distance);
    for (const key of Object.keys(this.counts)) {
      this.counts[key] = 0;
      this.pools[key].count = 0;
    }
    return true;
  }

  pump(budgetMs = 1.5) {
    const started = performance.now();
    let chunks = 0;
    while (this.queue.length && performance.now() - started < budgetMs) {
      const chunk = this.queue.shift();
      this._populateChunk(chunk.x, chunk.z);
      chunks += 1;
    }
    if (chunks) {
      for (const mesh of Object.values(this.pools)) mesh.instanceMatrix.needsUpdate = true;
    }
    return chunks;
  }

  _setInstance(poolName, x, z, scaleX = 1, scaleY = scaleX, scaleZ = scaleX, yaw = 0) {
    const mesh = this.pools[poolName];
    const index = this.counts[poolName];
    if (index >= mesh.instanceMatrix.count) return false;
    const y = this.terrain.heightAt(x, z);
    if (y <= this.waterLevelKm + 0.0003) return false;
    this.tempPosition.set(x, y, z);
    this.tempQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.tempScale.set(scaleX, scaleY, scaleZ);
    this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
    mesh.setMatrixAt(index, this.tempMatrix);
    this.counts[poolName] = index + 1;
    mesh.count = index + 1;
    return true;
  }

  _populateChunk(chunkX, chunkZ) {
    const size = this.terrain.chunkSizeKm;
    const half = size / 2;
    const centerX = chunkX * size;
    const centerZ = chunkZ * size;
    const seed = seedFor(this.origin.latitude, this.origin.longitude, chunkX, chunkZ);
    const quality = this.quality;
    const p = this.profile;

    const scatter = (name, count, baseScale, salt, density = 1) => {
      const wanted = Math.round(count * quality * density);
      for (let i = 0; i < wanted; i += 1) {
        const x = centerX + (random01(seed + salt + i * 17.1) * 2 - 1) * half;
        const z = centerZ + (random01(seed + salt + i * 29.7 + 3) * 2 - 1) * half;
        const scale = baseScale * (0.68 + random01(seed + salt + i * 7.7 + 11) * 0.75);
        this._setInstance(name, x, z, scale, scale * (0.78 + random01(seed + i) * 0.6), scale, random01(seed + i * 13.9) * TAU);
      }
    };

    scatter("grass", 120, 1.0, 100, p.grassDensity);
    const treeCount = Math.round(26 * p.treeDensity * quality);
    for (let i = 0; i < treeCount; i += 1) {
      const x = centerX + (random01(seed + 220 + i * 19.3) * 2 - 1) * half;
      const z = centerZ + (random01(seed + 240 + i * 23.1) * 2 - 1) * half;
      const scale = 0.72 + random01(seed + 260 + i * 11.3) * 1.25;
      this._setInstance("trunk", x, z, scale, scale, scale, random01(seed + i * 3.1) * TAU);
      this._setInstance("crown", x, z, scale, scale, scale, random01(seed + i * 3.1) * TAU);
    }
    scatter("shrub", 38, 1.0, 330, p.shrubDensity);
    scatter("rock", 18, 0.8, 440, p.rockDensity);

    const herdChance = 0.16 + p.herbivoreDensity * 0.42;
    if (random01(seed + 550) < herdChance) {
      const herdSize = Math.round((4 + random01(seed + 551) * 9) * quality * p.herbivoreDensity);
      const hx = centerX + (random01(seed + 552) * 1.3 - 0.65);
      const hz = centerZ + (random01(seed + 553) * 1.3 - 0.65);
      for (let i = 0; i < herdSize; i += 1) {
        const x = hx + (random01(seed + 560 + i * 9.7) - 0.5) * 0.09;
        const z = hz + (random01(seed + 580 + i * 13.1) - 0.5) * 0.09;
        const sizeScale = 0.78 + random01(seed + 600 + i) * 0.65;
        this._setInstance("animal", x, z, sizeScale * 1.8, sizeScale, sizeScale * 0.8, random01(seed + 620 + i) * TAU);
      }
    }

    if (p.homininDensity > 0 && Math.abs(chunkX) <= 1 && Math.abs(chunkZ) <= 1 && random01(seed + 700) < 0.12 + p.homininDensity * 0.26) {
      const groupSize = Math.max(1, Math.round((1 + random01(seed + 701) * 4) * quality));
      const gx = centerX + (random01(seed + 702) - 0.5) * 0.8;
      const gz = centerZ + (random01(seed + 703) - 0.5) * 0.8;
      for (let i = 0; i < groupSize; i += 1) {
        this._setInstance("hominin", gx + (random01(seed + 710 + i) - 0.5) * 0.025, gz + (random01(seed + 720 + i) - 0.5) * 0.025, 1, 1, 1, random01(seed + 730 + i) * TAU);
      }
    }
  }

  diagnostics() {
    return Object.freeze({
      queuedChunks: this.queue.length,
      grass: this.counts.grass,
      trees: this.counts.crown,
      shrubs: this.counts.shrub,
      rocks: this.counts.rock,
      animals: this.counts.animal,
      hominins: this.counts.hominin,
      river: Boolean(this.river),
      biome: this.profile.biomeLabel ?? this.profile.biomeCode ?? "modeled"
    });
  }

  clear() {
    this.queue = [];
    this.dirty = true;
    for (const key of Object.keys(this.counts)) {
      this.counts[key] = 0;
      this.pools[key].count = 0;
    }
  }

  dispose() {
    this.clear();
    if (this.river) {
      this.scene.remove(this.river);
      this.river.geometry.dispose();
      this.river = null;
    }
    for (const mesh of Object.values(this.pools)) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
