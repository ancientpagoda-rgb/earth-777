import * as THREE from "three";
import { loadRuntimeRegionalTerrainPatch } from "../reconstruction/RuntimeRegionalTerrainPatch.js";
import { SurfaceTerrainSystem } from "./SurfaceTerrainSystem.js";
import { SurfaceComputeClient } from "./SurfaceComputeClient.js";
import { WorkerSurfaceEcologyManager } from "./WorkerSurfaceEcologyManager.js";

function rounded(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "x";
}

export class WorkerSurfaceTerrainSystem extends SurfaceTerrainSystem {
  constructor(scene, options = {}) {
    super(scene, options);
    this.computeClient = new SurfaceComputeClient();
    this.surfaceEcology.dispose();
    this.surfaceEcology = new WorkerSurfaceEcologyManager(scene, this, this.computeClient);
    this.terrainGeneration = 0;
    this.terrainInFlight = 0;
    this.terrainInFlightKeys = new Set();
    this.terrainCompleted = [];
    this.maxTerrainInFlight = 3;
    this.computeContextSignature = "";
    this.regionalTerrainPatch = null;
    this.regionalTerrainPatchStatus = "idle";
    this.regionalTerrainPatchError = null;
    this.regionalTerrainRequestToken = 0;
  }

  _surfaceVisualDrivers() {
    const vegetation = this.lastSurfaceContext?.vegetationSample ?? null;
    const hydrology = this.lastSurfaceContext?.hydrologySample ?? this.surfaceEcology?.hydrologySample ?? null;
    const water = this.lastSurfaceContext?.riverSample ?? this.surfaceEcology?.riverSample ?? null;
    const profile = this.surfaceEcology?.profile ?? null;
    return {
      biomeCode: Number(vegetation?.biomeCode ?? profile?.biomeCode),
      lai: Number(vegetation?.lai),
      npp: Number(vegetation?.npp),
      runoffMmPerYear: Number(hydrology?.surfaceRunoffMmPerYear ?? hydrology?.runoffPotentialMmPerYear),
      treeDensity: Number(profile?.treeDensity),
      grassDensity: Number(profile?.grassDensity),
      shrubDensity: Number(profile?.shrubDensity),
      lakeSurfaceElevationMeters: Number(water?.lakeSurfaceElevationMeters),
      lakeCoverageFraction: Number(water?.lakeCoverageFraction),
      lakeAreaKm2: Number(water?.lakeAreaKm2),
      lakeCenterXKm: Number.isFinite(Number(water?.channelClosestXKm)) ? Number(water.channelClosestXKm) : 0,
      lakeCenterZKm: Number.isFinite(Number(water?.channelClosestZKm)) ? Number(water.channelClosestZKm) : 0,
      meanDischargeM3s: Number(water?.meanDischargeM3s)
    };
  }

  _contextSignature() {
    if (!this.origin) return "none";
    const drivers = this._surfaceVisualDrivers();
    const patch = this.regionalTerrainPatch;
    return [
      this.origin.latitude.toFixed(6),
      this.origin.longitude.toFixed(6),
      this.baseElevationMeters.toFixed(3),
      this.topographySignature,
      this.geomorphologySignature,
      this.chunkSizeKm,
      this.radius,
      this.segments,
      this.verticalScale,
      this.biomeProfile?.groundColor?.join(",") ?? "none",
      drivers.biomeCode || "x",
      rounded(drivers.lai),
      rounded(drivers.npp, 0),
      rounded(drivers.runoffMmPerYear, 0),
      rounded(drivers.treeDensity),
      rounded(drivers.lakeSurfaceElevationMeters, 1),
      rounded(drivers.lakeCoverageFraction, 3),
      rounded(drivers.lakeAreaKm2, 1),
      patch ? `${patch.sourceId}:${patch.west}:${patch.south}:${patch.ncols}:${patch.nrows}:${patch.resolutionMeters}` : "regional-patch:none"
    ].join("|");
  }

  _syncComputeContext(force = false) {
    if (!this.computeClient?.worker || !this.origin) return false;
    const signature = this._contextSignature();
    if (!force && signature === this.computeContextSignature) return false;
    this.computeContextSignature = signature;
    this.terrainGeneration += 1;
    this.terrainInFlightKeys.clear();
    this.terrainCompleted = [];
    this.computeClient.setContext({
      origin: { ...this.origin },
      baseElevationMeters: this.baseElevationMeters,
      earthState: this.earthState,
      branchSeed: this.branchSeed,
      geomorphologyPatch: this.geomorphologyPatch,
      regionalTerrainPatch: this.regionalTerrainPatch,
      chunkSizeKm: this.chunkSizeKm,
      radius: this.radius,
      segments: this.segments,
      verticalScale: this.verticalScale,
      biomeGroundColor: this.biomeProfile?.groundColor ?? null,
      surfaceVisualDrivers: this._surfaceVisualDrivers()
    });
    this.surfaceEcology.invalidateComputeContext();
    return true;
  }

  setOrigin(latitude, longitude) {
    super.setOrigin(latitude, longitude);
    this.regionalTerrainPatch = null;
    this.regionalTerrainPatchError = null;
    this.regionalTerrainPatchStatus = "loading";
    const token = ++this.regionalTerrainRequestToken;
    const origin = { latitude: this.origin.latitude, longitude: this.origin.longitude };

    // Progressive refinement: never block descent on a remote terrain request.
    // The compact ETOPO surface renders first; when the regional modern relief
    // patch arrives, workers rebuild the visible terrain using only its
    // high-frequency residual over the 777 ka reconstruction.
    loadRuntimeRegionalTerrainPatch(origin.latitude, origin.longitude)
      .then((patch) => {
        if (token !== this.regionalTerrainRequestToken || !this.origin) return;
        this.regionalTerrainPatch = patch;
        this.regionalTerrainPatchStatus = "ready";
        this.regionalTerrainPatchError = null;
        this.clear();
        this.lastCenter = { x: Number.NaN, z: Number.NaN };
        this._syncComputeContext(true);
      })
      .catch((error) => {
        if (token !== this.regionalTerrainRequestToken) return;
        this.regionalTerrainPatch = null;
        this.regionalTerrainPatchStatus = "fallback";
        this.regionalTerrainPatchError = error?.message ?? String(error);
        // A failed external refinement is intentionally non-fatal: the compact
        // global ETOPO reconstruction remains the complete offline fallback.
        console.info("Regional terrain refinement unavailable; retaining compact ETOPO fallback.", error);
      });
  }

  update(cameraPosition) {
    super.update(cameraPosition);
    // TerrainChunkManager tracks queued work in queuedKeys. A worker task is no
    // longer in the queue while it is computing, so preserve current-generation
    // in-flight keys to prevent the base updater from enqueueing duplicates.
    for (const key of this.terrainInFlightKeys) this.queuedKeys.add(key);
  }

  _meshFromResult(result, candidate) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(result.normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(result.colors, 3));
    geometry.setAttribute("elevationMeters", new THREE.BufferAttribute(result.elevations, 1));
    geometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    mesh.userData.chunk = { x: candidate.x, z: candidate.z };
    return mesh;
  }

  _candidateStillWanted(candidate) {
    return Math.abs(candidate.x - this.lastCenter.x) <= this.radius
      && Math.abs(candidate.z - this.lastCenter.z) <= this.radius;
  }

  _pumpTerrain(budgetMs) {
    const started = performance.now();
    let work = 0;

    while (this.terrainCompleted.length && performance.now() - started < budgetMs) {
      const { candidate, result } = this.terrainCompleted.shift();
      this.queuedKeys.delete(candidate.key);
      if (!result || this.chunks.has(candidate.key) || !this._candidateStillWanted(candidate)) continue;
      const mesh = this._meshFromResult(result, candidate);
      this.chunks.set(candidate.key, mesh);
      this.scene.add(mesh);
      work += 1;
    }

    while (this.queue.length && this.terrainInFlight < this.maxTerrainInFlight) {
      const candidate = this.queue.shift();
      const generation = this.terrainGeneration;
      this.terrainInFlight += 1;
      this.terrainInFlightKeys.add(candidate.key);
      this.computeClient.terrain(candidate.x, candidate.z).then((result) => {
        if (result && generation === this.terrainGeneration) this.terrainCompleted.push({ candidate, result });
        else if (generation === this.terrainGeneration) this.queuedKeys.delete(candidate.key);
      }).catch((error) => {
        if (generation === this.terrainGeneration) {
          this.queuedKeys.delete(candidate.key);
          if (this._candidateStillWanted(candidate)) {
            this.queue.unshift(candidate);
            this.queuedKeys.add(candidate.key);
          }
        }
        console.warn("Surface terrain worker task failed; retrying through the surface work queue.", error);
      }).finally(() => {
        this.terrainInFlight = Math.max(0, this.terrainInFlight - 1);
        if (generation === this.terrainGeneration) this.terrainInFlightKeys.delete(candidate.key);
      });
    }
    return work;
  }

  onSurfaceComputeReady() {}

  pump(budgetMs = 2.5) {
    if (!this.computeClient?.worker) return super.pump(budgetMs);
    this._syncComputeContext(false);
    const budget = Math.max(0.1, Number(budgetMs) || 2.5);
    const started = performance.now();
    const producers = [
      {
        id: "terrain-worker",
        maxSliceMs: 0.72,
        hasWork: () => this.queue.length > 0 || this.terrainInFlight > 0 || this.terrainCompleted.length > 0,
        run: (sliceMs) => this._pumpTerrain(sliceMs)
      },
      {
        id: "ecology-worker",
        maxSliceMs: 0.62,
        hasWork: () => this.surfaceEcology?.hasWork() === true,
        run: (sliceMs) => this.surfaceEcology?.pump(sliceMs) ?? 0
      },
      {
        id: "fauna",
        maxSliceMs: 0.75,
        hasWork: () => this.surfaceFauna?.hasWork() === true,
        run: (sliceMs) => this.surfaceFauna?.pump(sliceMs, this.activeFaunaCells) ?? 0
      }
    ];

    let workUnits = 0;
    const producersRun = [];
    for (let offset = 0; offset < producers.length; offset += 1) {
      const producer = producers[(this.workCursor + offset) % producers.length];
      if (!producer.hasWork()) continue;
      const remaining = budget - (performance.now() - started);
      if (remaining <= 0.05) break;
      const units = producer.run(Math.min(remaining, producer.maxSliceMs));
      workUnits += Number.isFinite(units) ? Math.max(0, Number(units)) : 0;
      producersRun.push(producer.id);
    }
    this.workCursor = (this.workCursor + 1) % producers.length;

    this.lastSurfacePump = Object.freeze({
      policy: "surface-worker-transfer-v1",
      budgetMs: budget,
      elapsedMs: Math.max(0, performance.now() - started),
      workUnits,
      producersRun: Object.freeze(producersRun)
    });
    return workUnits;
  }

  hasPendingWork() {
    return this.queue.length > 0
      || this.terrainInFlight > 0
      || this.terrainCompleted.length > 0
      || this.surfaceEcology?.hasWork() === true
      || this.surfaceFauna?.hasWork() === true;
  }

  diagnostics() {
    const base = super.diagnostics();
    return Object.freeze({
      ...base,
      queuedChunks: base.terrainQueuedChunks + this.terrainInFlight + this.terrainCompleted.length + base.ecology.queuedChunks,
      terrainQueuedChunks: base.terrainQueuedChunks + this.terrainInFlight + this.terrainCompleted.length,
      surfaceCompute: this.computeClient?.diagnostics?.() ?? { available: false, status: "unavailable" },
      regionalSurfacePresentation: "science-driven-natural-mosaic-v1",
      regionalTerrainRefinement: Object.freeze({
        status: this.regionalTerrainPatchStatus,
        sourceId: this.regionalTerrainPatch?.sourceId ?? null,
        resolutionMeters: this.regionalTerrainPatch?.resolutionMeters ?? null,
        bounds: this.regionalTerrainPatch ? Object.freeze({
          west: this.regionalTerrainPatch.west,
          east: this.regionalTerrainPatch.east,
          south: this.regionalTerrainPatch.south,
          north: this.regionalTerrainPatch.north
        }) : null,
        error: this.regionalTerrainPatchError
      }),
      worldStreaming: Object.freeze({ ...base.worldStreaming, policy: "surface-worker-transfer-v1", lastPump: this.lastSurfacePump })
    });
  }

  clear() {
    super.clear();
    this.terrainGeneration = (this.terrainGeneration ?? 0) + 1;
    this.terrainInFlightKeys?.clear?.();
    this.terrainCompleted = [];
    this.computeContextSignature = "";
  }

  dispose() {
    this.regionalTerrainRequestToken += 1;
    super.dispose();
    this.computeClient?.dispose();
    this.computeClient = null;
    this.regionalTerrainPatch = null;
  }
}
