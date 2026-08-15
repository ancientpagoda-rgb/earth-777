import { SOURCES } from "./data/provenance.js";
import { GamepadDriver, GAMEPAD_HINT, KEYBOARD_HINT, POINTER_HINT, clamp } from "./input/gamepad.js";
import { loadKrapp777Climate } from "./data/krapp-777-climate.js";
import { loadKrapp777Vegetation } from "./data/krapp-777-vegetation.js";
import { loadBiome4Soil } from "./data/biome4-soil.js";
import { loadBiome4PftDrivers } from "./data/biome4-pft-drivers.js";
import { FreeEarthEngine } from "./sim/free-earth.js";
import { SpatialHydroClimate } from "./sim/SpatialHydroClimate.js";
import { EarthSystemHydrology } from "./sim/EarthSystemHydrology.js";
import { SpatialVegetation } from "./sim/SpatialVegetation.js";
import { EarthView } from "./render/earth-view.js";
import { FrameProfiler } from "./render/FrameProfiler.js";
import { renderRegionPanel } from "./render/RegionPanel.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  year: $("#year-readout"), timelineDate: $("#timeline-date-label"), stage: $("#stage-readout"), co2: $("#co2-readout"), temperature: $("#temperature-readout"),
  ice: $("#ice-readout"), sea: $("#sea-readout"), orbit: $("#orbit-readout"), npp: $("#npp-readout"), hominin: $("#hominin-readout"),
  statePanel: $(".state-panel"), locationPanel: $(".location-panel"), journalPanel: $(".journal"),
  locationTitle: $("#location-title"), locationDetail: $("#location-detail"), locationCoordinates: $("#location-coordinates"), surface: $("#surface-button"),
  play: $("#play-button"), range: $("#timeline-range"), elapsed: $("#elapsed-readout"), speedSelect: $("#speed-select"), seed: $("#run-seed"), branch: $("#branch-button"), journal: $("#journal-list"),
  sourcesButton: $("#sources-button"), sourcesButtonMobile: $("#sources-button-mobile"), sourcesModal: $("#sources-modal"), sourcesClose: $("#sources-close"), sourceList: $("#source-list"), hint: $("#interaction-hint"),
  perfHud: $("#perf-hud"), perfFps: $("#perf-fps"), perfFrame: $("#perf-frame"), perfRender: $("#perf-render"), perfSim: $("#perf-sim"),
  perfCalls: $("#perf-calls"), perfTriangles: $("#perf-triangles"), perfWorker: $("#perf-worker"), perfLod: $("#perf-lod"), perfChunks: $("#perf-chunks"), perfDpr: $("#perf-dpr"), perfMode: $("#perf-mode")
};

let seed = 777001;
let speed = 100;
let playing = false;
let lastFrame = performance.now();
let lastSimulationUpdate = lastFrame;
let lastUiUpdate = 0;
let lastRegionUpdate = 0;
let lastPerfHudUpdate = 0;
let pendingSimulationYears = 0;
let rafId = null;
let selected = null;
let climate777 = null;
let hydroClimate = null;
let spatialVegetation = null;
let lastJournalSignature = "";
let lastSourcesTrigger = null;
let gamepadConnected = false;
let hintBase = "DRAG · ZOOM · SELECT";
const SIMULATION_INTERVAL_MS = 100;
const UI_UPDATE_INTERVAL_MS = 250;
const REGION_UPDATE_INTERVAL_MS = 5_000;
const PERF_HUD_INTERVAL_MS = 400;
const profiler = new FrameProfiler();
const engine = new FreeEarthEngine(seed);

function requestFrame() {
  if (rafId != null) return;
  rafId = requestAnimationFrame(frame);
}

const earthView = new EarthView($("#earth"), engine.snapshot(), handleRegionSelect, {
  onInvalidate: requestFrame,
  onModeChange: handleModeChange
});
const speedPresets = [...ui.speedSelect.options].map((option) => Number(option.value)).filter(Number.isFinite).sort((a, b) => a - b);
const gamepad = new GamepadDriver({
  onConnectionChange(connected) {
    gamepadConnected = connected;
    document.body.classList.toggle("gamepad-active", connected);
    updateInteractionHint();
    requestFrame();
  },
  onOrbit({ x, y, deltaSeconds }) {
    if (isSourcesOpen()) return;
    earthView.orbitBy(x * deltaSeconds * 1.95, y * deltaSeconds * 1.5);
  },
  onZoom({ value, deltaSeconds }) {
    if (isSourcesOpen()) return;
    earthView.zoomBy(value * deltaSeconds * 4.4);
  },
  onSelect() {
    if (isSourcesOpen()) return;
    earthView.selectViewCenter();
  },
  onFocus() {
    if (isSourcesOpen()) return;
    earthView.toggleSurface();
  },
  onBack() {
    if (isSourcesOpen()) closeSources();
    else if (earthView.mode === "surface") earthView.toggleSurface();
  },
  onToggleSources() {
    toggleSources();
  },
  onPreviousSpeed() {
    if (isSourcesOpen()) return;
    stepSpeed(-1);
  },
  onNextSpeed() {
    if (isSourcesOpen()) return;
    stepSpeed(1);
  },
  onTogglePlay() {
    if (isSourcesOpen()) {
      closeSources();
      return;
    }
    setPlaying(!playing);
  },
  onTimelineStep(direction) {
    if (isSourcesOpen()) return;
    seekTimeline(Number(ui.range.value) + direction * 7_500);
  }
});

function formatYear(yearBP) { return `${Math.max(0, Math.round(yearBP)).toLocaleString()} BP`; }
function signed(value, digits = 2) {
  const rounded = Number(value).toFixed(digits);
  return Number(value) > 0 ? `+${rounded}` : rounded.replace("-", "−");
}
function spatialDetailFor(system, fallback = 0.35) {
  const target = engine.fidelityDiagnostics().targets.find((entry) => entry.id === system);
  return Number.isFinite(target?.spatialDetail) ? target.spatialDetail : fallback;
}
function iceDescription(index) {
  if (index < 0.2) return "incipient";
  if (index < 0.42) return "expanding";
  if (index < 0.72) return "glacial";
  return "major glacial";
}
function ecosystemDescription(value) {
  if (value < 0.68) return "contracting";
  if (value > 1.16) return "expanding";
  return "stable";
}

function updateInteractionHint(baseText = hintBase) {
  hintBase = baseText;
  if (!ui.hint) return;
  if (gamepadConnected && baseText === "DRAG · ZOOM · SELECT") {
    ui.hint.textContent = GAMEPAD_HINT;
    return;
  }
  if (!gamepadConnected && baseText === "DRAG · ZOOM · SELECT") {
    ui.hint.textContent = `${POINTER_HINT} · ${KEYBOARD_HINT}`;
    return;
  }
  ui.hint.textContent = baseText;
}

function updateInterface(state, forceTexture = false, forceRegion = false) {
  const yearLabel = formatYear(state.yearBP);
  ui.year.textContent = yearLabel;
  ui.timelineDate.textContent = yearLabel;
  ui.stage.textContent = state.yearBP > 773_900 ? "Late MIS 19c" : state.yearBP > 756_900 ? "MIS 19 transition" : "Free Earth trajectory";
  ui.co2.textContent = `${Math.round(state.co2)}`;
  ui.temperature.textContent = signed(state.temperatureAnomaly);
  ui.ice.textContent = iceDescription(state.iceIndex);
  ui.sea.textContent = `${signed(state.seaLevel, 0)} m`;
  ui.sea.title = `Spratt–Lisiecki reference ${signed(state.seaLevelReference, 1)} ± ${state.seaLevelUncertainty.toFixed(1)} m (1σ)`;
  ui.orbit.textContent = `${state.obliquity.toFixed(1)}° tilt`;
  ui.orbit.title = `e ${state.eccentricity.toFixed(4)} · perihelion longitude ${state.precession.toFixed(1)}°`;
  ui.npp.textContent = ecosystemDescription(state.productivityIndex);
  ui.npp.title = "Global aggregate productivity emulator; select a region for published BIOME4 NPP/LAI and branch vegetation response.";
  ui.hominin.textContent = Number.isFinite(state.homininPopulationPersons)
    ? Math.max(0, Math.round(state.homininPopulationPersons)).toLocaleString()
    : ecosystemDescription(state.homininPopulationIndex);
  ui.range.value = Math.round(state.elapsedYears);
  ui.range.style.setProperty("--progress", `${state.elapsedYears / 777_000 * 100}%`);
  ui.elapsed.textContent = state.elapsedYears < 1 ? "checkpoint" : `+${Math.round(state.elapsedYears).toLocaleString()} years`;
  updateJournal(state);
  const now = performance.now();
  if (selected && (forceRegion || now - lastRegionUpdate >= REGION_UPDATE_INTERVAL_MS)) {
    renderRegion(state, selected.latitude, selected.longitude);
    lastRegionUpdate = now;
  }
  const surfaceDetail = Math.max(spatialDetailFor("hydrology"), spatialDetailFor("vegetation"));
  earthView.updateState(state, forceTexture, surfaceDetail);
}

function isSourcesOpen() {
  return ui.sourcesModal.classList.contains("is-open");
}

function openSources(trigger = document.activeElement) {
  lastSourcesTrigger = trigger instanceof HTMLElement ? trigger : null;
  ui.sourcesModal.classList.add("is-open");
  ui.sourcesClose.focus();
}

function closeSources() {
  if (!isSourcesOpen()) return;
  ui.sourcesModal.classList.remove("is-open");
  lastSourcesTrigger?.focus?.();
}

function toggleSources(trigger = document.activeElement) {
  if (isSourcesOpen()) closeSources();
  else openSources(trigger);
}

function updateJournal(state) {
  const entries = [
    ...state.events.slice(-4).reverse(),
    { yearBP: 777_000, text: "Earth 777 initialized from the data-assimilated MIS 19 reconstruction checkpoint." }
  ].slice(0, 5);
  const signature = entries.map((entry) => `${entry.yearBP}:${entry.text}`).join("|");
  if (signature === lastJournalSignature) return;
  lastJournalSignature = signature;
  ui.journal.replaceChildren(...entries.map((entry) => {
    const item = document.createElement("li");
    const time = document.createElement("time");
    const text = document.createElement("span");
    time.textContent = formatYear(entry.yearBP);
    text.textContent = entry.text;
    item.append(time, text);
    return item;
  }));
}

function handleRegionSelect(region) {
  selected = region;
  engine.setObserverRelevance({ climate: 1, hydrology: 1, vegetation: 0.8 });
  ui.surface.disabled = false;
  if (ui.locationPanel) ui.locationPanel.open = true;
  renderRegion(engine.snapshot(), region.latitude, region.longitude);
  lastRegionUpdate = performance.now();
}

function handleModeChange(mode) {
  if (mode === "descent") {
    ui.surface.textContent = "DESCENDING…";
    ui.surface.disabled = true;
    updateInteractionHint("DESCENDING · TERRAIN STREAMING");
  } else if (mode === "surface") {
    ui.surface.textContent = "RETURN TO GLOBE";
    ui.surface.disabled = false;
    if (ui.statePanel) ui.statePanel.open = false;
    if (ui.journalPanel) ui.journalPanel.open = false;
    if (ui.perfHud) ui.perfHud.open = false;
    if (ui.locationPanel) ui.locationPanel.open = true;
    updateInteractionHint("DRAG · MOVE · ZOOM");
  } else {
    ui.surface.textContent = "DESCEND TO REGION";
    ui.surface.disabled = !selected;
    updateInteractionHint("DRAG · ZOOM · SELECT");
  }
  requestFrame();
}

function renderRegion(state, latitude, longitude) {
  const regionalDetail = Math.max(spatialDetailFor("hydrology"), spatialDetailFor("vegetation"), 0.82);
  renderRegionPanel(ui, state, latitude, longitude, { climateLayer: climate777, hydroClimate, vegetation: spatialVegetation, spatialDetail: regionalDetail });
}

function setPlaying(next) {
  playing = next;
  pendingSimulationYears = 0;
  lastSimulationUpdate = performance.now();
  ui.play.textContent = playing ? "Ⅱ" : "▶";
  ui.play.classList.toggle("is-playing", playing);
  ui.play.setAttribute("aria-label", playing ? "Pause simulation" : "Start simulation");
  earthView.setSimulationPlaying(playing);
  requestFrame();
}

function setSpeed(nextSpeed) {
  speed = nextSpeed;
  ui.speedSelect.value = String(nextSpeed);
}

function stepSpeed(direction) {
  const currentIndex = Math.max(0, speedPresets.indexOf(speed));
  const nextIndex = clamp(currentIndex + direction, 0, speedPresets.length - 1);
  setSpeed(speedPresets[nextIndex]);
}

function setSeed(nextSeed) {
  seed = Number(nextSeed) >>> 0;
  engine.setObserverRelevance({});
  engine.reset(seed);
  if (earthView.mode === "surface") earthView.ascendToGlobe();
  selected = null;
  ui.surface.disabled = true;
  ui.surface.textContent = "DESCEND TO REGION";
  ui.locationTitle.textContent = "Global view";
  ui.locationDetail.textContent = "Select the globe to inspect a regional climate and ecosystem state.";
  ui.locationCoordinates.textContent = "—";
  if (ui.locationPanel) ui.locationPanel.open = false;
  ui.seed.textContent = `SEED ${seed}`;
  setPlaying(false);
  updateInterface(engine.snapshot(), true, true);
}

function seekTimeline(elapsedYears) {
  const targetYears = clamp(Math.round(elapsedYears), 0, 777_000);
  const state = profiler.measure("simMs", () => engine.seek(targetYears));
  profiler.measure("uiMs", () => updateInterface(state, true, true));
  requestFrame();
}

function isInteractiveTarget(target) {
  return target instanceof HTMLElement && Boolean(target.closest("button, input, a, textarea, select, summary"));
}

function handleKeyboardControl(event) {
  if (isInteractiveTarget(event.target)) return;

  if (event.key === "Escape") {
    closeSources();
    return;
  }

  if (event.code === "Space") {
    if (event.repeat) return;
    event.preventDefault();
    if (isSourcesOpen()) {
      closeSources();
      return;
    }
    setPlaying(!playing);
    return;
  }

  if (event.code === "KeyS") {
    if (event.repeat) return;
    event.preventDefault();
    toggleSources(ui.sourcesButtonMobile ?? ui.sourcesButton);
    return;
  }

  if (isSourcesOpen()) return;

  switch (event.code) {
    case "ArrowLeft":
      event.preventDefault();
      earthView.orbitBy(-0.18, 0);
      break;
    case "ArrowRight":
      event.preventDefault();
      earthView.orbitBy(0.18, 0);
      break;
    case "ArrowUp":
      event.preventDefault();
      earthView.orbitBy(0, -0.14);
      break;
    case "ArrowDown":
      event.preventDefault();
      earthView.orbitBy(0, 0.14);
      break;
    case "Equal":
    case "NumpadAdd":
      event.preventDefault();
      earthView.zoomBy(-0.3);
      break;
    case "Minus":
    case "NumpadSubtract":
      event.preventDefault();
      earthView.zoomBy(0.3);
      break;
    case "Enter":
      event.preventDefault();
      earthView.selectViewCenter();
      break;
    case "KeyF":
      event.preventDefault();
      earthView.toggleSurface();
      break;
    default:
      break;
  }
}

function populateSources() {
  ui.sourceList.replaceChildren(...SOURCES.map((source) => {
    const article = document.createElement("article");
    article.className = "source-item";
    const top = document.createElement("div");
    top.className = "source-item__top";
    const title = document.createElement("strong");
    title.textContent = source.title;
    const status = document.createElement("em");
    status.textContent = source.status;
    const role = document.createElement("p");
    role.textContent = `${source.role} ${source.license}.`;
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = source.authors;
    top.append(title, status);
    article.append(top, role, link);
    return article;
  }));
}

function updatePerformanceHud(now, force = false) {
  if (!ui.perfHud || (!force && !ui.perfHud.open) || (!force && now - lastPerfHudUpdate < PERF_HUD_INTERVAL_MS)) return;
  lastPerfHudUpdate = now;
  const view = earthView.diagnostics();
  const frame = profiler.snapshot();
  ui.perfFps.textContent = `${Math.round(frame.fps ?? 0)}`;
  ui.perfFrame.textContent = `${view.frameDeltaMs.toFixed(1)} ms`;
  ui.perfRender.textContent = `${view.renderMs.toFixed(1)} ms`;
  ui.perfSim.textContent = `${Number(frame.simMs ?? 0).toFixed(1)} ms`;
  ui.perfCalls.textContent = `${view.drawCalls}`;
  ui.perfTriangles.textContent = Math.round(view.triangles).toLocaleString();
  ui.perfWorker.textContent = `${view.raster.status} · E ${view.raster.lastEarthMs.toFixed(0)} / C ${view.raster.lastCloudMs.toFixed(0)} ms`;
  ui.perfLod.textContent = view.performance.visualLod;
  ui.perfChunks.textContent = `${view.terrain.loadedChunks}/${view.terrain.loadedChunks + view.terrain.queuedChunks}`;
  ui.perfDpr.textContent = view.pixelRatio.toFixed(2);
  ui.perfMode.textContent = view.mode;
  ui.perfHud.dataset.pressure = view.performance.visualLod === "low" ? "high" : view.performance.visualLod === "balanced" ? "medium" : "low";
}

ui.play.addEventListener("click", () => setPlaying(!playing));
ui.surface.addEventListener("click", () => earthView.toggleSurface());
ui.branch.addEventListener("click", () => setSeed(crypto.getRandomValues(new Uint32Array(1))[0]));
ui.range.addEventListener("input", () => {
  const previewYear = 777_000 - Number(ui.range.value);
  ui.timelineDate.textContent = formatYear(previewYear);
  ui.elapsed.textContent = "release to seek";
  ui.range.style.setProperty("--progress", `${Number(ui.range.value) / 777_000 * 100}%`);
});
ui.range.addEventListener("change", () => {
  seekTimeline(Number(ui.range.value));
});
ui.speedSelect.addEventListener("change", () => { setSpeed(Number(ui.speedSelect.value) || 100); });
ui.perfHud?.addEventListener("toggle", () => { if (ui.perfHud.open) updatePerformanceHud(performance.now(), true); });
ui.sourcesButton.addEventListener("click", (event) => openSources(event.currentTarget));
ui.sourcesButtonMobile?.addEventListener("click", (event) => openSources(event.currentTarget));
ui.sourcesClose.addEventListener("click", closeSources);
ui.sourcesModal.addEventListener("click", (event) => { if (event.target === ui.sourcesModal) closeSources(); });

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    lastFrame = performance.now();
    lastSimulationUpdate = lastFrame;
    requestFrame();
  }
});
addEventListener("keydown", handleKeyboardControl);
addEventListener("gamepadconnected", () => requestFrame());
addEventListener("gamepaddisconnected", () => requestFrame());

function frame(now) {
  rafId = null;
  const deltaSeconds = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  profiler.frame(now);
  if (playing) {
    if (earthView.isInteracting()) {
      pendingSimulationYears = 0;
      lastSimulationUpdate = now;
    } else {
      pendingSimulationYears += deltaSeconds * speed;
      if (now - lastSimulationUpdate >= SIMULATION_INTERVAL_MS) {
        const state = profiler.measure("simMs", () => engine.advance(pendingSimulationYears));
        pendingSimulationYears = 0;
        lastSimulationUpdate = now;
        if (state.yearBP <= 0) setPlaying(false);
        if (now - lastUiUpdate >= UI_UPDATE_INTERVAL_MS) {
          profiler.measure("uiMs", () => updateInterface(state));
          lastUiUpdate = now;
        }
      }
    }
  }
  gamepad.update(deltaSeconds);
  const needsAnotherFrame = earthView.render(deltaSeconds, now);
  profiler.record("renderMs", earthView.diagnostics().renderMs);
  updatePerformanceHud(now);
  if (playing || needsAnotherFrame || gamepad.connected) requestFrame();
}

populateSources();
updateInteractionHint("DRAG · ZOOM · SELECT");
setSpeed(speed);
updateInterface(engine.snapshot(), true);
updatePerformanceHud(performance.now(), true);

loadKrapp777Climate()
  .then(async (climateLayer) => {
    climate777 = climateLayer;
    let soilLayer = null;
    let pftDrivers = null;
    try { soilLayer = await loadBiome4Soil(); }
    catch (error) { console.warn("BIOME4 static soil layer unavailable; using the transparent uniform fallback water bucket.", error); }
    try { pftDrivers = await loadBiome4PftDrivers(); }
    catch (error) { console.warn("BIOME4 PFT absolute-minimum-temperature driver unavailable; PFT eligibility will use the documented coldest-month fallback.", error); }
    hydroClimate = new EarthSystemHydrology(new SpatialHydroClimate(climateLayer), soilLayer);
    const surfaceDetail = Math.max(spatialDetailFor("hydrology"), spatialDetailFor("vegetation"));
    earthView.setHydroClimate(hydroClimate, surfaceDetail, false);
    try {
      const vegetationLayer = await loadKrapp777Vegetation();
      hydroClimate.climate?.setCheckpointVegetation?.(vegetationLayer);
      spatialVegetation = new SpatialVegetation(vegetationLayer, hydroClimate, pftDrivers);
      earthView.setVegetation(spatialVegetation, surfaceDetail, true);
    } catch (error) {
      console.warn("Krapp 777 ka BIOME4 vegetation layer unavailable; using hydroclimate vegetation fallback.", error);
      earthView.updateState(engine.snapshot(), true, surfaceDetail);
    }
    if (selected) renderRegion(engine.snapshot(), selected.latitude, selected.longitude);
    requestFrame();
  })
  .catch((error) => console.warn("Krapp 777 ka climate layer unavailable; using regional emulator.", error));

requestFrame();