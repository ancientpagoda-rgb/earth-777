import { TerrainChunkManager } from "./TerrainChunkManager.js";
import { SurfaceEcologyManager } from "./SurfaceEcologyManager.js";
import { SurfaceFaunaManager } from "./SurfaceFaunaManager.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const wrapLongitude = (value) => ((Number(value) + 180) % 360 + 360) % 360 - 180;

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

function gridCells(scope, cellDegrees, latitude, longitude) {
  const latitudeCount = Math.max(1, Math.ceil(180 / cellDegrees));
  const longitudeCount = Math.max(1, Math.ceil(360 / cellDegrees));
  const centerLatitude = clamp(Math.floor((clamp(latitude, -89.999999, 89.999999) + 90) / cellDegrees), 0, latitudeCount - 1);
  const wrappedLongitude = wrapLongitude(longitude);
  const centerLongitude = ((Math.floor((wrappedLongitude + 180) / cellDegrees) % longitudeCount) + longitudeCount) % longitudeCount;
  const cells = new Map();

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const latIndex = clamp(centerLatitude + dy, 0, latitudeCount - 1);
      const lonIndex = ((centerLongitude + dx) % longitudeCount + longitudeCount) % longitudeCount;
      const south = -90 + latIndex * cellDegrees;
      const north = Math.min(90, south + cellDegrees);
      const west = -180 + lonIndex * cellDegrees;
      const east = Math.min(180, west + cellDegrees);
      const key = `${scope}:${latIndex}:${lonIndex}`;
      cells.set(key, Object.freeze({
        key,
        scope,
        latitude: (south + north) * 0.5,
        longitude: wrapLongitude((west + east) * 0.5),
        cellDegrees,
        bounds: Object.freeze({ south, north, west, east })
      }));
    }
  }

  return [...cells.values()];
}

function faunaCellsAround(latitude, longitude) {
  return Object.freeze([
    ...gridCells("regional", 10, latitude, longitude),
    ...gridCells("local", 1, latitude, longitude)
  ]);
}

export class SurfaceTerrainSystem extends TerrainChunkManager {
  constructor(scene, options = {}) {
    super(scene, options);
    this.surfaceEcology = new SurfaceEcologyManager(scene, this);
    this.surfaceFauna = new SurfaceFaunaManager(scene, this);
    this.hydrology = null;
    this.vegetation = null;
    this.spatialDetail = 0.82;
    this.surfaceScienceStatus = "provisional";
    this.surfaceContextActive = false;
    this.lastSurfaceContext = null;
    this.activeFaunaCells = Object.freeze([]);
    this.workCursor = 0;
    this.lastSurfacePump = Object.freeze({
      policy: "surface-direct-work-v1",
      budgetMs: 2.5,
      elapsedMs: 0,
      workUnits: 0,
      producersRun: Object.freeze([])
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
      riverSample: river || groundwaterLake || geomorphologyPatch ? Object.freeze({ ...(river ?? {}), ...(groundwaterLake ?? {}), ...(geomorphologyPatch ?? {}) }) : null,
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
    this.surfaceFauna.setContext(localContext);
    return true;
  }

  currentWaterSystem() { return this.lastSurfaceContext?.riverSample ?? null; }

  setEarthSystemState(state, seed = state?.seed, refreshContext = this.surfaceContextActive) {
    super.setEarthSystemState(state, seed);
    if (refreshContext && this.surfaceContextActive) this._refreshSurfaceContext();
  }

  setOrigin(latitude, longitude) {
    super.setOrigin(latitude, longitude);
    this.activeFaunaCells = faunaCellsAround(this.origin.latitude, this.origin.longitude);
    if (this.surfaceContextActive) this._refreshSurfaceContext();
  }

  configure(options = {}) {
    super.configure(options);
    const segments = Number(options.segments ?? this.segments);
    const radius = Number(options.radius ?? this.radius);
    const quality = clamp(segments / 22, 0.45, 1);
    const boundedRadius = Math.min(2, Math.max(1, Math.round(radius)));
    this.surfaceEcology.configure({ quality, radius: boundedRadius });
    this.surfaceFauna.configure({ windowRadiusKm: this.chunkSizeKm * (boundedRadius + 1.2), individualRadiusKm: 0.42 + quality * 0.34 });
  }

  update(cameraPosition) {
    super.update(cameraPosition);
    this.surfaceEcology.update(cameraPosition);
    this.surfaceFauna.updateCamera(cameraPosition);
    if (this.origin) {
      const focus = this._geographicAt(cameraPosition.x, cameraPosition.z);
      this.activeFaunaCells = faunaCellsAround(focus.latitude, focus.longitude);
    }
  }

  pump(budgetMs = 2.5) {
    const budget = Math.max(0.1, Number(budgetMs) || 2.5);
    const started = performance.now();
    const producers = [
      {
        id: "terrain",
        maxSliceMs: 1.15,
        hasWork: () => this.queue.length > 0,
        run: (sliceMs) => TerrainChunkManager.prototype.pump.call(this, sliceMs)
      },
      {
        id: "ecology",
        maxSliceMs: 0.9,
        hasWork: () => (this.surfaceEcology?.queue?.length ?? 0) > 0,
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
      policy: "surface-direct-work-v1",
      budgetMs: budget,
      elapsedMs: Math.max(0, performance.now() - started),
      workUnits,
      producersRun: Object.freeze(producersRun)
    });
    return workUnits;
  }

  hasPendingWork() {
    return this.queue.length > 0 || (this.surfaceEcology?.queue?.length ?? 0) > 0 || this.surfaceFauna?.hasWork() === true;
  }

  diagnostics() {
    const terrain = super.diagnostics();
    const ecology = this.surfaceEcology.diagnostics();
    const fauna = this.surfaceFauna.diagnostics();
    return Object.freeze({
      ...terrain,
      queuedChunks: terrain.queuedChunks + ecology.queuedChunks,
      terrainQueuedChunks: terrain.queuedChunks,
      ecology,
      fauna,
      worldStreaming: Object.freeze({
        policy: "surface-direct-work-v1",
        activeCellCount: this.activeFaunaCells.length,
        activeByScope: Object.freeze({
          regional: this.activeFaunaCells.filter((cell) => cell.scope === "regional").length,
          local: this.activeFaunaCells.filter((cell) => cell.scope === "local").length
        }),
        lastPump: this.lastSurfacePump
      }),
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
    this.surfaceFauna?.clear();
  }

  dispose() {
    this.surfaceEcology?.dispose();
    this.surfaceEcology = null;
    this.surfaceFauna?.dispose();
    this.surfaceFauna = null;
    this.activeFaunaCells = Object.freeze([]);
    this.lastSurfaceContext = null;
    super.dispose();
  }
}
