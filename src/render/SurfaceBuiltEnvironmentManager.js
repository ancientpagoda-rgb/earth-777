import * as THREE from "three";
import { surfaceBiomeProfile } from "./SurfaceBiomeProfile.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

function createPool(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

export class SurfaceBuiltEnvironmentManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.quality = 1;
    this.signature = "";
    this.profile = surfaceBiomeProfile();
    this.waterLevelKm = -Infinity;
    this.tempMatrix = new THREE.Matrix4();
    this.tempPosition = new THREE.Vector3();
    this.tempQuaternion = new THREE.Quaternion();
    this.tempScale = new THREE.Vector3(1, 1, 1);

    this.materials = {
      defensiveWork: new THREE.MeshStandardMaterial({ color: 0x62513a, roughness: 1 }),
      watercraft: new THREE.MeshStandardMaterial({ color: 0x4e3523, roughness: 0.92 })
    };
    this.pools = {
      defensiveWork: createPool(new THREE.BoxGeometry(0.009, 0.0034, 0.0014), this.materials.defensiveWork, 1024),
      watercraft: createPool(new THREE.BoxGeometry(0.0065, 0.00075, 0.0016), this.materials.watercraft, 256)
    };
    this.counts = { defensiveWork: 0, watercraft: 0 };
    for (const mesh of Object.values(this.pools)) scene.add(mesh);
  }

  configure({ quality = this.quality } = {}) {
    const next = clamp(quality, 0.35, 1);
    if (Math.abs(next - this.quality) < 0.02) return false;
    this.quality = next;
    this._rebuild();
    return true;
  }

  setContext({ latitude, longitude, state, vegetationSample = null, riverSample = null }) {
    const profile = surfaceBiomeProfile(vegetationSample, state, latitude, longitude);
    const lakeSurface = Number(riverSample?.lakeSurfaceElevationMeters);
    const lakeCoverage = Number(riverSample?.lakeCoverageFraction) || 0;
    const waterElevationMeters = Number.isFinite(lakeSurface) && lakeCoverage > 0.005
      ? lakeSurface
      : Number(state?.seaLevel);
    const signature = [
      Number(latitude).toFixed(3),
      Number(longitude).toFixed(3),
      profile.homininSocialSiteId ?? "none",
      Number(profile.homininSocialSiteDistanceKm ?? -1).toFixed(2),
      Number(profile.homininDefensiveWorksIndex ?? 0).toFixed(3),
      Number(profile.homininDefensiveBarrierEquivalentMeters ?? 0).toFixed(2),
      Number(profile.homininWaterTransportIndex ?? 0).toFixed(3),
      Number(profile.homininWaterRouteCount ?? 0),
      Math.round(Number(profile.homininSocialSitePopulationPersons) || 0),
      Number(waterElevationMeters).toFixed(1)
    ].join("|");
    if (signature === this.signature) return false;
    this.signature = signature;
    this.profile = profile;
    this.waterLevelKm = (waterElevationMeters - this.terrain.baseElevationMeters) / 1000 * this.terrain.verticalScale;
    this._rebuild();
    return true;
  }

  _reset() {
    for (const key of Object.keys(this.counts)) {
      this.counts[key] = 0;
      this.pools[key].count = 0;
    }
  }

  _setGroundInstance(poolName, x, z, scaleX = 1, scaleY = 1, scaleZ = 1, yaw = 0) {
    const mesh = this.pools[poolName];
    const index = this.counts[poolName];
    if (index >= mesh.instanceMatrix.count) return false;
    const y = this.terrain.heightAt(x, z);
    if (!Number.isFinite(y) || y <= this.waterLevelKm + 0.00025) return false;
    this.tempPosition.set(x, y + 0.0017 * scaleY, z);
    this.tempQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.tempScale.set(scaleX, scaleY, scaleZ);
    this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
    mesh.setMatrixAt(index, this.tempMatrix);
    this.counts[poolName] = index + 1;
    mesh.count = index + 1;
    return true;
  }

  _setWaterInstance(x, z, scale = 1, yaw = 0) {
    const mesh = this.pools.watercraft;
    const index = this.counts.watercraft;
    if (index >= mesh.instanceMatrix.count || !Number.isFinite(this.waterLevelKm)) return false;
    this.tempPosition.set(x, this.waterLevelKm + 0.00042, z);
    this.tempQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.tempScale.set(scale, 1, scale);
    this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
    mesh.setMatrixAt(index, this.tempMatrix);
    this.counts.watercraft = index + 1;
    mesh.count = index + 1;
    return true;
  }

  _nearestVisibleWater(siteX, siteZ) {
    if (!Number.isFinite(this.waterLevelKm)) return null;
    for (const radiusKm of [0.035, 0.07, 0.14, 0.28, 0.55]) {
      for (let index = 0; index < 24; index += 1) {
        const angle = index / 24 * TAU;
        const x = siteX + Math.cos(angle) * radiusKm;
        const z = siteZ + Math.sin(angle) * radiusKm;
        const ground = this.terrain.heightAt(x, z);
        if (Number.isFinite(ground) && ground <= this.waterLevelKm + 0.0003) return { x, z, angle };
      }
    }
    return null;
  }

  _rebuild() {
    this._reset();
    const p = this.profile;
    const siteX = Number(p.homininSocialSiteOffsetEastKm);
    const siteZ = -Number(p.homininSocialSiteOffsetNorthKm);
    const distance = Number(p.homininSocialSiteDistanceKm);
    if (!Number.isFinite(siteX) || !Number.isFinite(siteZ) || !Number.isFinite(distance)) return;
    const visibleReachKm = this.terrain.chunkSizeKm * (this.terrain.radius + 1.5);
    if (distance > visibleReachKm) return;

    const population = Math.max(1, Number(p.homininSocialSitePopulationPersons) || 1);
    const works = clamp(p.homininDefensiveWorksIndex, 0, 1);
    const barrierMeters = Math.max(0, Number(p.homininDefensiveBarrierEquivalentMeters) || 0);
    if (works > 0.025) {
      const perimeterRadiusKm = 0.025 + Math.sqrt(population) * (0.00042 + works * 0.00024);
      const circumferenceKm = TAU * perimeterRadiusKm;
      const representedSegmentKm = 0.018 / (0.55 + this.quality * 0.45);
      const segments = Math.max(8, Math.round(circumferenceKm / representedSegmentKm * Math.sqrt(works)));
      const verticalScale = clamp(0.35 + barrierMeters / 3.2, 0.35, 3.5);
      for (let index = 0; index < segments; index += 1) {
        const angle = index / segments * TAU;
        const x = siteX + Math.cos(angle) * perimeterRadiusKm;
        const z = siteZ + Math.sin(angle) * perimeterRadiusKm;
        this._setGroundInstance("defensiveWork", x, z, 0.85 + works * 0.45, verticalScale, 1, angle + Math.PI / 2);
      }
    }

    const waterTransport = clamp(p.homininWaterTransportIndex, 0, 1);
    const routeCount = Math.max(0, Number(p.homininWaterRouteCount) || 0);
    if (waterTransport > 0.04 && routeCount > 0) {
      const water = this._nearestVisibleWater(siteX, siteZ);
      if (water) {
        const representedCraft = Math.max(1, Math.round(
          Math.sqrt(population) * waterTransport * (0.16 + Math.log1p(routeCount) * 0.18) * this.quality
        ));
        for (let index = 0; index < representedCraft; index += 1) {
          const along = (index - (representedCraft - 1) / 2) * 0.009;
          const tangentX = -Math.sin(water.angle);
          const tangentZ = Math.cos(water.angle);
          const x = water.x + tangentX * along;
          const z = water.z + tangentZ * along;
          this._setWaterInstance(x, z, 0.78 + waterTransport * 0.65, water.angle + Math.PI / 2);
        }
      }
    }

    for (const mesh of Object.values(this.pools)) mesh.instanceMatrix.needsUpdate = true;
  }

  diagnostics() {
    return Object.freeze({
      defensiveWorkSegments: this.counts.defensiveWork,
      watercraftRepresentations: this.counts.watercraft,
      defensiveWorksIndex: this.profile.homininDefensiveWorksIndex ?? 0,
      defensiveBarrierEquivalentMeters: this.profile.homininDefensiveBarrierEquivalentMeters ?? 0,
      waterTransportIndex: this.profile.homininWaterTransportIndex ?? 0,
      waterRouteCount: this.profile.homininWaterRouteCount ?? 0,
      siteId: this.profile.homininSocialSiteId ?? null,
      representationPolicy: "adaptive visual LOD from modeled site state; representation counts are not scientific population, structure, or vessel caps"
    });
  }

  clear() {
    this.signature = "";
    this._reset();
  }

  dispose() {
    this.clear();
    for (const mesh of Object.values(this.pools)) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
