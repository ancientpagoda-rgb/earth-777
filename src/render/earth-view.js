import * as THREE from "three";
import { RasterTaskClient } from "./RasterTaskClient.js";
import { AdaptivePerformanceController } from "./AdaptivePerformanceController.js";
import { createGlobePresentation } from "./GlobePresentation.js";
import { requestEarthRaster, requestCloudRaster } from "./RasterRefresh.js";
import { wireGlobePicking } from "./PointerRaycast.js";
import { geographicSelection } from "./GeoSelection.js";

const EARTH_INTERVAL_MS = 3_000;
const CLOUD_INTERVAL_MS = 15_000;
const EARTH_REFRESH_YEARS = 2_500;
const CLOUD_REFRESH_YEARS = 10_000;
const DIAGNOSTICS_INTERVAL_MS = 250;
const INTERACTION_SETTLE_MS = 900;
const SURFACE_PUMP_ACTIVE_MS = 0.9;
const SURFACE_PUMP_IDLE_MS = 2.3;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const EMPTY_TERRAIN_DIAGNOSTICS = Object.freeze({ loaded: false, loadedChunks: 0, queuedChunks: 0, radius: 0, segments: 0 });

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
    this.surfaceLoading = false;
    this.surfaceRuntimePromise = null;
    this.surfaceTransitionPromise = null;
    this.surfacePrewarmHandle = null;
    this.surfaceTransitions = null;
    this.surfaceScene = null;
    this.surfaceCamera = null;
    this.surfaceControls = null;
    this.terrain = null;
    this.surfaceWater = null;
    this.continuousUntilMs = 0;
    this.lastRenderMs = 0;
    this.lastFrameDeltaMs = 16.7;
    this.lastPerformanceSignature = "";
    this.diagnosticsCache = null;
    this.diagnosticsCacheAt = -Infinity;
    this.rasterWorker = new RasterTaskClient();
    this.performanceController = new AdaptivePerformanceController({ targetFps: 60, initialTier: "high" });
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    const globe = createGlobePresentation(canvas);
    Object.assign(this, globe);
    this._wireControls(this.controls, "globe");

    wireGlobePicking(canvas, () => this.camera, () => this.earth, (hit) => {
      if (this.mode === "globe") this._applySelection(hit);
    });
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    this.resize();
    this.applyPerformanceSettings(true);
    this.updateState(initialState, true, this.spatialDetail);
  }

  _wireControls(controls, mode) {
    controls.addEventListener("start", () => {
      if (this.mode !== mode) return;
      this.interacting = true;
      this.continuousUntilMs = performance.now() + INTERACTION_SETTLE_MS;
      this.invalidate();
    });
    controls.addEventListener("change", () => { if (this.mode === mode) this.invalidate(); });
    controls.addEventListener("end", () => {
      if (this.mode !== mode) return;
      this.interacting = false;
      this.continuousUntilMs = performance.now() + INTERACTION_SETTLE_MS;
      this.invalidate();
    });
  }

  async _ensureSurfaceRuntime() {
    if (this.terrain && this.surfaceTransitions) return true;
    this.surfaceRuntimePromise ??= Promise.all([
      import("./SurfacePresentation.js"),
      import("./ViewTransitions.js")
    ]).then(([surfaceModule, transitions]) => {
      if (!this.terrain) {
        const surface = surfaceModule.createSurfacePresentation(this.canvas);
        this.surfaceScene = surface.scene;
        this.surfaceCamera = surface.camera;
        this.surfaceControls = surface.controls;
        this.terrain = surface.terrain;
        this.surfaceWater = surface.water;
        this._wireControls(this.surfaceControls, "surface");
        this.terrain.setScienceProviders?.({ hydrology: this.hydroClimate, vegetation: this.vegetation, spatialDetail: this.spatialDetail });
        this.terrain.setEarthSystemState?.(this.lastState, this.lastState.seed, false);
        this.applyPerformanceSettings(true);
        this.resize();
      }
      this.surfaceTransitions = transitions;
      this.diagnosticsCacheAt = -Infinity;
      return true;
    }).catch((error) => {
      this.surfaceRuntimePromise = null;
      throw error;
    });
    return this.surfaceRuntimePromise;
  }

  _scheduleSurfaceRuntimeWarmup() {
    if (this.terrain || this.surfaceRuntimePromise || this.surfacePrewarmHandle != null) return;
    const warm = () => {
      this.surfacePrewarmHandle = null;
      if (this.mode !== "globe" || !this.selection) return;
      this._ensureSurfaceRuntime().catch((error) => console.info("Surface runtime prewarm deferred after an initialization error.", error));
    };
    if (typeof requestIdleCallback === "function") {
      this.surfacePrewarmHandle = requestIdleCallback(warm, { timeout: 260 });
    } else {
      this.surfacePrewarmHandle = setTimeout(warm, 0);
    }
  }

  invalidate() { this.onInvalidate?.(); }
  setInvalidateCallback(callback) { this.onInvalidate = callback; }
  isInteracting(now = performance.now()) { return this.interacting || now < this.continuousUntilMs || this.descent != null || this.surfaceEntry != null; }
  setSimulationPlaying(playing) { this.simulationPlaying = Boolean(playing); if (playing) this.invalidate(); }
  focusSelection() { return this.descendToSelection(); }
  toggleSurface() {
    if (this.surfaceTransitionPromise) return this.surfaceTransitionPromise;
    return this.mode === "surface" ? this.ascendToGlobe() : this.mode === "globe" ? this.descendToSelection() : false;
  }

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
    // A selected region is a strong signal that the surface will probably be
    // opened next. Construct the lazy surface runtime during the first idle
    // opportunity so the user's button press does not pay that setup cost.
    this._scheduleSurfaceRuntimeWarmup();
  }

  selectNormalized(pointerX, pointerY) {
    if (this.mode !== "globe") return false;
    this.pointer.x = pointerX;
    this.pointer.y = pointerY;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.earth)[0];
    if (!hit) return false;
    this._applySelection(hit);
    return true;
  }

  selectViewCenter() { return this.selectNormalized(0, 0); }

  descendToSelection() {
    if (this.surfaceTransitionPromise) return this.surfaceTransitionPromise;
    if (!this.selectionDirection || !this.selection || this.mode !== "globe") return false;

    this.surfaceLoading = true;
    this.onModeChange?.("surface-loading", this.selection);
    this.invalidate();

    const transition = (async () => {
      try {
        // Let the loading label/disabled state reach the screen before any
        // synchronous Three.js/worker construction can monopolize the main thread.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await this._ensureSurfaceRuntime();
        if (this.mode !== "globe" || !this.selectionDirection || !this.selection) return false;
        return this.surfaceTransitions.beginDescent(this);
      } catch (error) {
        this.onModeChange?.("globe", this.selection);
        throw error;
      } finally {
        this.surfaceLoading = false;
        if (this.surfaceTransitionPromise === transition) this.surfaceTransitionPromise = null;
      }
    })();

    this.surfaceTransitionPromise = transition;
    return transition;
  }

  ascendToGlobe() { return this.surfaceTransitions?.returnToGlobe(this) ?? false; }

  setClimate(climate) { this.climate = climate; this.updateState(this.lastState, true, this.spatialDetail); }
  setHydroClimate(hydroClimate, spatialDetail = this.spatialDetail, refresh = true) {
    this.hydroClimate = hydroClimate;
    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);
    this.terrain?.setScienceProviders?.({ hydrology: this.hydroClimate, vegetation: this.vegetation, spatialDetail: this.spatialDetail });
    if (refresh) this.updateState(this.lastState, true, this.spatialDetail);
  }
  setVegetation(vegetation, spatialDetail = this.spatialDetail, refresh = true) {
    this.vegetation = vegetation;
    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);
    this.terrain?.setScienceProviders?.({ hydrology: this.hydroClimate, vegetation: this.vegetation, spatialDetail: this.spatialDetail });
    if (refresh) this.updateState(this.lastState, true, this.spatialDetail);
  }

  updateState(state, force = false, spatialDetail = this.spatialDetail) {
    this.lastState = state;
    this.spatialDetail = clamp(Number(spatialDetail) || 0.35, 0, 1);
    this.terrain?.setScienceProviders?.({ hydrology: this.hydroClimate, vegetation: this.vegetation, spatialDetail: this.spatialDetail });
    const needsSurfaceContext = this.mode !== "globe";
    this.terrain?.setEarthSystemState?.(state, state.seed, needsSurfaceContext);
    this.applyPerformanceSettings(false);
    const now = performance.now();
    if ((force || Math.abs(state.yearBP - this.lastTextureYear) >= EARTH_REFRESH_YEARS) && !this.interacting && (force || now - this.lastEarthRefreshMs >= EARTH_INTERVAL_MS)) this._requestEarthRaster(state);
    if ((force || Math.abs(state.yearBP - this.lastCloudYear) >= CLOUD_REFRESH_YEARS) && !this.interacting && (force || now - this.lastCloudRefreshMs >= CLOUD_INTERVAL_MS)) this._requestCloudRaster(state);
    if (this.mode === "surface" && this.terrain?.origin) this.updateSurfaceWater();
    this.invalidate();
  }

  _requestEarthRaster(state) { requestEarthRaster(this, state); }
  _requestCloudRaster(state) { requestCloudRaster(this, state); }

  updateSurfaceWater() {
    if (!this.terrain?.origin || !this.surfaceWater) return;
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
    const signature = [settings.visualLod, ratio.toFixed(3), settings.effectiveTerrainRadius, settings.effectiveTerrainSegments, settings.quality >= 0.55 ? 1 : 0].join("|");
    if (!force && signature === this.lastPerformanceSignature) return false;
    this.lastPerformanceSignature = signature;
    if (force || Math.abs(this.renderer.getPixelRatio() - ratio) > 0.02) { this.renderer.setPixelRatio(ratio); this.resize(); }
    this.clouds.visible = settings.quality >= 0.55;
    this.atmosphere.visible = settings.quality >= 0.55;
    this.terrain?.configure?.({ radius: settings.effectiveTerrainRadius, segments: settings.effectiveTerrainSegments });
    this.diagnosticsCacheAt = -Infinity;
    return true;
  }

  orbitBy(deltaAzimuth, deltaPolar) {
    if (this.mode === "descent" || (!deltaAzimuth && !deltaPolar)) return;
    const camera = this.mode === "surface" ? this.surfaceCamera : this.camera;
    const controls = this.mode === "surface" ? this.surfaceControls : this.controls;
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const minPolar = Number.isFinite(controls.minPolarAngle) ? Math.max(0.001, controls.minPolarAngle) : 0.18;
    const maxPolar = Number.isFinite(controls.maxPolarAngle) ? Math.min(Math.PI - 0.001, controls.maxPolarAngle) : Math.PI - 0.18;
    spherical.theta -= deltaAzimuth;
    spherical.phi = clamp(spherical.phi + deltaPolar, minPolar, maxPolar);
    offset.setFromSpherical(spherical);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    this.continuousUntilMs = performance.now() + 400;
    controls.update();
    this.invalidate();
  }

  zoomBy(deltaDistance) {
    if (this.mode === "descent" || !deltaDistance) return;
    const camera = this.mode === "surface" ? this.surfaceCamera : this.camera;
    const controls = this.mode === "surface" ? this.surfaceControls : this.controls;
    if (!camera || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    const currentDistance = Math.max(1e-12, offset.length());
    const zoomScale = Math.exp(Number(deltaDistance) * 0.65);
    offset.setLength(clamp(currentDistance * zoomScale, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset);
    this.continuousUntilMs = performance.now() + 400;
    controls.update();
    this.invalidate();
  }

  resize() {
    const width = this.canvas.clientWidth || innerWidth;
    const height = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    if (this.surfaceCamera) {
      this.surfaceCamera.aspect = this.camera.aspect;
      this.surfaceCamera.updateProjectionMatrix();
    }
    this.diagnosticsCacheAt = -Infinity;
    this.invalidate();
  }

  render(deltaSeconds, now = performance.now()) {
    this.lastFrameDeltaMs = Math.max(0.1, deltaSeconds * 1000);
    const started = performance.now();
    let continuous = false;
    const needsSurfaceContext = this.mode !== "globe";
    if (this.terrain && this.terrain.surfaceContextActive !== needsSurfaceContext) this.terrain.setSurfaceContextActive?.(needsSurfaceContext, true);
    if (this.mode === "descent") continuous = this.surfaceTransitions?.updateDescent(this, now) || continuous;
    if (this.mode === "globe" || this.mode === "descent") {
      if (this.mode === "globe") continuous = this.controls.update() === true || continuous;
      if ((this.simulationPlaying && !this.isInteracting(now)) || this.mode === "descent") { this.clouds.rotation.y += deltaSeconds * 0.004; continuous = true; }
      if (this.marker.visible && (this.interacting || now < this.continuousUntilMs || this.mode === "descent")) { this.marker.scale.setScalar(1 + Math.sin(now * 0.004) * 0.16); continuous = true; }
      this.renderer.render(this.scene, this.camera);
    } else if (this.surfaceScene && this.surfaceCamera && this.surfaceControls && this.terrain) {
      continuous = this.surfaceTransitions?.updateSurfaceEntry(this, now) || continuous;
      continuous = (this.surfaceControls.enabled && this.surfaceControls.update() === true) || continuous;
      const cameraClearanceKm = Math.max(0.0002, this.surfaceCamera.near * 4);
      const floor = this.terrain.heightAt(this.surfaceCamera.position.x, this.surfaceCamera.position.z) + cameraClearanceKm;
      if (this.surfaceCamera.position.y < floor) this.surfaceCamera.position.y = floor;
      this.terrain.update(this.surfaceCamera.position);
      const pumpBudget = this.interacting ? SURFACE_PUMP_ACTIVE_MS : SURFACE_PUMP_IDLE_MS;
      const pumped = this.terrain.pump(pumpBudget);
      continuous = pumped > 0 || this.terrain.hasPendingWork?.() === true || this.simulationPlaying || continuous;
      this.renderer.render(this.surfaceScene, this.surfaceCamera);
    }
    this.lastRenderMs = performance.now() - started;
    if (this.mode !== "globe" && (this.interacting || this.descent || this.surfaceEntry) && this.lastFrameDeltaMs < 80 && this.performanceController.sample(this.lastFrameDeltaMs, now)) { this.applyPerformanceSettings(false); continuous = true; }
    return continuous || now < this.continuousUntilMs;
  }

  diagnostics(force = false) {
    const now = performance.now();
    if (!force && this.isInteracting(now) && this.diagnosticsCache) return this.diagnosticsCache;
    if (!force && this.diagnosticsCache && now - this.diagnosticsCacheAt < DIAGNOSTICS_INTERVAL_MS) return this.diagnosticsCache;
    const info = this.renderer.info.render;
    const terrain = this.terrain ? { loaded: true, ...this.terrain.diagnostics() } : EMPTY_TERRAIN_DIAGNOSTICS;
    this.diagnosticsCache = Object.freeze({
      mode: this.mode, renderMs: this.lastRenderMs, frameDeltaMs: this.lastFrameDeltaMs,
      pixelRatio: this.renderer.getPixelRatio(), drawCalls: info.calls, triangles: info.triangles,
      geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures,
      earthBuildInFlight: this.earthBuildInFlight, cloudBuildInFlight: this.cloudBuildInFlight,
      surfaceLoaded: Boolean(this.terrain), surfaceLoading: this.surfaceLoading,
      raster: this.rasterWorker.diagnostics(), performance: this.performanceController.diagnostics(), terrain
    });
    this.diagnosticsCacheAt = now;
    return this.diagnosticsCache;
  }

  dispose() {
    if (this.surfacePrewarmHandle != null) {
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(this.surfacePrewarmHandle);
      clearTimeout(this.surfacePrewarmHandle);
      this.surfacePrewarmHandle = null;
    }
    this.resizeObserver?.disconnect();
    this.rasterWorker.dispose();
    this.terrain?.dispose?.();
    this.controls.dispose();
    this.surfaceControls?.dispose?.();
    this.renderer.dispose();
  }
}
