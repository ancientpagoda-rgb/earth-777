import { SOURCES } from "./data/provenance.js";
import { loadKrapp777Climate } from "./data/krapp-777-climate.js";
import { FreeEarthEngine } from "./sim/free-earth.js";
import { SpatialHydroClimate } from "./sim/SpatialHydroClimate.js";
import { regionalState } from "./sim/regional-state.js";
import { EarthView } from "./render/earth-view.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  year: $("#year-readout"),
  stage: $("#stage-readout"),
  co2: $("#co2-readout"),
  temperature: $("#temperature-readout"),
  ice: $("#ice-readout"),
  sea: $("#sea-readout"),
  orbit: $("#orbit-readout"),
  npp: $("#npp-readout"),
  hominin: $("#hominin-readout"),
  locationTitle: $("#location-title"),
  locationDetail: $("#location-detail"),
  locationCoordinates: $("#location-coordinates"),
  surface: $("#surface-button"),
  play: $("#play-button"),
  range: $("#timeline-range"),
  elapsed: $("#elapsed-readout"),
  seed: $("#run-seed"),
  branch: $("#branch-button"),
  journal: $("#journal-list"),
  sourcesButton: $("#sources-button"),
  sourcesModal: $("#sources-modal"),
  sourcesClose: $("#sources-close"),
  sourceList: $("#source-list")
};

let seed = 777001;
let speed = 100;
let playing = false;
let lastFrame = performance.now();
let lastUiUpdate = 0;
let selected = null;
let climate777 = null;
let hydroClimate = null;
const engine = new FreeEarthEngine(seed);
const earthView = new EarthView($("#earth"), engine.snapshot(), handleRegionSelect);

function formatYear(yearBP) {
  return `${Math.max(0, Math.round(yearBP)).toLocaleString()} BP`;
}

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

function updateInterface(state, forceTexture = false) {
  ui.year.textContent = formatYear(state.yearBP);
  ui.stage.textContent = state.yearBP > 773_900 ? "Late MIS 19c" : state.yearBP > 756_900 ? "MIS 19 transition" : "Free Earth trajectory";
  ui.co2.textContent = `${Math.round(state.co2)} ppm`;
  ui.temperature.textContent = `${signed(state.temperatureAnomaly)} K`;
  ui.ice.textContent = iceDescription(state.iceIndex);
  ui.sea.textContent = `${signed(state.seaLevel, 0)} m`;
  ui.sea.title = `Spratt–Lisiecki reference ${signed(state.seaLevelReference, 1)} ± ${state.seaLevelUncertainty.toFixed(1)} m (1σ)`;
  ui.orbit.textContent = `${state.obliquity.toFixed(1)}° tilt`;
  ui.orbit.title = `e ${state.eccentricity.toFixed(4)} · perihelion longitude ${state.precession.toFixed(1)}°`;
  ui.npp.textContent = ecosystemDescription(state.productivityIndex);
  ui.hominin.textContent = ecosystemDescription(state.homininPopulationIndex);
  ui.range.value = Math.round(state.elapsedYears);
  ui.range.style.setProperty("--progress", `${state.elapsedYears / 777_000 * 100}%`);
  ui.elapsed.textContent = state.elapsedYears < 1 ? "checkpoint" : `+${Math.round(state.elapsedYears).toLocaleString()} years`;
  updateJournal(state);
  if (selected) renderRegion(state, selected.latitude, selected.longitude);
  earthView.updateState(state, forceTexture, spatialDetailFor("hydrology"));
}

function updateJournal(state) {
  const entries = [
    ...state.events.slice(-4).reverse(),
    { yearBP: 777_000, text: "Free Earth initialized from the MIS 19 checkpoint." }
  ].slice(0, 5);
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
  renderRegion(engine.snapshot(), region.latitude, region.longitude);
}

function renderRegion(state, latitude, longitude) {
  const regionalDetail = Math.max(spatialDetailFor("hydrology"), 0.82);
  const region = regionalState(state, latitude, longitude, {
    climateLayer: climate777,
    hydroClimate,
    spatialDetail: regionalDetail
  });
  const latLabel = `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}`;
  const lonLabel = `${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`;
  ui.locationTitle.textContent = region.biome;
  const climateDetails = [`mean annual temperature ${signed(region.annualTemperature, 1)} °C`];
  if (Number.isFinite(region.annualPrecipitation)) climateDetails.push(`precipitation ${Math.round(region.annualPrecipitation).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.cloudCover)) climateDetails.push(`cloud ${region.cloudCover.toFixed(1)}%`);
  climateDetails.push(`moisture index ${Math.round(region.moisture * 100)}%`);
  if (Number.isFinite(region.runoffPotential)) climateDetails.push(`runoff potential ${Math.round(region.runoffPotential).toLocaleString()} mm/yr`);
  ui.locationDetail.textContent = `${region.checkpointClimate ? "Climate" : "Modeled climate"}: ${climateDetails.join(" · ")}.`;
  ui.locationCoordinates.textContent = `${latLabel}  ${lonLabel} · ${region.confidence}`;
}

function setPlaying(next) {
  playing = next;
  ui.play.textContent = playing ? "Ⅱ" : "▶";
  ui.play.classList.toggle("is-playing", playing);
  ui.play.setAttribute("aria-label", playing ? "Pause simulation" : "Start simulation");
}

function setSeed(nextSeed) {
  seed = Number(nextSeed) >>> 0;
  engine.setObserverRelevance({});
  engine.reset(seed);
  selected = null;
  ui.surface.disabled = true;
  ui.locationTitle.textContent = "Global view";
  ui.locationDetail.textContent = "Select the globe to inspect a regional climate and ecosystem state.";
  ui.locationCoordinates.textContent = "—";
  ui.seed.textContent = `SEED ${seed}`;
  setPlaying(false);
  updateInterface(engine.snapshot(), true);
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

ui.play.addEventListener("click", () => setPlaying(!playing));
ui.surface.addEventListener("click", () => earthView.focusSelection());
ui.branch.addEventListener("click", () => setSeed(crypto.getRandomValues(new Uint32Array(1))[0]));
ui.range.addEventListener("input", () => {
  const previewYear = 777_000 - Number(ui.range.value);
  ui.elapsed.textContent = `${formatYear(previewYear)} on release`;
  ui.range.style.setProperty("--progress", `${Number(ui.range.value) / 777_000 * 100}%`);
});
ui.range.addEventListener("change", () => {
  const state = engine.seek(Number(ui.range.value));
  updateInterface(state, true);
});

for (const button of document.querySelectorAll("[data-speed]")) {
  button.addEventListener("click", () => {
    speed = Number(button.dataset.speed);
    for (const candidate of document.querySelectorAll("[data-speed]")) candidate.classList.toggle("is-active", candidate === button);
  });
}

ui.sourcesButton.addEventListener("click", () => ui.sourcesModal.classList.add("is-open"));
ui.sourcesClose.addEventListener("click", () => ui.sourcesModal.classList.remove("is-open"));
ui.sourcesModal.addEventListener("click", (event) => {
  if (event.target === ui.sourcesModal) ui.sourcesModal.classList.remove("is-open");
});
addEventListener("keydown", (event) => {
  if (event.key === "Escape") ui.sourcesModal.classList.remove("is-open");
  if (event.code === "Space" && event.target === document.body) {
    event.preventDefault();
    setPlaying(!playing);
  }
});

function frame(now) {
  const deltaSeconds = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (playing) {
    const state = engine.advance(deltaSeconds * speed);
    if (state.yearBP <= 0) setPlaying(false);
    if (now - lastUiUpdate > 160) {
      updateInterface(state);
      lastUiUpdate = now;
    }
  }
  earthView.render(deltaSeconds);
  requestAnimationFrame(frame);
}

populateSources();
updateInterface(engine.snapshot(), true);
loadKrapp777Climate()
  .then((layer) => {
    climate777 = layer;
    hydroClimate = new SpatialHydroClimate(layer);
    earthView.setHydroClimate(hydroClimate, spatialDetailFor("hydrology"));
    if (selected) renderRegion(engine.snapshot(), selected.latitude, selected.longitude);
  })
  .catch((error) => console.warn("Krapp 777 ka climate layer unavailable; using regional emulator.", error));
requestAnimationFrame(frame);
