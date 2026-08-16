import { textureFromRaster } from "./GlobePresentation.js";

const RASTER_APPLY_RETRY_MS = 80;

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
      view.earthMaterial.map?.dispose();
      view.earthMaterial.map = next;
      view.earthMaterial.color.setHex(0xffffff);
      view.earthMaterial.needsUpdate = true;
      view.lastTextureYear = state.yearBP;
      view.invalidate();
    });
  }).finally(() => {
    if (version === view.earthVersion) view.earthBuildInFlight = false;
  });
}

export function requestCloudRaster(view, state) {
  const version = ++view.cloudVersion;
  view.cloudBuildInFlight = true;
  view.lastCloudRefreshMs = performance.now();
  const quality = view.performanceController.settings(view.spatialDetail);
  view.rasterWorker.buildClouds(state, quality.cloudScale).then((message) => {
    if (version !== view.cloudVersion || message.type === "error") return;
    applyWhenViewSettles(view, "cloudVersion", version, () => {
      const next = textureFromRaster(message);
      view.cloudMaterial.map?.dispose();
      view.cloudMaterial.map = next;
      view.cloudMaterial.color.setHex(0xffffff);
      view.cloudMaterial.opacity = 0.58;
      view.cloudMaterial.needsUpdate = true;
      view.lastCloudYear = state.yearBP;
      view.invalidate();
    });
  }).finally(() => {
    if (version === view.cloudVersion) view.cloudBuildInFlight = false;
  });
}
