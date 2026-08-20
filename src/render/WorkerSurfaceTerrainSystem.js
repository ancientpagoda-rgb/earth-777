import * as THREE from "three";
import { SurfaceTerrainSystem } from "./SurfaceTerrainSystem.js";
import { SurfaceComputeClient } from "./SurfaceComputeClient.js";
import { WorkerSurfaceEcologyManager } from "./WorkerSurfaceEcologyManager.js";

const KM_PER_DEGREE_LATITUDE = 111.32;

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
    // One Web Worker executes terrain serially. Keeping several requests queued
    // only increases stale-work latency when the user pans/zooms or LOD changes.
    this.maxTerrainInFlight = 1;
    this.computeContextSignature = "";
    this.regionalTerrainPatch = null;
    this.regionalTerrainPatchStatus = "idle";
    this.regionalTerrainPatchError = null;
    this.regionalTerrainRequestToken = 0;
    this.regionalTerrainRefinementTimer = null;
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

  _regionalTerrainSmoothingRadiusCells() {
    const patch = this.regionalTerrainPatch;
    if (!patch || Number(this.chunkSizeKm) < 8) return 0;
    const sourceResolutionMeters = Math.max(50, Number(patch.resolutionMeters) || 600);
    const vertexSpacingMeters = Math.max(1, Number(this.chunkSizeKm) * 1000 / Math.max(1, Number(this.segments) || 1));
    return Math.max(1, Math.min(16, Math.round(vertexSpacingMeters / sourceResolutionMeters * 0.42)));
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
      patch ? `${patch.sourceId}:${patch.west}:${patch.south}:${patch.ncols}:${patch.nrows}:${patch.resolutionMeters}:smooth-${this._regionalTerrainSmoothingRadiusCells()}` : "regional-patch:none"
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
      regionalTerrainPatchActive: Boolean(this.regionalTerrainPatch),
      regionalTerrainSmoothingRadiusCells: this._regionalTerrainSmoothingRadiusCells(),
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

  _chunkOverlapsRegionalTerrainPatch(chunkX, chunkZ) {
    const patch = this.regionalTerrainPatch;
    if (!patch || !this.origin) return false;
    const half = Number(this.chunkSizeKm) * 0.5;
    const centerXKm = Number(chunkX) * Number(this.chunkSizeKm);
    const centerZKm = Number(chunkZ) * Number(this.chunkSizeKm);
    const longitudeScale = Math.max(12, KM_PER_DEGREE_LATITUDE * Math.cos(Number(this.origin.latitude) * Math.PI / 180));
    const south = Number(this.origin.latitude) + (centerZKm - half) / KM_PER_DEGREE_LATITUDE;
    const north = Number(this.origin.latitude) + (centerZKm + half) / KM_PER_DEGREE_LATITUDE;
    const west = Number(this.origin.longitude) + (centerXKm - half) / longitudeScale;
    const east = Number(this.origin.longitude) + (centerXKm + half) / longitudeScale;
    return north >= Number(patch.south)
      && south <= Number(patch.north)
      && east >= Number(patch.west)
      && west <= Number(patch.east);
  }

  _queueVisibleTerrainRefresh() {
    const centerX = Number(this.lastCenter?.x);
    const centerZ = Number(this.lastCenter?.z);
    if (!Number.isFinite(centerX) || !Number.isFinite(centerZ)) return false;
    this.queue = [];
    this.queuedKeys.clear();
    const candidates = [];
    for (let dz = -this.radius; dz <= this.radius; dz += 1) {
      for (let dx = -this.radius; dx <= this.radius; dx += 1) {
        const x = centerX + dx;
        const z = centerZ + dz;
        if (!this._chunkOverlapsRegionalTerrainPatch(x, z)) continue;
        const key = `${x}:${z}`;
        candidates.push({ x, z, key, distance: dx * dx + dz * dz, replaceExisting: true });
        this.queuedKeys.add(key);
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    this.queue.push(...candidates);
    return candidates.length > 0;
  }

  _scheduleRegionalTerrainRefinement(origin, token) {
    if (this.regionalTerrainRefinementTimer != null) clearTimeout(this.regionalTerrainRefinementTimer);
    this.regionalTerrainPatchStatus = "queued";
    // Give the coarse terrain roughly half a second to become interactive before
    // asking the worker to download/parse the optional refinement grid.
    this.regionalTerrainRefinementTimer = setTimeout(() => {
      this.regionalTerrainRefinementTimer = null;
      if (token !== this.regionalTerrainRequestToken || !this.computeClient?.worker) return;
      this.regionalTerrainPatchStatus = "loading";
      this.computeClient.regionalTerrain(origin.latitude, origin.longitude, { spanDegrees: 1.0, resolutionMeters: 600 })
        .then((result) => {
          if (token !== this.regionalTerrainRequestToken || !this.origin || !result?.patch) return;
          this.regionalTerrainPatch = result.patch;
          this.regionalTerrainPatchStatus = "ready";
          this.regionalTerrainPatchError = null;
          // The worker already owns the heavy Float32 DEM. Only lightweight patch
          // metadata crosses back to the main thread, then overlapping chunks are
          // replaced progressively while the coarse world remains visible.
          this.queue = [];
          this.queuedKeys.clear();
          this._syncComputeContext(true);
          this._queueVisibleTerrainRefresh();
        })
        .catch((error) => {
          if (token !== this.regionalTerrainRequestToken) return;
          this.regionalTerrainPatch = null;
          this.regionalTerrainPatchStatus = "fallback";
          this.regionalTerrainPatchError = error?.message ?? String(error);
          console.info("Regional terrain refinement unavailable; retaining compact ETOPO fallback.", error);
        });
    }, 500);
  }

  setOrigin(latitude, longitude) {
    super.setOrigin(latitude, longitude);
    if (this.regionalTerrainRefinementTimer != null) {
      clearTimeout(this.regionalTerrainRefinementTimer);
      this.regionalTerrainRefinementTimer = null;
    }
    this.computeClient?.clearRegionalTerrainPatch?.();
    this.regionalTerrainPatch = null;
    this.regionalTerrainPatchError = null;
    const token = ++this.regionalTerrainRequestToken;
    const origin = { latitude: this.origin.latitude, longitude: this.origin.longitude };
    this._scheduleRegionalTerrainRefinement(origin, token);
  }

  update(cameraPosition) {
    super.update(cameraPosition);
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
      if (!result || !this._candidateStillWanted(candidate)) continue;
      const previous = this.chunks.get(candidate.key);
      if (previous && !candidate.replaceExisting) continue;
      const mesh = this._meshFromResult(result, candidate);
      if (previous) {
        this.scene.remove(previous);
        previous.geometry.dispose();
      }
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
      policy: "surface-worker-transfer-v2-idle-refinement",
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
        smoothingRadiusCells: this._regionalTerrainSmoothingRadiusCells(),
        bounds: this.regionalTerrainPatch ? Object.freeze({
          west: this.regionalTerrainPatch.west,
          east: this.regionalTerrainPatch.east,
          south: this.regionalTerrainPatch.south,
          north: this.regionalTerrainPatch.north
        }) : null,
        error: this.regionalTerrainPatchError
      }),
      worldStreaming: Object.freeze({ ...base.worldStreaming, policy: "surface-worker-transfer-v2-idle-refinement", lastPump: this.lastSurfacePump })
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
    if (this.regionalTerrainRefinementTimer != null) clearTimeout(this.regionalTerrainRefinementTimer);
    this.regionalTerrainRefinementTimer = null;
    super.dispose();
    this.computeClient?.dispose();
    this.computeClient = null;
    this.regionalTerrainPatch = null;
  }
}
