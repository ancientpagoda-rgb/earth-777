import { TerrainChunkManager } from "./TerrainChunkManager.js";
import { SurfaceEcologyManager } from "./SurfaceEcologyManager.js";
import { SurfaceBuiltEnvironmentManager } from "./SurfaceBuiltEnvironmentManager.js";
import { WorldStreamScheduler } from "../sim/WorldStreamScheduler.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

function provisionalSurfaceContext(latitude, longitude, state = null) {
  const absLat = Math.abs(Number(latitude) || 0);
  const lon = Number(longitude) || 0;
  const moisture = clamp(0.52 + Math.cos(latitude * Math.PI / 45) * 0.18 + Math.sin(lon * Math.PI / 85) * 0.18, 0, 1);
  let biomeCode = 17;
  if (absLat > 74) biomeCode = 28;
  else if (absLat > 58) biomeCode = moisture > 0.5 ? 9 : 24;
  else if (absLat < 24) biomeCode = moisture > 0.67 ? 2 : moisture < 0.30 ? 21 : 16;
  else biomeCode = moisture > 0.62 ? 8 : moisture < 0.27 ? 21 : 17;

  const globalProductivity = Math.max(0.05, Number(state?.productivityIndex) || 1);
  const npp = clamp((180 + moisture * 1750 - Math.max(0, absLat - 45) * 15) * globalProductivity, 20, 6000);
  const lai = clamp((0.2 + moisture * 6.2 - Math.max(0, absLat - 55) * 0.05) * globalProductivity ** 0.45, 0.02, 12);
  const runoff = clamp((moisture - 0.34) * 900 * Math.exp((Number(state?.temperatureAnomaly) || -1.27) * 0.012), 0, 1200);
  return {
    state: state ?? { productivityIndex: 1, herbivoreBiomass: 1, homininPopulationIndex: 1, seaLevel: 0, yearBP: 777000 },
    vegetationSample: { biomeCode, biomeLabel: "provisional local surface prior", npp, lai },
    hydrologySample: { surfaceRunoffMmPerYear: runoff },
    riverSample: null,
    geomorphologyPatch: null,
    scienceCoupled: false
  };
}

export class SurfaceTerrainSystem extends TerrainChunkManager {
  constructor(scene, options = {}) {
    super(scene, options);
    this.surfaceEcology = new SurfaceEcologyManager(scene, this);
    this.surfaceBuiltEnvironment = new SurfaceBuiltEnvironmentManager(scene, this);
    this.hydrology = null;
    this.vegetation = null;
    this.spatialDetail = 0.82;
    this.surfaceScienceStatus = "provisional";
    this.surfaceContextActive = false;
    this.lastSurfaceContext = null;

    this.worldScheduler = new WorldStreamScheduler({ budgetMs: 2.5 });
    this.worldScheduler.registerSystem({
      id: "surface-terrain",
      scope: "observed",
      priority: 100,
      maxSliceMs: 1.45,
      hasWork: () => this.queue.length > 0,
      run: ({ sliceMs }) => TerrainChunkManager.prototype.pump.call(this, sliceMs)
    });
    this.worldScheduler.registerSystem({
      id: "surface-ecology",
      scope: "observed",
      priority: 90,
      maxSliceMs: 1.15,
      hasWork: () => (this.surfaceEcology?.queue?.length ?? 0) > 0,
      run: ({ sliceMs }) => this.surfaceEcology?.pump(sliceMs) ?? 0
    });
  }

  setScienceProviders({ hydrology = this.hydrology, vegetation = this.vegetation, spatialDetail = this.spatialDetail } = {}) {
    const nextHydrology = hydrology?.sample ? hydrology : null;
    const nextVegetation = vegetation?.sample ? vegetation : null;
    const nextSpatialDetail = clamp(spatialDetail, 0, 1);
    const changed = nextHydrology !== this.hydrology
      || nextVegetation !== this.vegetation
      || Math.abs(nextSpatialDetail - this.spatialDetail) > 1e-6;
    this.hydrology = nextHydrology;
    this.vegetation = nextVegetation;
    this.spatialDetail = nextSpatialDetail;
    if (changed && this.surfaceContextActive) this._refreshSurfaceContext();
    return changed;
  }

  setSurfaceContextActive(active, refresh = true) {
    const next = Boolean(active);
    const changed = next !== this.surfaceContextActive;
    this.surfaceContextActive = next;
    if (this.origin) {
      this.worldScheduler.setFocus({
        latitude: this.origin.latitude,
        longitude: this.origin.longitude,
        mode: next ? "surface" : "globe"
      });
    }
    if (next && refresh && (changed || this.origin)) this._refreshSurfaceContext();
    return changed;
  }

  _surfaceContext(latitude, longitude, state = this.earthState) {
    if (!state || !this.hydrology?.sample) return provisionalSurfaceContext(latitude, longitude, state);
    const hydrologySample = this.hydrology.sample(state, latitude, longitude, this.spatialDetail);
    const river = this.hydrology.networkSample?.(state, latitude, longitude, this.spatialDetail) ?? null;
    const groundwaterLake = this.hydrology.groundwaterLakeSample?.(state, latitude, longitude, this.spatialDetail) ?? null;
    const geomorphologyPatch = this.hydrology.surfaceGeomorphologyPatch?.(state, latitude, longitude, this.spatialDetail) ?? null;
    const vegetationSample = this.vegetation?.sample?.(state, latitude, longitude, this.spatialDetail) ?? null;
    if (!hydrologySample) return provisionalSurfaceContext(latitude, longitude, state);
    return {
      state,
      vegetationSample,
      hydrologySample,
      geomorphologyPatch,
      riverSample: river || groundwaterLake || geomorphologyPatch
        ? Object.freeze({ ...(river ?? {}), ...(groundwaterLake ?? {}), ...(geomorphologyPatch ?? {}) })
        : null,
      scienceCoupled: true
    };
  }

  _refreshSurfaceContext() {
    if (!this.surfaceContextActive || !this.origin) return false;
    const context = this._surfaceContext(this.origin.latitude, this.origin.longitude, this.earthState);
    this.lastSurfaceContext = context;
    this.surfaceScienceStatus = context.scienceCoupled ? "science-coupled" : "provisional";
    this.setGeomorphologyPatch(context.geomorphologyPatch);
    const localContext = { latitude: this.origin.latitude, longitude: this.origin.longitude, ...context };
    this.surfaceEcology.setContext(localContext);
    this.surfaceBuiltEnvironment.setContext(localContext);
    return true;
  }

  currentWaterSystem() {
    return this.lastSurfaceContext?.riverSample ?? null;
  }

  setEarthSystemState(state, seed = state?.seed, refreshContext = this.surfaceContextActive) {
    super.setEarthSystemState(state, seed);
    if (refreshContext && this.surfaceContextActive) this._refreshSurfaceContext();
  }

  setOrigin(latitude, longitude) {
    super.setOrigin(latitude, longitude);
    this.worldScheduler.setFocus({
      latitude: this.origin.latitude,
      longitude: this.origin.longitude,
      mode: this.surfaceContextActive ? "surface" : "globe"
    });
    if (this.surfaceContextActive) this._refreshSurfaceContext();
  }

  configure(options = {}) {
    super.configure(options);
    const segments = Number(options.segments ?? this.segments);
    const radius = Number(options.radius ?? this.radius);
    const quality = clamp(segments / 22, 0.45, 1);
    this.surfaceEcology.configure({ quality, radius: Math.min(2, Math.max(1, Math.round(radius))) });
    this.surfaceBuiltEnvironment.configure({ quality });
  }

  update(cameraPosition) {
    super.update(cameraPosition);
    this.surfaceEcology.update(cameraPosition);
    if (this.origin) {
      const focus = this._geographicAt(cameraPosition.x, cameraPosition.z);
      this.worldScheduler.setFocus({ latitude: focus.latitude, longitude: focus.longitude, mode: "surface" });
    }
  }

  pump(budgetMs = 2.5) {
    const result = this.worldScheduler.pump({
      budgetMs: Math.max(0.1, budgetMs),
      context: Object.freeze({
        terrainQueuedChunks: this.queue.length,
        ecologyQueuedChunks: this.surfaceEcology?.queue?.length ?? 0,
        spatialDetail: this.spatialDetail
      })
    });
    return result.workUnits;
  }

  hasPendingWork() {
    return this.queue.length > 0 || (this.surfaceEcology?.queue?.length ?? 0) > 0;
  }

  diagnostics() {
    const terrain = super.diagnostics();
    const ecology = this.surfaceEcology.diagnostics();
    const builtEnvironment = this.surfaceBuiltEnvironment.diagnostics();
    return Object.freeze({
      ...terrain,
      queuedChunks: terrain.queuedChunks + ecology.queuedChunks,
      terrainQueuedChunks: terrain.queuedChunks,
      ecology,
      builtEnvironment,
      worldStreaming: this.worldScheduler.diagnostics(),
      surfaceScienceStatus: this.surfaceScienceStatus,
      surfaceContextActive: this.surfaceContextActive,
      hydrologyProvider: Boolean(this.hydrology),
      vegetationProvider: Boolean(this.vegetation),
      spatialDetail: this.spatialDetail,
      geomorphologyPatchPolicy: this.geomorphologyPatch?.policy ?? null
    });
  }

  clear() {
    super.clear();
    this.surfaceEcology?.clear();
    this.surfaceBuiltEnvironment?.clear();
  }

  dispose() {
    this.surfaceEcology?.dispose();
    this.surfaceEcology = null;
    this.surfaceBuiltEnvironment?.dispose();
    this.surfaceBuiltEnvironment = null;
    this.lastSurfaceContext = null;
    this.worldScheduler = null;
    super.dispose();
  }
}