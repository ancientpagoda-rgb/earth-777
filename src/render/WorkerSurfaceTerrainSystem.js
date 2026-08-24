import * as THREE from "three";
import { SurfaceTerrainSystem } from "./SurfaceTerrainSystem.js";
import { SurfaceComputeClient } from "./SurfaceComputeClient.js";
import { WorkerSurfaceEcologyManager } from "./WorkerSurfaceEcologyManager.js";
import {
  SURFACE_STREAMING_POLICY,
  localKilometersToGeographic,
  predictedRefinementCenter,
  regionalPatchContainsFocus,
  streamingSegmentsForCandidate
} from "./SurfaceStreamingPolicy.js";

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
    this.maxTerrainInFlight = 1;
    this.computeContextSignature = "";
    this.regionalTerrainPatch = null;
    this.regionalTerrainPatchStatus = "idle";
    this.regionalTerrainPatchError = null;
    this.regionalTerrainRequestToken = 0;
    this.regionalTerrainRefinementTimer = null;
    this.lastRefinementFocus = { x: 0, z: 0 };
    this.lastRequestedRefinementCenter = null;
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

  _regionalTerrainSmoothingRadiusCells(segments = this.segments) {
    const patch = this.regionalTerrainPatch;
    if (!patch || Number(this.chunkSizeKm) < 8) return 0;
    const sourceResolutionMeters = Math.max(50, Number(patch.resolutionMeters) || 600);
    const vertexSpacingMeters = Math.max(1, Number(this.chunkSizeKm) * 1000 / Math.max(1, Number(segments) || 1));
    return Math.max(1, Math.min(16, Math.round(vertexSpacingMeters / sourceResolutionMeters * 0.42)));
  }

  _segmentsForCandidate(candidate) {
    return streamingSegmentsForCandidate({
      bandId: this.viewScaleBand ?? "regional",
      baseSegments: this.segments,
      distanceSquared: candidate?.distance ?? 0
    });
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
        const key = `${x}:${z}`;
        const distance = dx * dx + dz * dz;
        candidates.push({ x, z, key, distance, replaceExisting: true, segments: this._segmentsForCandidate({ distance }) });
        this.queuedKeys.add(key);
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    this.queue.push(...candidates);
    return candidates.length > 0;
  }

  _queueConcentricLodRefresh() {
    if (!Number.isFinite(Number(this.lastCenter?.x)) || !Number.isFinite(Number(this.lastCenter?.z))) return 0;
    const replacements = [];
    for (const [key, mesh] of this.chunks) {
      const [x, z] = key.split(":").map(Number);
      const dx = x - this.lastCenter.x;
      const dz = z - this.lastCenter.z;
      const distance = dx * dx + dz * dz;
      const desiredSegments = this._segmentsForCandidate({ distance });
      const currentSegments = Number(mesh.userData?.segments) || Number(this.segments);
      if (desiredSegments === currentSegments || this.queuedKeys.has(key) || this.terrainInFlightKeys.has(key)) continue;
      replacements.push({ x, z, key, distance, replaceExisting: true, segments: desiredSegments });
      this.queuedKeys.add(key);
    }
    replacements.sort((a, b) => a.distance - b.distance);
    this.queue.unshift(...replacements);
    return replacements.length;
  }

  _scheduleRegionalTerrainRefinement(center, token, delayMs = 420) {
    if (this.regionalTerrainRefinementTimer != null) clearTimeout(this.regionalTerrainRefinementTimer);
    this.regionalTerrainPatchStatus = this.regionalTerrainPatch ? "moving" : "queued";
    this.lastRequestedRefinementCenter = { ...center };
    this.regionalTerrainRefinementTimer = setTimeout(() => {
      this.regionalTerrainRefinementTimer = null;
      if (token !== this.regionalTerrainRequestToken || !this.computeClient?.worker) return;
      this.regionalTerrainPatchStatus = "loading";
      // One 3-degree patch covers most of the broad regional presentation while
      // the compute worker retains recent neighboring patches as the camera moves.
      // At 900 m source spacing this remains far denser than the regional mesh
      // without imposing the payload of a continent-sized raw grid.
      this.computeClient.regionalTerrain(center.latitude, center.longitude, { spanDegrees: 3.0, resolutionMeters: 900 })
        .then((result) => {
          if (token !== this.regionalTerrainRequestToken || !this.origin || !result?.patch) return;
          this.regionalTerrainPatch = result.patch;
          this.regionalTerrainPatchStatus = "ready";
          this.regionalTerrainPatchError = null;
          this.queue = [];
          this.queuedKeys.clear();
          this._syncComputeContext(true);
          this._queueVisibleTerrainRefresh();
        })
        .catch((error) => {
          if (token !== this.regionalTerrainRequestToken) return;
          this.regionalTerrainPatchStatus = this.regionalTerrainPatch ? "ready" : "fallback";
          this.regionalTerrainPatchError = error?.message ?? String(error);
          console.info("Regional terrain refinement unavailable; retaining current terrain fallback.", error);
        });
    }, Math.max(120, Number(delayMs) || 0));
  }

  _updateRegionalTerrainFocus(cameraPosition) {
    if (!this.origin || !cameraPosition || !["regional", "landscape"].includes(this.viewScaleBand)) return;
    const focusX = Number(cameraPosition.x) || 0;
    const focusZ = Number(cameraPosition.z) || 0;
    const geographic = localKilometersToGeographic(this.origin, focusX, focusZ);
    const previous = this.lastRefinementFocus;
    this.lastRefinementFocus = { x: focusX, z: focusZ };

    if (this.regionalTerrainPatch && regionalPatchContainsFocus(this.regionalTerrainPatch, geographic.latitude, geographic.longitude, 0.20)) return;

    const center = predictedRefinementCenter({
      origin: this.origin,
      focusXKm: focusX,
      focusZKm: focusZ,
      previousFocusXKm: previous.x,
      previousFocusZKm: previous.z,
      lookAheadKm: this.viewScaleBand === "regional" ? 20 : 10,
      quantizationDegrees: 0.25
    });
    if (this.lastRequestedRefinementCenter
      && Math.abs(center.latitude - this.lastRequestedRefinementCenter.latitude) < 1e-6
      && Math.abs(center.longitude - this.lastRequestedRefinementCenter.longitude) < 1e-6) return;

    const token = ++this.regionalTerrainRequestToken;
    this._scheduleRegionalTerrainRefinement(center, token, this.regionalTerrainPatch ? 520 : 360);
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
    this.lastRefinementFocus = { x: 0, z: 0 };
    this.lastRequestedRefinementCenter = null;
    const token = ++this.regionalTerrainRequestToken;
    const center = predictedRefinementCenter({ origin: this.origin, focusXKm: 0, focusZKm: 0, quantizationDegrees: 0.25 });
    this._scheduleRegionalTerrainRefinement(center, token, 360);
  }

  update(cameraPosition) {
    super.update(cameraPosition);
    for (const key of this.terrainInFlightKeys) this.queuedKeys.add(key);
    this._queueConcentricLodRefresh();
    this._updateRegionalTerrainFocus(cameraPosition);
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
    mesh.userData.segments = Number(result.segments) || Number(candidate.segments) || Number(this.segments);
    mesh.userData.hydrology = result.hydrology ?? null;
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
      const segments = Number(candidate.segments) || this._segmentsForCandidate(candidate);
      this.terrainInFlight += 1;
      this.terrainInFlightKeys.add(candidate.key);
      this.computeClient.terrain(candidate.x, candidate.z, {
        segments,
        regionalTerrainSmoothingRadiusCells: this._regionalTerrainSmoothingRadiusCells(segments)
      }).then((result) => {
        if (result && generation === this.terrainGeneration) this.terrainCompleted.push({ candidate: { ...candidate, segments }, result });
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
      policy: "surface-worker-transfer-v3-camera-following",
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
    let streamVertices = 0;
    let wetlandVertices = 0;
    let lakeVertices = 0;
    let hydrologyChunks = 0;
    const lodCounts = {};
    for (const mesh of this.chunks.values()) {
      const segments = Number(mesh.userData?.segments) || this.segments;
      lodCounts[segments] = (lodCounts[segments] ?? 0) + 1;
      const hydrology = mesh.userData?.hydrology;
      if (!hydrology) continue;
      hydrologyChunks += 1;
      streamVertices += Number(hydrology.streamVertexCount) || 0;
      wetlandVertices += Number(hydrology.wetlandVertexCount) || 0;
      lakeVertices += Number(hydrology.lakeVertexCount) || 0;
    }
    return Object.freeze({
      ...base,
      queuedChunks: base.terrainQueuedChunks + this.terrainInFlight + this.terrainCompleted.length + base.ecology.queuedChunks,
      terrainQueuedChunks: base.terrainQueuedChunks + this.terrainInFlight + this.terrainCompleted.length,
      surfaceCompute: this.computeClient?.diagnostics?.() ?? { available: false, status: "unavailable" },
      regionalSurfacePresentation: "science-driven-natural-mosaic-v1",
      multiresolutionStreaming: Object.freeze({
        policy: SURFACE_STREAMING_POLICY,
        lodChunkCounts: Object.freeze({ ...lodCounts }),
        refinementFocusKm: Object.freeze({ ...this.lastRefinementFocus })
      }),
      terrainCoupledHydrology: Object.freeze({
        policy: "displayed-terrain-d8-basin-wetland-v1",
        chunks: hydrologyChunks,
        streamVertices,
        wetlandVertices,
        lakeVertices
      }),
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
      regionalTerrainAtlas: Object.freeze({
        policy: "retained-overlapping-regional-patches-v1",
        patchLimit: 6,
        requestedSpanDegrees: 3,
        requestedResolutionMeters: 900
      }),
      worldStreaming: Object.freeze({ ...base.worldStreaming, policy: "surface-worker-transfer-v3-camera-following", lastPump: this.lastSurfacePump })
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
