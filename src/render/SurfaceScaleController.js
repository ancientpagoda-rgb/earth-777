const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export const SURFACE_SCALE_BANDS = Object.freeze([
  Object.freeze({
    id: "regional",
    minDistanceKm: 6,
    // Keep the familiar ~84 km regional framing, but stream a much larger
    // low-cost terrain field behind it so the selected region no longer reads
    // as a floating square. Five 84 km chunks span ~420 km around the focus.
    frameSpanKm: 84,
    chunkSizeKm: 84,
    radius: 2,
    segments: 18,
    verticalScale: 0.90,
    contourIntervalMeters: 200,
    contourOpacity: 0.025,
    fogNearKm: 150,
    fogFarKm: 520,
    earthLayersAllowed: true,
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
    contourOpacity: 0.06,
    fogNearKm: 18,
    fogFarKm: 130,
    earthLayersAllowed: true,
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
    earthLayersAllowed: false,
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
    earthLayersAllowed: false,
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

export function surfaceScaleBandForDistanceStable(distanceKm, currentBand = null, hysteresisFraction = 0.14) {
  const distance = Math.max(0, Number(distanceKm) || 0);
  const candidate = surfaceScaleBandForDistance(distance);
  if (!currentBand || candidate.id === currentBand.id) return candidate;

  const currentIndex = SURFACE_SCALE_BANDS.findIndex((band) => band.id === currentBand.id);
  const candidateIndex = SURFACE_SCALE_BANDS.findIndex((band) => band.id === candidate.id);
  if (currentIndex < 0 || candidateIndex < 0) return candidate;

  const hysteresis = clamp(hysteresisFraction, 0, 0.35);
  if (candidateIndex > currentIndex) {
    // Zooming inward: stay on the coarser band until the camera is clearly past
    // its nominal boundary. This prevents wheel/pinch noise from repeatedly
    // clearing and rebuilding terrain around the exact threshold.
    const inwardBoundary = currentBand.minDistanceKm * (1 - hysteresis);
    return distance <= inwardBoundary ? candidate : currentBand;
  }

  // Zooming outward: require the reciprocal margin before promoting to the
  // coarser band, so crossing the same boundary in the opposite direction does
  // not immediately undo the previous transition.
  const outwardBoundary = candidate.minDistanceKm * (1 + hysteresis);
  return distance >= outwardBoundary ? candidate : currentBand;
}

export function surfaceScaleBandById(id = "regional") {
  return SURFACE_SCALE_BANDS.find((band) => band.id === id) ?? SURFACE_SCALE_BANDS[0];
}

export function surfaceStreamingSpanKm(bandOrId = "regional") {
  const band = typeof bandOrId === "string" ? surfaceScaleBandById(bandOrId) : bandOrId;
  return Number(band?.chunkSizeKm) * (Number(band?.radius) * 2 + 1);
}

export function surfacePresentationSpanKm(bandOrId = "regional") {
  const band = typeof bandOrId === "string" ? surfaceScaleBandById(bandOrId) : bandOrId;
  const framed = Number(band?.frameSpanKm);
  return Number.isFinite(framed) && framed > 0 ? framed : surfaceStreamingSpanKm(band);
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
  // Camera framing is deliberately decoupled from the streaming footprint.
  // Regional terrain can extend far beyond the viewport without pushing the
  // camera farther away and turning the selected area back into a postage stamp.
  const spanKm = surfacePresentationSpanKm(band);
  const halfSpanKm = spanKm * 0.5;
  const safeFill = clamp(fill, 0.42, 0.96);
  const verticalFov = Math.max(0.1, Number(fovDegrees) || 58) * Math.PI / 180;
  const safeAspect = Math.max(0.45, Number(aspect) || 1);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * safeAspect);
  const elevation = clamp(elevationDegrees, 28, 86) * Math.PI / 180;
  const azimuth = Number(azimuthDegrees) * Math.PI / 180;
  const widthDistance = halfSpanKm / (Math.tan(horizontalFov * 0.5) * safeFill);
  const depthDistance = halfSpanKm * Math.sin(elevation) / (Math.tan(verticalFov * 0.5) * safeFill);
  const distanceKm = Math.max(spanKm * 0.62, widthDistance, depthDistance);
  const horizontalKm = distanceKm * Math.cos(elevation);

  return Object.freeze({
    bandId: band.id,
    spanKm,
    streamingSpanKm: surfaceStreamingSpanKm(band),
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
      return Object.freeze({ visible: false, spanFraction: 0, presentation: "hidden", reason: "local-lake-deferred" });
    }
    const maxFraction = bandId === "ground" ? 0.58 : 0.36;
    const inferredFraction = clamp(0.10 + Math.sqrt(coverage) * 0.38, 0.10, maxFraction);
    return Object.freeze({ visible: true, spanFraction: inferredFraction, presentation: "surface", reason: "local-lake" });
  }

  if (body === "ocean") {
    const coastalOrOcean = Number.isFinite(base) && Number.isFinite(sea) && base <= sea + 120;
    if (!coastalOrOcean) {
      return Object.freeze({ visible: false, spanFraction: 0, presentation: "hidden", reason: "inland-ocean-suppressed" });
    }
    const referenceOnly = bandId === "regional" || bandId === "landscape";
    return Object.freeze({
      visible: true,
      spanFraction: 1,
      presentation: referenceOnly ? "reference-outline" : "surface",
      reason: referenceOnly ? "regional-sea-level-reference" : "coastal-ocean"
    });
  }

  return Object.freeze({ visible: false, spanFraction: 0, presentation: "hidden", reason: "no-water" });
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
  constructor({ scene, terrain, controls, water, seaLevelOutline = null, earthLayers = null }) {
    this.scene = scene;
    this.terrain = terrain;
    this.controls = controls;
    this.water = water;
    this.seaLevelOutline = seaLevelOutline;
    this.earthLayers = earthLayers;
    this.earthLayerInspectionEnabled = false;
    this.band = null;
    this.distanceKm = 0;
    this.lastConfigurationSignature = "";
    this.waterPolicy = Object.freeze({ visible: false, spanFraction: 0, presentation: "hidden", reason: "unresolved" });
  }

  _earthLayersVisible(band = this.band) {
    return Boolean(this.earthLayerInspectionEnabled && band?.earthLayersAllowed);
  }

  setEarthLayerInspection(enabled) {
    this.earthLayerInspectionEnabled = Boolean(enabled);
    this._configureEarthLayers(this.band);
    this._applyVisibility(this.band);
    return this.earthLayerInspectionEnabled;
  }

  toggleEarthLayerInspection() {
    return this.setEarthLayerInspection(!this.earthLayerInspectionEnabled);
  }

  apply(cameraPosition) {
    this.distanceKm = cameraDistanceKm(cameraPosition, this.controls?.target);
    const nextBand = surfaceScaleBandForDistanceStable(this.distanceKm, this.band);
    this.band = nextBand;
    this._configureTerrain(nextBand);
    this._configureAtmosphere(nextBand);
    this._resolveWaterPolicy(nextBand);
    this._configureEarthLayers(nextBand);
    this._applyVisibility(nextBand);
    this._fitWaterToTerrain(nextBand);
    this._fitSeaLevelOutline(nextBand);
    this.terrain.viewScaleBand = nextBand.id;
    this.terrain.viewDistanceKm = this.distanceKm;
    return nextBand;
  }

  terrainFocus(cameraPosition) {
    if (!cameraPosition || !this.band || !this.controls?.target) return cameraPosition;
    if (this.band.id !== "regional" && this.band.id !== "landscape") return cameraPosition;
    // Stream the broad terrain field around the point the user is actually
    // inspecting. Orbiting changes the camera x/z but should not churn chunks;
    // panning moves the target and naturally advances the world-stream window.
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
    const spanKm = surfacePresentationSpanKm(band);
    const groundY = this.terrain.origin ? this.terrain.heightAt(0, 0) : 0;
    const layout = this.earthLayers.configure({
      spanKm,
      groundY,
      baseElevationMeters: this.terrain.baseElevationMeters,
      seaLevelMeters: this.terrain.earthState?.seaLevel,
      visible: this._earthLayersVisible(band)
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

    if (this.water) this.water.visible = Boolean(this.waterPolicy.visible && this.waterPolicy.presentation === "surface");
    if (this.seaLevelOutline) this.seaLevelOutline.visible = Boolean(this.waterPolicy.visible && this.waterPolicy.presentation === "reference-outline");
    if (this.earthLayers?.group) this.earthLayers.group.visible = this._earthLayersVisible(band);
  }

  _fitWaterToTerrain(band = this.band) {
    if (!this.water || !band || !this.waterPolicy.visible || this.waterPolicy.presentation !== "surface") return;
    const geometryWidthKm = Number(this.water.geometry?.parameters?.width) || 220;
    const terrainSpanKm = surfacePresentationSpanKm(band);
    const targetSpanKm = terrainSpanKm * this.waterPolicy.spanFraction;
    const scale = clamp(targetSpanKm / geometryWidthKm, 0.0015, 1);
    this.water.scale.set(scale, scale, scale);
  }

  _fitSeaLevelOutline(band = this.band) {
    if (!this.seaLevelOutline || !band) return;
    const terrainSpanKm = surfacePresentationSpanKm(band);
    this.seaLevelOutline.scale.set(terrainSpanKm * 0.985, 1, terrainSpanKm * 0.985);
    this.seaLevelOutline.position.set(0, Number(this.water?.position?.y) || 0, 0);
  }
}

export function installSurfaceScaleController({ scene, terrain, controls, water, seaLevelOutline = null, earthLayers = null }) {
  const controller = new SurfaceScaleController({ scene, terrain, controls, water, seaLevelOutline, earthLayers });
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
    controller._fitSeaLevelOutline();
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
    presentationSpanKm: controller.band ? surfacePresentationSpanKm(controller.band) : 0,
    streamingSpanKm: controller.band ? surfaceStreamingSpanKm(controller.band) : 0,
    defaultRegionalPresentation: "buffered-continuous-landscape",
    earthLayerInspectionEnabled: controller.earthLayerInspectionEnabled,
    waterPresentation: Object.freeze({ ...controller.waterPolicy }),
    earthLayers: earthLayers?.diagnostics?.() ?? Object.freeze({ visible: false })
  });

  if (baseDispose) {
    terrain.dispose = () => {
      earthLayers?.dispose?.();
      seaLevelOutline?.geometry?.dispose?.();
      seaLevelOutline?.material?.dispose?.();
      baseDispose();
    };
  }

  terrain.surfaceScaleController = controller;
  terrain.surfaceEarthLayers = earthLayers;
  terrain.surfaceSeaLevelOutline = seaLevelOutline;
  terrain.setEarthLayerInspection = (enabled) => controller.setEarthLayerInspection(enabled);
  terrain.toggleEarthLayerInspection = () => controller.toggleEarthLayerInspection();
  return controller;
}
