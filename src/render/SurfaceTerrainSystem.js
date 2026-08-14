import { TerrainChunkManager } from "./TerrainChunkManager.js";
import { SurfaceEcologyManager } from "./SurfaceEcologyManager.js";

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
    riverSample: null
  };
}

export class SurfaceTerrainSystem extends TerrainChunkManager {
  constructor(scene, options = {}) {
    super(scene, options);
    this.surfaceEcology = new SurfaceEcologyManager(scene, this);
  }

  setEarthSystemState(state, seed = state?.seed) {
    super.setEarthSystemState(state, seed);
    if (this.origin) {
      const context = provisionalSurfaceContext(this.origin.latitude, this.origin.longitude, state);
      this.surfaceEcology.setContext({ latitude: this.origin.latitude, longitude: this.origin.longitude, ...context });
    }
  }

  setOrigin(latitude, longitude) {
    super.setOrigin(latitude, longitude);
    const context = provisionalSurfaceContext(latitude, longitude, this.earthState);
    this.surfaceEcology.setContext({ latitude, longitude, ...context });
  }

  configure(options = {}) {
    super.configure(options);
    const segments = Number(options.segments ?? this.segments);
    const radius = Number(options.radius ?? this.radius);
    this.surfaceEcology.configure({ quality: clamp(segments / 22, 0.45, 1), radius: Math.min(2, Math.max(1, Math.round(radius))) });
  }

  update(cameraPosition) {
    super.update(cameraPosition);
    this.surfaceEcology.update(cameraPosition);
  }

  pump(budgetMs = 2.5) {
    const terrainWork = super.pump(Math.max(0.5, budgetMs * 0.62));
    const ecologyWork = this.surfaceEcology.pump(Math.max(0.35, budgetMs * 0.38));
    return terrainWork + ecologyWork;
  }

  diagnostics() {
    const terrain = super.diagnostics();
    const ecology = this.surfaceEcology.diagnostics();
    return Object.freeze({ ...terrain, queuedChunks: terrain.queuedChunks + ecology.queuedChunks, terrainQueuedChunks: terrain.queuedChunks, ecology });
  }

  clear() {
    super.clear();
    this.surfaceEcology?.clear();
  }

  dispose() {
    this.surfaceEcology?.dispose();
    this.surfaceEcology = null;
    super.dispose();
  }
}
