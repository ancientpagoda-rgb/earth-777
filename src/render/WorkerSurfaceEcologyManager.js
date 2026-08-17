import * as THREE from "three";
import { SurfaceEcologyManager } from "./SurfaceEcologyManager.js";

export class WorkerSurfaceEcologyManager extends SurfaceEcologyManager {
  constructor(scene, terrain, computeClient) {
    super(scene, terrain);
    this.computeClient = computeClient;
    this.computeGeneration = 0;
    this.computeInFlight = 0;
    this.computeCompleted = [];
    this.maxComputeInFlight = 2;
  }

  invalidateComputeContext() {
    this.computeGeneration += 1;
    this.computeCompleted = [];
    this.dirty = true;
  }

  setContext(context) {
    const changed = super.setContext(context);
    if (changed) this.invalidateComputeContext();
    return changed;
  }

  configure(options = {}) {
    const beforeQuality = this.quality;
    const beforeRadius = this.radius;
    super.configure(options);
    const changed = beforeQuality !== this.quality || beforeRadius !== this.radius;
    if (changed) this.invalidateComputeContext();
    return changed;
  }

  update(cameraPosition) {
    const changed = super.update(cameraPosition);
    if (changed) {
      this.computeGeneration += 1;
      this.computeCompleted = [];
    }
    return changed;
  }

  _applyPlan(pools) {
    let work = 0;
    for (const [name, values] of Object.entries(pools ?? {})) {
      const mesh = this.pools[name];
      if (!mesh || !values) continue;
      for (let offset = 0; offset + 6 < values.length; offset += 7) {
        const index = this.counts[name];
        if (index >= mesh.instanceMatrix.count) break;
        this.tempPosition.set(values[offset], values[offset + 1], values[offset + 2]);
        this.tempQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, values[offset + 6]);
        this.tempScale.set(values[offset + 3], values[offset + 4], values[offset + 5]);
        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
        mesh.setMatrixAt(index, this.tempMatrix);
        this.counts[name] = index + 1;
        mesh.count = index + 1;
        work += 1;
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    return work;
  }

  pump(budgetMs = 1.5) {
    if (!this.computeClient?.worker) return super.pump(budgetMs);
    const started = performance.now();
    let work = 0;

    while (this.computeCompleted.length && performance.now() - started < budgetMs) {
      const next = this.computeCompleted.shift();
      work += this._applyPlan(next.pools);
    }

    while (this.queue.length && this.computeInFlight < this.maxComputeInFlight) {
      const chunk = this.queue.shift();
      const generation = this.computeGeneration;
      this.computeInFlight += 1;
      this.computeClient.ecology({
        chunkX: chunk.x,
        chunkZ: chunk.z,
        profile: this.profile,
        quality: this.quality,
        waterLevelKm: this.waterLevelKm
      }).then((result) => {
        if (result && generation === this.computeGeneration) this.computeCompleted.push(result);
      }).catch((error) => {
        console.warn("Surface ecology worker task failed; retaining current vegetation presentation.", error);
      }).finally(() => {
        this.computeInFlight = Math.max(0, this.computeInFlight - 1);
        this.terrain?.onSurfaceComputeReady?.();
      });
    }
    return work;
  }

  hasWork() {
    return this.queue.length > 0 || this.computeInFlight > 0 || this.computeCompleted.length > 0;
  }

  diagnostics() {
    return Object.freeze({
      ...super.diagnostics(),
      queuedChunks: this.queue.length + this.computeInFlight + this.computeCompleted.length,
      computeInFlight: this.computeInFlight,
      computeCompleted: this.computeCompleted.length,
      computePolicy: this.computeClient?.worker ? "worker-transfer-v1" : "main-thread-fallback"
    });
  }

  clear() {
    super.clear();
    this.computeGeneration += 1;
    this.computeCompleted = [];
  }
}
