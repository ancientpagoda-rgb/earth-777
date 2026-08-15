import * as THREE from "three";
import {
  FAUNA_EPISTEMIC_STATUS,
  FAUNA_HIERARCHY_POLICY,
  buildObservedFaunaPlan,
  faunaFieldsForCells,
  faunaLocalSummariesForCells
} from "../sim/FaunaPopulationHierarchy.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

class PagedInstancePool {
  constructor(scene, geometry, material, pageSize = 512) {
    this.scene = scene;
    this.geometry = geometry;
    this.material = material;
    this.pageSize = Math.max(16, Math.floor(pageSize));
    this.pages = [];
    this.count = 0;
  }

  _page(index) {
    while (this.pages.length <= index) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.pageSize);
      mesh.count = 0;
      mesh.frustumCulled = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.pages.push(mesh);
      this.scene.add(mesh);
    }
    return this.pages[index];
  }

  clear() {
    this.count = 0;
    for (const page of this.pages) page.count = 0;
  }

  setMatrix(index, matrix) {
    const pageIndex = Math.floor(index / this.pageSize);
    const localIndex = index % this.pageSize;
    const page = this._page(pageIndex);
    page.setMatrixAt(localIndex, matrix);
    page.count = Math.max(page.count, localIndex + 1);
    page.instanceMatrix.needsUpdate = true;
    this.count = Math.max(this.count, index + 1);
  }

  diagnostics() {
    return Object.freeze({ count: this.count, pages: this.pages.length, pageSize: this.pageSize });
  }

  dispose() {
    for (const page of this.pages) this.scene.remove(page);
    this.pages = [];
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class SurfaceFaunaManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.context = null;
    this.contextSignature = "";
    this.cameraPosition = { x: 0, z: 0 };
    this.lastCameraSignature = "";
    this.regionalDirty = true;
    this.localDirty = true;
    this.observedDirty = true;
    this.regionalFields = Object.freeze([]);
    this.localSummaries = Object.freeze([]);
    this.observedPlan = null;
    this.renderQueue = [];
    this.renderCursor = 0;
    this.windowRadiusKm = 3.5;
    this.individualRadiusKm = 0.55;

    this.herdPool = new PagedInstancePool(
      scene,
      new THREE.SphereGeometry(0.0042, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0x62503a, roughness: 1, transparent: true, opacity: 0.72 }),
      256
    );
    this.individualPool = new PagedInstancePool(
      scene,
      new THREE.SphereGeometry(0.0012, 5, 3),
      new THREE.MeshStandardMaterial({ color: 0x4b3c2d, roughness: 1 }),
      512
    );

    this.tempMatrix = new THREE.Matrix4();
    this.tempPosition = new THREE.Vector3();
    this.tempQuaternion = new THREE.Quaternion();
    this.tempScale = new THREE.Vector3(1, 1, 1);
  }

  setContext({ latitude, longitude, state, vegetationSample = null, hydrologySample = null } = {}) {
    const signature = [
      Number(latitude).toFixed(4),
      Number(longitude).toFixed(4),
      Math.round((Number(state?.yearBP) || 0) / 250),
      Number(state?.herbivoreBiomass ?? 0).toFixed(3),
      Number(state?.carnivoreBiomass ?? 0).toFixed(3),
      vegetationSample?.biomeCode ?? "x",
      Math.round(Number(vegetationSample?.npp) || 0),
      Math.round(Number(hydrologySample?.surfaceRunoffMmPerYear ?? hydrologySample?.runoffPotentialMmPerYear) || 0)
    ].join("|");
    if (signature === this.contextSignature) return false;
    this.contextSignature = signature;
    this.context = { latitude: Number(latitude) || 0, longitude: Number(longitude) || 0, state, vegetationSample, hydrologySample };
    this.regionalDirty = true;
    this.localDirty = true;
    this.observedDirty = true;
    return true;
  }

  configure({ windowRadiusKm = this.windowRadiusKm, individualRadiusKm = this.individualRadiusKm } = {}) {
    const nextWindow = clamp(windowRadiusKm, 0.5, 12);
    const nextIndividual = clamp(individualRadiusKm, 0.08, nextWindow);
    if (Math.abs(nextWindow - this.windowRadiusKm) < 1e-6 && Math.abs(nextIndividual - this.individualRadiusKm) < 1e-6) return false;
    this.windowRadiusKm = nextWindow;
    this.individualRadiusKm = nextIndividual;
    this.observedDirty = true;
    return true;
  }

  updateCamera(cameraPosition) {
    if (!cameraPosition) return false;
    const x = Number(cameraPosition.x) || 0;
    const z = Number(cameraPosition.z) || 0;
    const signature = `${Math.round(x * 5)}:${Math.round(z * 5)}`;
    this.cameraPosition = { x, z };
    if (signature === this.lastCameraSignature) return false;
    this.lastCameraSignature = signature;
    this.observedDirty = true;
    return true;
  }

  hasRegionalWork() { return Boolean(this.context && this.regionalDirty); }
  hasLocalWork() { return Boolean(this.context && this.localDirty); }
  hasObservedWork() { return Boolean(this.context && (this.observedDirty || this.renderCursor < this.renderQueue.length)); }

  refreshRegional(cells) {
    if (!this.context) return 0;
    this.regionalFields = faunaFieldsForCells(cells, this.context);
    this.regionalDirty = false;
    return this.regionalFields.length;
  }

  refreshLocal(cells) {
    if (!this.context) return 0;
    this.localSummaries = faunaLocalSummariesForCells(cells, this.context);
    this.localDirty = false;
    return this.localSummaries.length;
  }

  _prepareObserved() {
    if (!this.context) return;
    const focus = this.terrain._geographicAt?.(this.cameraPosition.x, this.cameraPosition.z)
      ?? { latitude: this.context.latitude, longitude: this.context.longitude };
    this.observedPlan = buildObservedFaunaPlan({
      ...this.context,
      latitude: focus.latitude,
      longitude: focus.longitude,
      seed: this.context.state?.seed ?? this.terrain.branchSeed ?? 777001,
      focusXKm: this.cameraPosition.x,
      focusZKm: this.cameraPosition.z,
      windowRadiusKm: this.windowRadiusKm,
      individualRadiusKm: this.individualRadiusKm
    });
    this.herdPool.clear();
    this.individualPool.clear();
    this.renderQueue = [];
    for (const herd of this.observedPlan.herds) {
      if (herd.representation === "herd") this.renderQueue.push({ type: "herd", value: herd });
    }
    for (const individual of this.observedPlan.individuals) this.renderQueue.push({ type: "individual", value: individual });
    this.renderCursor = 0;
    this.observedDirty = false;
  }

  _setTransform(pool, index, x, z, scaleX, scaleY, scaleZ, yaw = 0) {
    const y = this.terrain.heightAt(x, z);
    const waterLevelKm = Number(this.terrain.surfaceEcology?.waterLevelKm);
    if (Number.isFinite(waterLevelKm) && y <= waterLevelKm + 0.0003) return false;
    this.tempPosition.set(x, y, z);
    this.tempQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    this.tempScale.set(scaleX, scaleY, scaleZ);
    this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
    pool.setMatrix(index, this.tempMatrix);
    return true;
  }

  pumpObserved(sliceMs = 0.75) {
    if (!this.context) return 0;
    if (this.observedDirty) this._prepareObserved();
    const started = performance.now();
    let workUnits = 0;
    let herdIndex = this.herdPool.count;
    let individualIndex = this.individualPool.count;
    while (this.renderCursor < this.renderQueue.length && performance.now() - started < Math.max(0.05, sliceMs)) {
      const item = this.renderQueue[this.renderCursor++];
      if (item.type === "herd") {
        const herd = item.value;
        const scale = clamp(0.8 + Math.log1p(herd.population) * 0.36, 0.8, 2.8);
        if (this._setTransform(this.herdPool, herdIndex, herd.x, herd.z, scale * 2.3, scale * 0.72, scale, 0)) herdIndex += 1;
      } else {
        const animal = item.value;
        if (this._setTransform(this.individualPool, individualIndex, animal.x, animal.z, animal.scale * 1.8, animal.scale, animal.scale * 0.8, animal.yaw)) individualIndex += 1;
      }
      workUnits += 1;
    }
    return workUnits;
  }

  diagnostics() {
    const regionalPopulation = this.regionalFields.reduce((sum, field) => sum + field.herbivorePopulation, 0);
    const regionalCarnivores = this.regionalFields.reduce((sum, field) => sum + field.carnivorePopulation, 0);
    const localEstimatedHerds = this.localSummaries.reduce((sum, cell) => sum + cell.estimatedHerds, 0);
    return Object.freeze({
      policy: FAUNA_HIERARCHY_POLICY,
      epistemicStatus: FAUNA_EPISTEMIC_STATUS,
      regionalCells: this.regionalFields.length,
      regionalPopulation,
      regionalCarnivores,
      localCells: this.localSummaries.length,
      localEstimatedHerds,
      observedVisiblePopulation: this.observedPlan?.visiblePopulation ?? 0,
      observedHerds: this.observedPlan?.herds?.length ?? 0,
      materializedIndividuals: this.observedPlan?.materializedPopulation ?? 0,
      aggregateOnlyPopulation: this.observedPlan?.aggregateOnlyPopulation ?? 0,
      renderQueueRemaining: Math.max(0, this.renderQueue.length - this.renderCursor),
      herdInstances: this.herdPool.diagnostics(),
      individualInstances: this.individualPool.diagnostics(),
      windowRadiusKm: this.windowRadiusKm,
      individualRadiusKm: this.individualRadiusKm
    });
  }

  clear() {
    this.regionalFields = Object.freeze([]);
    this.localSummaries = Object.freeze([]);
    this.observedPlan = null;
    this.renderQueue = [];
    this.renderCursor = 0;
    this.regionalDirty = true;
    this.localDirty = true;
    this.observedDirty = true;
    this.herdPool.clear();
    this.individualPool.clear();
  }

  dispose() {
    this.clear();
    this.herdPool.dispose();
    this.individualPool.dispose();
    this.context = null;
  }
}
