import * as THREE from "three";
import { RasterTaskClient } from "./RasterTaskClient.js";
import { AdaptivePerformanceController } from "./AdaptivePerformanceController.js";
import { createGlobePresentation } from "./GlobePresentation.js";
import { createSurfacePresentation } from "./SurfacePresentation.js";
import { beginDescent, updateDescent, updateSurfaceEntry, returnToGlobe } from "./ViewTransitions.js";
import { requestEarthRaster, requestCloudRaster } from "./RasterRefresh.js";
import { wireGlobePicking } from "./PointerRaycast.js";
import { geographicSelection } from "./GeoSelection.js";

const EARTH_INTERVAL_MS = 3_000;
const CLOUD_INTERVAL_MS = 15_000;
const EARTH_REFRESH_YEARS = 2_500;
const CLOUD_REFRESH_YEARS = 10_000;
const DIAGNOSTICS_INTERVAL_MS = 250;
const SURFACE_PUMP_ACTIVE_MS = 0.9;
const SURFACE_PUMP_IDLE_MS = 2.3;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class EarthView {
  constructor(canvas, initialState, onSelect, { onInvalidate = null, onModeChange = null } = {}) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.onInvalidate = onInvalidate;
    this.onModeChange = onModeChange;
    this.lastState = initialState;
    this.lastTextureYear = initialState.yearBP;
    this.lastCloudYear = initialState.yearBP;
    this.lastEarthRefreshMs = 0;
    this.lastCloudRefreshMs = 0;
    this.earthVersion = 0;
    this.cloudVersion = 0;
    this.earthBuildInFlight = false;
    this.cloudBuildInFlight = false;
    this.spatialDetail = 0.35;
    this.selectionDirection = null;
    this.selection = null;
    this.pointerStart = null;
    this.interacting = false;
    this.simulationPlaying = false;
    this.mode = "globe";
    this.descent = null;
    this.surfaceEntry = null;
    this.continuousUntilMs = 0;
    this.lastRenderMs = 0;
    this.lastFrameDeltaMs = 16.7;
    this.lastPerformanceSignature = "";
    this.diagnosticsCache = null;
    this.diagnosticsCacheAt = -Infinity;
    this.rasterWorker = new RasterTaskClient();
    this.performanceController = new AdaptivePerformanceController({ targetFps: 60, initialTier: "high" });

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    const globe = createGlobePresentation(canvas);
    Object.assign(this, globe);
    const surface = createSurfacePresentation(canvas);
    this.surfaceScene = surface.scene;
    this.surfaceCamera = surface.camera;
    this.surfaceControls = surface.controls;
    this.terrain = surface.terrain;
    this.surfaceWater = surface.water;
    this._wireControls(this.controls, "globe");
    this._wireControls(this.surfaceControls, "surface");

    wireGlobePicking(canvas, () => this.camera, () => this.earth, (hit) => {
      if (this.mode === "globe") this._applySelection(hit);
    });
    this.resize();
    this.applyPerformanceSettings(true);
    this.updateState(initialState, true, this.spatialDetail);
  }

  _wireControls(controls, mode) {
    controls.addEventListener("start", () => {
      if (this.mode !== mode) return;
      this.interacting = true;
      this.continuousUntilMs = performance.now() + 700;
      this.invalidate();
    });
    controls.addEventListener("change", () => { if (this.mode === mode) this.invalidate(); });
    controls.addEventListener("end", () => {
      if (this.mode !== mode) return;
      this.interacting = false;
      this.continuousUntilMs = performance.now() + 700;
      this.invalidate();
    });
  }

  invalidate() { this.onInvalidate?.(); }
  setInvalidateCallback(callback) { this.onInvalidate = callback; }
  isInteracting() { return this.interacting || this.descent != null || this.surfaceEntry != null; }
  setSimulationPlaying(playing) { this.simulationPlaying = Boolean(playing); if (playing) this.invalidate(); }
  focusSelection() { return this.descendToSelection(); }
  toggleSurface() { return this.mode === "surface" ? this.ascendToGlobe() : this.mode === "globe" ? this.descendToSelection() : false; }

  _applySelection(hit) {
    const selection = geographicSelection(hit);
    if (!selection) return;
    this.selectionDirection = selection.direction;
    this.selection = { latitude: selection.latitude, longitude: selection.longitude, normal: selection.direction.clone() };
    this.marker.position.copy(this.selectionDirection).multiplyScalar(1.445);
    this.marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.selectionDirection);
    this.marker.visible = true;
    this.continuousUntilMs = performance.now() + 1_000;
    this.onSelect?.({ latitude: selection.latitude, longitude: selection.longitude, normal: this.selectionDirection.clone() });
    this.invalidate();
  }

  descendToSelection() { return beginDescent(this); }
  ascendToGlobe() { return returnToGlobe(this); }

  setClimate(climate) { this.climate = climate; this.updateState(this.lastState, true, this.spatialDetail); }
  setHydroClimate(hydroClimate, spatialDetail = this.spatialDetail, refresh = true) {
    this.hydroClimate = hydroClimate;
    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);
    this.terrain.setScienceProviders?.({ hydrology: this.hydroClimate, vegetation: this.vegetation, spatialDetail: this.spatialDetail });
    if (refresh) this.updateState(this.lastState, true, this.spatialDetail);
  }
  setVegetation(vegetation, spatialDetail = this.spatialDetail, refresh = true) {
    this.vegetation = vegetation;
    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);
    this.terrain.setScienceProviders?.({ hydrology: this.hydroClimate, vegetation: this.vegetation, spatialDetail: this.spatialDetail });
    if (refresh) this.updateState(this.lastState, true, this.spatialDetail);
  }

  updateState(state, force = false, spatialDetail = this.spatialDetail) {
    this.lastState = state;
    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);
    this.terrain.setScienceProviders?.({ hydrology: this.hydroClimate, vegetation: this.vegetation, spatialDetail: this.spatialDetail });
    const needsSurfaceContext = this.mode !== "globe";
    this.terrain.setEarthSystemState?.(state, state.seed, needsSurfaceContext);
    this.applyPerformanceSettings(false);
    const now = performance.now();
    if ((force || Math.abs(state.yearBP - this.lastTextureYear) >= EARTH_REFRESH_YEARS) && !this.interacting && (force || now - this.lastEarthRefreshMs >= EARTH_INTERVAL_MS)) this._requestEarthRaster(state);
    if ((force || Math.abs(state.yearBP - this.lastCloudYear) >= CLOUD_REFRESH_YEARS) && !this.interacting && (force || now - this.lastCloudRefreshMs >= CLOUD_INTERVAL_MS)) this._requestCloudRaster(state);
    if (this.mode === "surface" && this.terrain.origin) this.updateSurfaceWater();
    this.invalidate();
  }

  _requestEarthRaster(state) { requestEarthRaster(this, state); }
  _requestCloudRaster(state) { requestCloudRaster(this, state); }

  updateSurfaceWater() {
    if (!this.terrain.origin) return;
    const { latitude, longitude } = this.terrain.origin;
    const waterSystem = this.terrain.currentWaterSystem?.()
      ?? this.hydroClimate?.groundwaterLakeSample?.(this.lastState, latitude, longitude, this.spatialDetail)
      ?? null;
    const lakeSurface = Number(waterSystem?.lakeSurfaceElevationMeters);
    const lakeCoverage = Number(waterSystem?.lakeCoverageFraction) || 0;
    const lakeAreaKm2 = Number(waterSystem?.lakeAreaKm2) || 0;
    const hasLake = Number.isFinite(lakeSurface) && lakeCoverage > 0.005 && lakeAreaKm2 > 0;
    const surfaceElevationMeters = hasLake ? lakeSurface : Number(this.lastState.seaLevel) || 0;
    this.surfaceWater.position.set(0, (surfaceElevationMeters - this.terrain.baseElevationMeters) / 1000 * this.terrain.verticalScale, 0);
    if (hasLake) {
      const diameterKm = 2 * Math.sqrt(lakeAreaKm2 / Math.PI);
      const scale = clamp(diameterKm / 220, 0.0025, 1);
      this.surfaceWater.scale.set(scale, scale, scale);
      this.surfaceWater.userData.waterBody = "lake";
      this.surfaceWater.userData.lakeCoverageFraction = lakeCoverage;
    } else {
      this.surfaceWater.scale.set(1, 1, 1);
      this.surfaceWater.userData.waterBody = "ocean";
      this.surfaceWater.userData.lakeCoverageFraction = 0;
    }
  }

  applyPerformanceSettings(force = false) {
    const settings = this.performanceController.settings(this.spatialDetail);
    const ratio = Math.min(devicePixelRatio || 1, 1, settings.pixelRatioCap);
    const signature = [
      settings.visualLod,
      ratio.toFixed(3),
      settings.effectiveTerrainRadius,
      settings.effectiveTerrainSegments,
      settings.quality >= 0.55 ? 1 : 0
    ].join("|");
    if (!force && signature === this.lastPerformanceSignature) return false;
    this.lastPerformanceSignature = signature;
    if (force || Math.abs(this.renderer.getPixelRatio() - ratio) > 0.02) { this.renderer.setPixelRatio(ratio); this.resize(); }
    this.clouds.visible = settings.quality >= 0.55;
    this.atmosphere.visible = settings.quality >= 0.55;
    this.terrain.configure({ radius: settings.effectiveTerrainRadius, segments: settings.effectiveTerrainSegments });
    this.diagnosticsCacheAt = -Infinity;
    return true;
  }

  resize() {
    const width = this.canvas.clientWidth || innerWidth;
    const height = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.surfaceCamera.aspect = this.camera.aspect;
    this.camera.updateProjectionMatrix();
    this.surfaceCamera.updateProjectionMatrix();
    this.diagnosticsCacheAt = -Infinity;
    this.invalidate();
  }

  render(deltaSeconds, now = performance.now()) {
    this.lastFrameDeltaMs = Math.max(0.1, deltaSeconds * 1000);
    const started = performance.now();
    let continuous = false;
    const needsSurfaceContext = this.mode !== "globe";
    if (this.terrain.surfaceContextActive !== needsSurfaceContext) this.terrain.setSurfaceContextActive?.(needsSurfaceContext, true);
    if (this.mode === "descent") continuous = updateDescent(this, now) || continuous;
    if (this.mode === "globe" || this.mode === "descent") {
      if (this.mode === "globe") continuous = this.controls.update() === true || continuous;
      if (this.simulationPlaying || this.interacting || this.mode === "descent") { this.clouds.rotation.y += deltaSeconds * 0.004; continuous = true; }
      if (this.marker.visible && (this.interacting || now < this.continuousUntilMs || this.mode === "descent")) { this.marker.scale.setScalar(1 + Math.sin(now * 0.004) * 0.16); continuous = true; }
      this.renderer.render(this.scene, this.camera);
    } else {
      continuous = updateSurfaceEntry(this, now) || continuous;
      continuous = (this.surfaceControls.enabled && this.surfaceControls.update() === true) || continuous;
      const floor = this.terrain.heightAt(this.surfaceCamera.position.x, this.surfaceCamera.position.z) + 0.18;
      if (this.surfaceCamera.position.y < floor) this.surfaceCamera.position.y = floor;
      this.terrain.update(this.surfaceCamera.position);
      const pumpBudget = this.interacting ? SURFACE_PUMP_ACTIVE_MS : SURFACE_PUMP_IDLE_MS;
      const pumped = this.terrain.pump(pumpBudget);
      continuous = pumped > 0 || this.terrain.hasPendingWork?.() === true || this.simulationPlaying || continuous;
      this.renderer.render(this.surfaceScene, this.surfaceCamera);
    }
    this.lastRenderMs = performance.now() - started;
    if ((this.interacting || this.descent || this.surfaceEntry) && this.lastFrameDeltaMs < 80 && this.performanceController.sample(this.lastFrameDeltaMs, now)) { this.applyPerformanceSettings(false); continuous = true; }
    return continuous || now < this.continuousUntilMs;
  }

  diagnostics(force = false) {
    const now = performance.now();
    if (!force && this.diagnosticsCache && now - this.diagnosticsCacheAt < DIAGNOSTICS_INTERVAL_MS) return this.diagnosticsCache;
    const info = this.renderer.info.render;
    this.diagnosticsCache = Object.freeze({
      mode: this.mode, renderMs: this.lastRenderMs, frameDeltaMs: this.lastFrameDeltaMs,
      pixelRatio: this.renderer.getPixelRatio(), drawCalls: info.calls, triangles: info.triangles,
      geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures,
      earthBuildInFlight: this.earthBuildInFlight, cloudBuildInFlight: this.cloudBuildInFlight,
      raster: this.rasterWorker.diagnostics(), performance: this.performanceController.diagnostics(), terrain: this.terrain.diagnostics()
    });
    this.diagnosticsCacheAt = now;
    return this.diagnosticsCache;
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.rasterWorker.dispose();
    this.terrain.dispose();
    this.controls.dispose();
    this.surfaceControls.dispose();
    this.renderer.dispose();
  }
}
