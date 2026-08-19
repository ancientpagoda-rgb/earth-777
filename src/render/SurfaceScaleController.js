const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export const SURFACE_SCALE_BANDS = Object.freeze([
  Object.freeze({
    id: "regional",
    minDistanceKm: 6,
    chunkSizeKm: 16,
    radius: 3,
    segments: 14,
    verticalScale: 0.90,
    contourIntervalMeters: 250,
    contourOpacity: 0.08,
    fogNearKm: 34,
    fogFarKm: 240,
    ecology: Object.freeze({ grass: false, trunk: false, crown: false, shrub: false, rock: false }),
    faunaGroup: false,
    faunaIndividual: false
  }),
  Object.freeze({
    id: "landscape",
    minDistanceKm: 1.6,
    chunkSizeKm: 6,
    radius: 3,
    segments: 18,
    verticalScale: 0.76,
    contourIntervalMeters: 100,
    contourOpacity: 0.12,
    fogNearKm: 12,
    fogFarKm: 120,
    ecology: Object.freeze({ grass: false, trunk: false, crown: false, shrub: false, rock: false }),
    faunaGroup: false,
    faunaIndividual: false
  }),
  Object.freeze({
    id: "ecology",
    minDistanceKm: 0.28,
    chunkSizeKm: 2,
    radius: 3,
    segments: 22,
    verticalScale: 0.64,
    contourIntervalMeters: 50,
    contourOpacity: 0.18,
    fogNearKm: 3.5,
    fogFarKm: 52,
    ecology: Object.freeze({ grass: false, trunk: false, crown: true, shrub: false, rock: false }),
    faunaGroup: true,
    faunaIndividual: false
  }),
  Object.freeze({
    id: "ground",
    minDistanceKm: 0,
    chunkSizeKm: 0.75,
    radius: 3,
    segments: 28,
    verticalScale: 0.55,
    contourIntervalMeters: 20,
    contourOpacity: 0.28,
    fogNearKm: 0.8,
    fogFarKm: 22,
    ecology: Object.freeze({ grass: true, trunk: true, crown: true, shrub: true, rock: true }),
    faunaGroup: true,
    faunaIndividual: true
  })
]);

export function surfaceScaleBandForDistance(distanceKm) {
  const distance = Math.max(0, Number(distanceKm) || 0);
  return SURFACE_SCALE_BANDS.find((band) => distance >= band.minDistanceKm)
    ?? SURFACE_SCALE_BANDS[SURFACE_SCALE_BANDS.length - 1];
}

export function surfaceWaterPolicy({
  bandId,
  waterBody,
  baseElevationMeters = 0,
  seaLevelMeters = 0,
  lakeCoverageFraction = 0
} = {}) {
  const body = String(waterBody || "none");
  const base = Number(baseElevationMeters);
  const sea = Number(seaLevelMeters);
  const coverage = clamp(lakeCoverageFraction, 0, 1);

  if (body === "lake") {
    // A groundwater/network lake sample describes the selected local basin; it
    // is not a regional shoreline mask. Never inflate it into a 40–100 km flat
    // sheet. Materialize it only once the observer reaches ecology/local scale.
    if (bandId === "regional" || bandId === "landscape") {
      return Object.freeze({ visible: false, spanFraction: 0, reason: "local-lake-deferred" });
    }
    const maxFraction = bandId === "ground" ? 0.58 : 0.36;
    const inferredFraction = clamp(0.10 + Math.sqrt(coverage) * 0.38, 0.10, maxFraction);
    return Object.freeze({ visible: true, spanFraction: inferredFraction, reason: "local-lake" });
  }

  if (body === "ocean") {
    // The fallback ocean plane is only a valid proxy when the selected terrain
    // is actually oceanic or coastal. Inland selections must not inherit a sea-
    // level sheet merely because no lake was returned by the local hydrology.
    const coastalOrOcean = Number.isFinite(base) && Number.isFinite(sea) && base <= sea + 120;
    return Object.freeze({
      visible: coastalOrOcean,
      spanFraction: coastalOrOcean ? 1.08 : 0,
      reason: coastalOrOcean ? "coastal-ocean" : "inland-ocean-suppressed"
    });
  }

  return Object.freeze({ visible: false, spanFraction: 0, reason: "no-water" });
}

function cameraDistanceKm(cameraPosition, target) {
  if (!cameraPosition || !target) return 0;
  const dx = (Number(cameraPosition.x) || 0) - (Number(target.x) || 0);
  const dy = (Number(cameraPosition.y) || 0) - (Number(target.y) || 0);
  const dz = (Number(cameraPosition.z) || 0) - (Number(target.z) || 0);
  return Math.hypot(dx, dy, dz);
}

function ecologyVisible(band) {
  return Boolean(band && Object.values(band.ecology).some(Boolean));
}

class SurfaceScaleController {
  constructor({ scene, terrain, controls, water }) {
    this.scene = scene;
    this.terrain = terrain;
    this.controls = controls;
    this.water = water;
    this.band = null;
    this.distanceKm = 0;
    this.lastConfigurationSignature = "";
    this.waterPolicy = Object.freeze({ visible: false, spanFraction: 0, reason: "unresolved" });
  }

  apply(cameraPosition) {
    this.distanceKm = cameraDistanceKm(cameraPosition, this.controls?.target);
    const nextBand = surfaceScaleBandForDistance(this.distanceKm);
    this.band = nextBand;
    this._configureTerrain(nextBand);
    this._configureAtmosphere(nextBand);
    this._resolveWaterPolicy(nextBand);
    this._applyVisibility(nextBand);
    this._fitWaterToTerrain(nextBand);
    this.terrain.viewScaleBand = nextBand.id;
    this.terrain.viewDistanceKm = this.distanceKm;
    return nextBand;
  }

  terrainFocus(cameraPosition) {
    if (!cameraPosition || !this.band || !this.controls?.target) return cameraPosition;
    if (this.band.id !== "regional" && this.band.id !== "landscape") return cameraPosition;
    return {
      x: Number(this.controls.target.x) || 0,
      y: Number(cameraPosition.y) || 0,
      z: Number(this.controls.target.z) || 0
    };
  }

  _configureTerrain(band) {
    const terrain = this.terrain;
    const signature = [band.id, band.chunkSizeKm, band.radius, band.segments, band.verticalScale].join("|");
    const chunkChanged = Math.abs(Number(terrain.chunkSizeKm) - band.chunkSizeKm) > 1e-6;
    const verticalScaleChanged = Math.abs(Number(terrain.verticalScale) - band.verticalScale) > 1e-6;
    const radiusChanged = Number(terrain.radius) !== band.radius;
    const segmentsChanged = Number(terrain.segments) !== band.segments;

    if (chunkChanged || verticalScaleChanged) {
      terrain.chunkSizeKm = band.chunkSizeKm;
      terrain.verticalScale = band.verticalScale;
      terrain.clear?.();
      terrain.lastCenter = { x: Number.NaN, z: Number.NaN };
    }

    if (radiusChanged || segmentsChanged || chunkChanged || verticalScaleChanged || signature !== this.lastConfigurationSignature) {
      terrain.configure?.({ radius: band.radius, segments: band.segments });
      terrain.setContourSettings?.({ intervalMeters: band.contourIntervalMeters, opacity: band.contourOpacity });
      this.lastConfigurationSignature = signature;
    }
  }

  _configureAtmosphere(band) {
    if (!this.scene?.fog) return;
    this.scene.fog.near = band.fogNearKm;
    this.scene.fog.far = band.fogFarKm;
  }

  _resolveWaterPolicy(band = this.band) {
    this.waterPolicy = surfaceWaterPolicy({
      bandId: band?.id,
      waterBody: this.water?.userData?.waterBody,
      baseElevationMeters: this.terrain.baseElevationMeters,
      seaLevelMeters: this.terrain.earthState?.seaLevel,
      lakeCoverageFraction: this.water?.userData?.lakeCoverageFraction
    });
    return this.waterPolicy;
  }

  _applyVisibility(band = this.band) {
    if (!band) return;
    const ecology = this.terrain.surfaceEcology;
    for (const [name, mesh] of Object.entries(ecology?.pools ?? {})) {
      mesh.visible = Boolean(band.ecology[name]);
    }
    if (ecology?.river) ecology.river.visible = true;

    const fauna = this.terrain.surfaceFauna;
    for (const [name, pool] of Object.entries(fauna?.pools ?? {})) {
      const visible = name === "group" ? band.faunaGroup : band.faunaIndividual;
      for (const page of pool.pages ?? []) page.visible = visible;
    }

    if (this.water) this.water.visible = Boolean(this.waterPolicy.visible);
  }

  _fitWaterToTerrain(band = this.band) {
    if (!this.water || !band || !this.waterPolicy.visible) return;
    const geometryWidthKm = Number(this.water.geometry?.parameters?.width) || 220;
    const terrainSpanKm = band.chunkSizeKm * (band.radius * 2 + 1);
    const targetSpanKm = terrainSpanKm * this.waterPolicy.spanFraction;
    const scale = clamp(targetSpanKm / geometryWidthKm, 0.0015, 1);
    this.water.scale.set(scale, scale, scale);
  }
}

export function installSurfaceScaleController({ scene, terrain, controls, water }) {
  const controller = new SurfaceScaleController({ scene, terrain, controls, water });
  const baseUpdate = terrain.update.bind(terrain);
  const basePump = terrain.pump.bind(terrain);
  const baseDiagnostics = terrain.diagnostics.bind(terrain);
  const ecology = terrain.surfaceEcology;
  const fauna = terrain.surfaceFauna;
  const baseEcologyHasWork = ecology?.hasWork?.bind(ecology);
  const baseFaunaHasWork = fauna?.hasWork?.bind(fauna);

  if (baseEcologyHasWork) {
    ecology.hasWork = () => ecologyVisible(controller.band) && baseEcologyHasWork();
  }
  if (baseFaunaHasWork) {
    fauna.hasWork = () => Boolean(controller.band?.faunaGroup || controller.band?.faunaIndividual) && baseFaunaHasWork();
  }

  terrain.update = (cameraPosition) => {
    controller.apply(cameraPosition);
    const result = baseUpdate(controller.terrainFocus(cameraPosition));
    controller._fitWaterToTerrain();
    return result;
  };

  terrain.pump = (budgetMs) => {
    const result = basePump(budgetMs);
    controller._applyVisibility();
    return result;
  };

  terrain.diagnostics = () => Object.freeze({
    ...baseDiagnostics(),
    viewScaleBand: controller.band?.id ?? "unresolved",
    viewDistanceKm: controller.distanceKm,
    waterPresentation: Object.freeze({ ...controller.waterPolicy })
  });

  terrain.surfaceScaleController = controller;
  return controller;
}
