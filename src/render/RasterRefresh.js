import { textureFromRaster } from "./GlobePresentation.js";

const RASTER_APPLY_RETRY_MS = 80;
const CLOUD_MIN_VISUAL_QUALITY = 0.80;

function applyWhenViewSettles(view, versionKey, version, apply) {
  const tryApply = () => {
    if (version !== view[versionKey]) return;
    const stillMoving = Boolean(view.interacting)
      || performance.now() < (Number(view.continuousUntilMs) || 0);
    if (stillMoving) {
      setTimeout(tryApply, RASTER_APPLY_RETRY_MS);
      return;
    }
    apply();
  };
  tryApply();
}

export function requestEarthRaster(view, state) {
  const version = ++view.earthVersion;
  view.earthBuildInFlight = true;
  view.lastEarthRefreshMs = performance.now();
  view.rasterWorker.buildEarth(state).then((message) => {
    if (version !== view.earthVersion || message.type === "error") return;
    applyWhenViewSettles(view, "earthVersion", version, () => {
      const next = textureFromRaster(message);
      const previous = view.earthMaterial.map;
      view.earthMaterial.map = next;
      view.earthMaterial.color.setHex(0xffffff);
      view.earthMaterial.needsUpdate = true;
      view.surfacePlanetaryFarField?.setTexture?.(next);
      previous?.dispose();
      view.lastTextureYear = state.yearBP;
      view.invalidate();
    });
  }).finally(() => {
    if (version === view.earthVersion) view.earthBuildInFlight = false;
  });
}

export function requestCloudRaster(view, state) {
  const quality = view.performanceController.settings(view.spatialDetail);

  // Clouds are decorative and used to compete with the scientifically important
  // Earth raster during first load. Keep them completely out of the worker/GPU
  // path unless the renderer has reached the top visual tier on a non-mobile device.
  if (view.mobileProfile || quality.quality < CLOUD_MIN_VISUAL_QUALITY) {
    view.cloudVersion += 1;
    view.cloudBuildInFlight = false;
    view.lastCloudRefreshMs = performance.now();
    view.lastCloudYear = state.yearBP;
    if (view.cloudMaterial) {
      view.cloudMaterial.map?.dispose?.();
      view.cloudMaterial.map = null;
      view.cloudMaterial.opacity = 0;
      view.cloudMaterial.needsUpdate = true;
    }
    if (view.clouds) view.clouds.visible = false;
    return;
  }

  const version = ++view.cloudVersion;
  view.cloudBuildInFlight = true;
  view.lastCloudRefreshMs = performance.now();
  view.rasterWorker.buildClouds(state, quality.cloudScale).then((message) => {
    if (version !== view.cloudVersion || message.type === "error") return;
    applyWhenViewSettles(view, "cloudVersion", version, () => {
      const next = textureFromRaster(message);
      view.cloudMaterial.map?.dispose();
      view.cloudMaterial.map = next;
      view.cloudMaterial.color.setHex(0xffffff);
      view.cloudMaterial.opacity = 0.58;
      view.cloudMaterial.needsUpdate = true;
      view.clouds.visible = true;
      view.lastCloudYear = state.yearBP;
      view.invalidate();
    });
  }).finally(() => {
    if (version === view.cloudVersion) view.cloudBuildInFlight = false;
  });
}
