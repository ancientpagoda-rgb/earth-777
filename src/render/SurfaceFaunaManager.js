import * as THREE from "three";
import { FAUNA_EPISTEMIC_STATUS, FAUNA_POLICY, buildObservedFauna, faunaForCells, faunaPopulationAt } from "../sim/FaunaRuntime.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

class PagedInstancePool {
  constructor(scene, geometry, material, pageSize) {
    this.scene = scene;
    this.geometry = geometry;
    this.material = material;
    this.pageSize = pageSize;
    this.pages = [];
    this.count = 0;
  }

  clear() {
    this.count = 0;
    for (const page of this.pages) page.count = 0;
  }

  setMatrix(index, matrix) {
    const pageIndex = Math.floor(index / this.pageSize);
    while (this.pages.length <= pageIndex) {
      const page = new THREE.InstancedMesh(this.geometry, this.material, this.pageSize);
      page.count = 0;
      page.frustumCulled = true;
      page.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.pages.push(page);
      this.scene.add(page);
    }
    const page = this.pages[pageIndex];
    const localIndex = index % this.pageSize;
    page.setMatrixAt(localIndex, matrix);
    page.count = Math.max(page.count, localIndex + 1);
    page.instanceMatrix.needsUpdate = true;
    this.count = Math.max(this.count, index + 1);
  }

  diagnostics() { return Object.freeze({ count: this.count, pages: this.pages.length, pageSize: this.pageSize }); }

  dispose() {
    for (const page of this.pages) this.scene.remove(page);
    this.pages = [];
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class SurfaceFaunaManager {
  constructor(scene, terrain) {
    this.terrain = terrain;
    this.context = null;
    this.contextSignature = "";
    this.camera = { x: 0, z: 0 };
    this.cameraSignature = "";
    this.windowRadiusKm = 3.5;
    this.individualRadiusKm = 0.55;
    this.dirty = true;
    this.observed = null;
    this.regionalFields = Object.freeze([]);
    this.localFields = Object.freeze([]);
    this.queue = [];
    this.cursor = 0;

    this.pools = {
      herd: new PagedInstancePool(scene, new THREE.SphereGeometry(0.0042, 6, 4), new THREE.MeshStandardMaterial({ color: 0x62503a, roughness: 1, transparent: true, opacity: 0.72 }), 256),
      pack: new PagedInstancePool(scene, new THREE.SphereGeometry(0.0034, 6, 4), new THREE.MeshStandardMaterial({ color: 0x493a34, roughness: 1, transparent: true, opacity: 0.76 }), 128),
      herbivore: new PagedInstancePool(scene, new THREE.SphereGeometry(0.0012, 5, 3), new THREE.MeshStandardMaterial({ color: 0x4b3c2d, roughness: 1 }), 512),
      carnivore: new PagedInstancePool(scene, new THREE.SphereGeometry(0.0010, 5, 3), new THREE.MeshStandardMaterial({ color: 0x342c29, roughness: 1 }), 256)
    };
    this.matrix = new THREE.Matrix4();
    this.position = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();
    this.scale = new THREE.Vector3();
  }

  setContext({ latitude, longitude, state, vegetationSample = null, hydrologySample = null } = {}) {
    const signature = [
      Number(latitude).toFixed(4),
      Number(longitude).toFixed(4),
      Math.floor((Number(state?.elapsedYears) || 0) * 12),
      Number(state?.herbivoreBiomass ?? 0).toFixed(3),
      Number(state?.carnivoreBiomass ?? 0).toFixed(3),
      vegetationSample?.biomeCode ?? "x",
      Math.round(Number(vegetationSample?.npp) || 0),
      Math.round(Number(hydrologySample?.surfaceRunoffMmPerYear ?? hydrologySample?.runoffPotentialMmPerYear) || 0)
    ].join("|");
    this.context = { latitude: Number(latitude) || 0, longitude: Number(longitude) || 0, state, vegetationSample, hydrologySample };
    if (signature === this.contextSignature) return false;
    this.contextSignature = signature;
    this.dirty = true;
    return true;
  }

  configure({ windowRadiusKm = this.windowRadiusKm, individualRadiusKm = this.individualRadiusKm } = {}) {
    const window = clamp(windowRadiusKm, 0.5, 12);
    const individual = clamp(individualRadiusKm, 0.08, window);
    if (window === this.windowRadiusKm && individual === this.individualRadiusKm) return false;
    this.windowRadiusKm = window;
    this.individualRadiusKm = individual;
    this.dirty = true;
    return true;
  }

  updateCamera(cameraPosition) {
    if (!cameraPosition) return false;
    this.camera = { x: Number(cameraPosition.x) || 0, z: Number(cameraPosition.z) || 0 };
    const signature = `${Math.round(this.camera.x * 5)}:${Math.round(this.camera.z * 5)}`;
    if (signature === this.cameraSignature) return false;
    this.cameraSignature = signature;
    this.dirty = true;
    return true;
  }

  hasWork() { return Boolean(this.context && (this.dirty || this.cursor < this.queue.length)); }

  _rebuild(cells = []) {
    if (!this.context) return;
    this.regionalFields = faunaForCells(cells.filter((cell) => cell.scope === "regional"), this.context);
    this.localFields = faunaForCells(cells.filter((cell) => cell.scope === "local"), this.context);
    const focus = this.terrain._geographicAt?.(this.camera.x, this.camera.z) ?? this.context;
    const faunaField = faunaPopulationAt({
      ...this.context,
      latitude: focus.latitude,
      longitude: focus.longitude,
      areaKm2: Math.PI * this.windowRadiusKm * this.windowRadiusKm,
      key: "observed-window"
    });
    this.observed = buildObservedFauna({
      ...this.context,
      latitude: focus.latitude,
      longitude: focus.longitude,
      seed: this.context.state?.seed ?? this.terrain.branchSeed ?? 777001,
      focusXKm: this.camera.x,
      focusZKm: this.camera.z,
      faunaField,
      windowRadiusKm: this.windowRadiusKm,
      individualRadiusKm: this.individualRadiusKm
    });

    for (const pool of Object.values(this.pools)) pool.clear();
    this.queue = [];
    for (const herd of this.observed.herds) if (herd.representation === "herd") this.queue.push({ type: "herd", value: herd });
    for (const pack of this.observed.packs) if (pack.representation === "pack") this.queue.push({ type: "pack", value: pack });
    for (const animal of this.observed.individuals) this.queue.push({ type: animal.role, value: animal });
    this.cursor = 0;
    this.dirty = false;
  }

  _place(pool, index, x, z, sx, sy, sz, yaw) {
    const y = this.terrain.heightAt(x, z);
    const water = Number(this.terrain.surfaceEcology?.waterLevelKm);
    if (Number.isFinite(water) && y <= water + 0.0003) return false;
    this.position.set(x, y, z);
    this.rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw || 0);
    this.scale.set(sx, sy, sz);
    this.matrix.compose(this.position, this.rotation, this.scale);
    pool.setMatrix(index, this.matrix);
    return true;
  }

  pump(sliceMs = 0.85, cells = []) {
    if (!this.context) return 0;
    if (this.dirty) this._rebuild(cells);
    const started = performance.now();
    const counts = Object.fromEntries(Object.entries(this.pools).map(([key, pool]) => [key, pool.count]));
    let work = 0;

    while (this.cursor < this.queue.length && performance.now() - started < Math.max(0.05, sliceMs)) {
      const item = this.queue[this.cursor++];
      const actor = item.value;
      if (item.type === "herd" || item.type === "pack") {
        const scale = clamp(0.8 + Math.log1p(actor.population) * 0.36, 0.8, 2.8);
        const isPack = item.type === "pack";
        if (this._place(this.pools[item.type], counts[item.type], actor.x, actor.z, scale * (isPack ? 1.6 : 2.3), scale * (isPack ? 0.62 : 0.72), scale, actor.heading)) counts[item.type] += 1;
      } else {
        const isCarnivore = item.type === "carnivore";
        if (this._place(this.pools[item.type], counts[item.type], actor.x, actor.z, actor.scale * (isCarnivore ? 1.55 : 1.8), actor.scale, actor.scale * 0.8, actor.yaw)) counts[item.type] += 1;
      }
      work += 1;
    }
    return work;
  }

  diagnostics() {
    return Object.freeze({
      policy: FAUNA_POLICY,
      epistemicStatus: FAUNA_EPISTEMIC_STATUS,
      regionalCells: this.regionalFields.length,
      regionalPopulation: this.regionalFields.reduce((sum, field) => sum + field.herbivorePopulation, 0),
      regionalCarnivores: this.regionalFields.reduce((sum, field) => sum + field.carnivorePopulation, 0),
      localCells: this.localFields.length,
      localEstimatedHerds: this.localFields.reduce((sum, field) => sum + field.estimatedHerds, 0),
      localEstimatedPacks: this.localFields.reduce((sum, field) => sum + field.estimatedPacks, 0),
      observedVisiblePopulation: this.observed?.visiblePopulation ?? 0,
      observedVisibleCarnivores: this.observed?.visibleCarnivorePopulation ?? 0,
      observedHerds: this.observed?.herds.length ?? 0,
      observedPacks: this.observed?.packs.length ?? 0,
      materializedIndividuals: this.observed?.totalMaterializedPopulation ?? 0,
      behaviorCounts: this.observed?.behaviorCounts ?? Object.freeze({}),
      queueRemaining: Math.max(0, this.queue.length - this.cursor),
      pools: Object.freeze(Object.fromEntries(Object.entries(this.pools).map(([key, pool]) => [key, pool.diagnostics()]))),
      windowRadiusKm: this.windowRadiusKm,
      individualRadiusKm: this.individualRadiusKm
    });
  }

  clear() {
    this.observed = null;
    this.regionalFields = Object.freeze([]);
    this.localFields = Object.freeze([]);
    this.queue = [];
    this.cursor = 0;
    this.dirty = true;
    for (const pool of Object.values(this.pools)) pool.clear();
  }

  dispose() {
    this.clear();
    for (const pool of Object.values(this.pools)) pool.dispose();
    this.context = null;
  }
}
