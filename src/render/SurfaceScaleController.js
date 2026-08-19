const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export const SURFACE_SCALE_BANDS = Object.freeze([
  Object.freeze({
    id: "regional",
    minDistanceKm: 6,
    chunkSizeKm: 28,
    radius: 1,
    segments: 32,
    verticalScale: 0.90,
    contourIntervalMeters: 200,
    contourOpacity: 0.09,
    fogNearKm: 110,
    fogFarKm: 360,
    earthLayers: true,
    ecology: Object.freeze({ grass: false, trunk: false, crown: false, shrub: false, rock: false }),
    faunaGroup: false,
    faunaIndividual: false
  }),
  Object.freeze({
    id: "landscape",
    minDistanceKm: 1.6,
    chunkSizeKm: 8,
    radius: 2,
    segments: 24,
    verticalScale: 0.76,
    contourIntervalMeters: 100,
    contourOpacity: 0.12,
    fogNearKm: 18,
    fogFarKm: 130,
    earthLayers: true,
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
    earthLayers: false,
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
    earthLayers: false,
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

export function surfaceScaleBandById(id = "regional") {
  return SURFACE_SCALE_BANDS.find((band) => band.id === id) ?? SURFACE_SCALE_BANDS[0];
}

export function surfaceFrameForBand({
  bandId = "regional",
  fovDegrees = 58,
  aspect = 16 / 9,
  fill = 0.76,
  elevationDegrees = 52,
  azimuthDegrees = 8,
  groundY = 0
} = {}) {
  const band = surfaceScaleBandById(bandId);
  const spanKm = band.chunkSizeKm * (band.radius * 2 + 1);
  const halfSpanKm = spanKm * 0.5;
  const safeFill = clamp(fill, 0.42, 0.90);
  const verticalFov = Math.max(0.1, Number(fovDegrees) || 58) * Math.PI / 180;
  const safeAspect = Math.max(0.45, Number(aspect) || 1);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * safeAspect);
  const elevation = clamp(elevationDegrees, 28, 78) * Math.PI / 180;
  const azimuth = Number(azimuthDegrees) * Math.PI / 180;
  const widthDistance = halfSpanKm / (Math.tan(horizontalFov * 0.5) * safeFill);
  const depthDistance = halfSpanKm * Math.sin(elevation) / (Math.tan(verticalFov * 0.5) * safeFill);
  const distanceKm = Math.max(spanKm * 0.62, widthDistance, depthDistance);
  const horizontalKm = distanceKm * Math.cos(elevation);

  return Object.freeze({
    bandId: band.id,
    spanKm,
    distanceKm,
    position: Object.freeze({
      x: Math.sin(azimuth) * horizontalKm,
      y: Number(groundY) + distanceKm * Math.sin(elevation),
      z: Math.cos(azimuth) * horizontalKm
    }),
    target: Object.freeze({ x: 0, y: Number(groundY) + 0.02, z: 0 })
  });
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
    if (bandId === "regional" || bandId === "landscape") {
      return Object.freeze({ visible: false, spanFraction: 0, reason: "local-lake-deferred" });
    }
    const maxFraction = bandId === "ground" ? 0.58 : 0.36;
    const inferredFraction = clamp(0.10 + Math.sqrt(coverage) * 0.38, 0.10, maxFraction);
    return Object.freeze({ visible: true, spanFraction: inferredFraction, reason: "local-lake" });
  }

  if (body === "ocean") {
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
  constructor({ scene, terrain, controls, water, earthLayers = null }) {
    this.scene = scene;
    this.terrain = terrain;
    this.controls = controls;
    this.water = water;
    this.earthLayers = earthLayers;
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
    this._configureEarthLayers(nextBand);
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

  _configureEarthLayers(band = this.band) {
    if (!this.earthLayers || !band) return null;
    const spanKm = band.chunkSizeKm * (band.radius * 2 + 1);
    const groundY = this.terrain.origin ? this.terrain.heightAt(0, 0) : 0;
    const layout = this.earthLayers.configure({
      spanKm,
      groundY,
      baseElevationMeters: this.terrain.baseElevationMeters,
      seaLevelMeters: this.terrain.earthState?.seaLevel,
      visible: Boolean(band.earthLayers)
    });
    this.terrain.surfaceEarthLayerLayout = layout;
    return layout;
  }

  _applyVisibility(band = this.band) {
    if (!band) return;
    const ecology = this.terrain.surfaceEcology;
    for (const [name, mesh] of Object.entries(ecology?.pools ?? {})) mesh.visible = Boolean(band.ecology[name]);
    if (ecology?.river) ecology.river.visible = true;

    const fauna = this.terrain.surfaceFauna;
    for (const [name, pool] of Object.entries(fauna?.pools ?? {})) {
      const visible = name === "group" ? band.faunaGroup : band.faunaIndividual;
      for (const page of pool.pages ?? []) page.visible = visible;
    }

    if (this.water) this.water.visible = Boolean(this.waterPolicy.visible);
    if (this.earthLayers?.group) this.earthLayers.group.visible = Boolean(band.earthLayers);
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

export function installSurfaceScaleController({ scene, terrain, controls, water, earthLayers = null }) {
  const controller = new SurfaceScaleController({ scene, terrain, controls, water, earthLayers });
  const baseUpdate = terrain.update.bind(terrain);
  const basePump = terrain.pump.bind(terrain);
  const baseDiagnostics = terrain.diagnostics.bind(terrain);
  const baseDispose = terrain.dispose?.bind(terrain);
  const ecology = terrain.surfaceEcology;
  const fauna = terrain.surfaceFauna;
  const baseEcologyHasWork = ecology?.hasWork?.bind(ecology);
  const baseFaunaHasWork = fauna?.hasWork?.bind(fauna);

  if (baseEcologyHasWork) ecology.hasWork = () => ecologyVisible(controller.band) && baseEcologyHasWork();
  if (baseFaunaHasWork) fauna.hasWork = () => Boolean(controller.band?.faunaGroup || controller.band?.faunaIndividual) && baseFaunaHasWork();

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
    waterPresentation: Object.freeze({ ...controller.waterPolicy }),
    earthLayers: earthLayers?.diagnostics?.() ?? Object.freeze({ visible: false })
  });

  if (baseDispose) {
    terrain.dispose = () => {
      earthLayers?.dispose?.();
      baseDispose();
    };
  }

  terrain.surfaceScaleController = controller;
  terrain.surfaceEarthLayers = earthLayers;
  return controller;
}
