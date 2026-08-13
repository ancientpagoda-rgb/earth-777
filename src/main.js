import { SOURCES } from "./data/provenance.js";
import { loadKrapp777Climate } from "./data/krapp-777-climate.js";
import { loadKrapp777Vegetation } from "./data/krapp-777-vegetation.js";
import { loadBiome4Soil } from "./data/biome4-soil.js";
import { FreeEarthEngine } from "./sim/free-earth.js";
import { SpatialHydroClimate } from "./sim/SpatialHydroClimate.js";
import { MassConservingHydrology } from "./sim/MassConservingHydrology.js";
import { SpatialVegetation } from "./sim/SpatialVegetation.js";
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
let spatialVegetation = null;
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
  ui.npp.title = "Global aggregate productivity emulator; select a region for published BIOME4 NPP/LAI and branch vegetation response.";
  ui.hominin.textContent = ecosystemDescription(state.homininPopulationIndex);
  ui.range.value = Math.round(state.elapsedYears);
  ui.range.style.setProperty("--progress", `${state.elapsedYears / 777_000 * 100}%`);
  ui.elapsed.textContent = state.elapsedYears < 1 ? "checkpoint" : `+${Math.round(state.elapsedYears).toLocaleString()} years`;
  updateJournal(state);
  if (selected) renderRegion(state, selected.latitude, selected.longitude);
  const surfaceDetail = Math.max(spatialDetailFor("hydrology"), spatialDetailFor("vegetation"));
  earthView.updateState(state, forceTexture, surfaceDetail);
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
  const regionalDetail = Math.max(spatialDetailFor("hydrology"), spatialDetailFor("vegetation"), 0.82);
  const region = regionalState(state, latitude, longitude, {
    climateLayer: climate777,
    hydroClimate,
    vegetation: spatialVegetation,
    spatialDetail: regionalDetail
  });
  const river = hydroClimate?.networkSample?.(state, latitude, longitude, regionalDetail) ?? null;
  const latLabel = `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}`;
  const lonLabel = `${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`;
  ui.locationTitle.textContent = region.biome;
  const climateDetails = [`mean annual temperature ${signed(region.annualTemperature, 1)} °C`];
  if (Number.isFinite(region.annualPrecipitation)) climateDetails.push(`precipitation ${Math.round(region.annualPrecipitation).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.cloudCover)) climateDetails.push(`cloud ${region.cloudCover.toFixed(1)}%`);
  climateDetails.push(`soil moisture ${Math.round(region.moisture * 100)}%`);
  if (region.soilProfileApplied && Number.isFinite(region.soilWaterCapacity)) {
    climateDetails.push(`BIOME4 soil capacity ${Math.round(region.soilWaterCapacity).toLocaleString()} mm`);
  } else if (region.soilStatus && region.soilStatus !== "unavailable") {
    climateDetails.push(`BIOME4 soil ${region.soilStatus} · fallback bucket`);
  }
  if (Number.isFinite(region.surfaceRunoff)) climateDetails.push(`surface runoff ${Math.round(region.surfaceRunoff).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.deepDrainage)) climateDetails.push(`deep drainage ${Math.round(region.deepDrainage).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.runoffPotential) && !Number.isFinite(region.surfaceRunoff)) climateDetails.push(`local runoff ${Math.round(region.runoffPotential).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.npp)) climateDetails.push(`BIOME4 NPP ${region.npp.toFixed(1)} source units`);
  if (Number.isFinite(region.lai)) climateDetails.push(`LAI ${region.lai.toFixed(2)}`);
  if (Array.isArray(region.climateEligiblePftIds) && region.climateEligiblePftIds.length) {
    climateDetails.push(`PFT climate candidates ${region.climateEligiblePftIds.join("/")}`);
  }
  if (Array.isArray(region.climateUnresolvedPftIds) && region.climateUnresolvedPftIds.length) {
    climateDetails.push(`PFT unresolved ${region.climateUnresolvedPftIds.join("/")} · snow physics pending`);
  }
  if (region.pftWaterPhenology?.status === "resolved") {
    climateDetails.push(`PFT daily phenology ${region.pftWaterPhenology.resolvedCount}/${region.pftWaterPhenology.candidateCount}`);
    if (region.pftWaterPhenology.raingreenDiscrepancyPftIds?.length) {
      climateDetails.push(`BIOME4 rain-threshold source quirk preserved for PFT ${region.pftWaterPhenology.raingreenDiscrepancyPftIds.join("/")}`);
    }
  } else if (region.pftWaterPhenology?.status === "unresolved-water-trace") {
    climateDetails.push("PFT daily water/phenology unresolved at this soil cell");
  }
  if (Number.isFinite(region.vegetationTransitionPressure) && region.vegetationTransitionPressure > 0.02) {
    climateDetails.push(`vegetation transition pressure ${Math.round(region.vegetationTransitionPressure * 100)}%`);
  }
  if (river) {
    climateDetails.push(`river ${river.meanDischargeM3s.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³/s`);
    climateDetails.push(`upstream area ${Math.round(river.upstreamAreaKm2).toLocaleString()} km²`);
    climateDetails.push(`forcing coverage ${Math.round(river.upstreamClimateForcingCoverageFraction * 100)}% of upstream area`);
    climateDetails.push(`drainage ${river.outlet} · ${river.routeCellsToOutlet} routed cells`);
  }
  ui.locationDetail.textContent = `${region.checkpointClimate ? "Climate" : "Modeled climate"}: ${climateDetails.join(" · ")}.`;
  const routingNote = river
    ? ` · ${river.spacingDegrees}° accumulating network · global forcing coverage ${Math.round(river.globalClimateForcingCoverageFraction * 100)}% · closure ${Math.abs(river.networkRelativeClosureError).toExponential(1)}`
    : "";
  ui.locationCoordinates.textContent = `${latLabel}  ${lonLabel} · ${region.confidence}${routingNote}`;
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
  .then(async (climateLayer) => {
    climate777 = climateLayer;
    let soilLayer = null;
    try {
      soilLayer = await loadBiome4Soil();
    } catch (error) {
      console.warn("BIOME4 static soil layer unavailable; using the transparent uniform fallback water bucket.", error);
    }
    hydroClimate = new MassConservingHydrology(new SpatialHydroClimate(climateLayer), soilLayer);
    const surfaceDetail = Math.max(spatialDetailFor("hydrology"), spatialDetailFor("vegetation"));
    earthView.setHydroClimate(hydroClimate, surfaceDetail);
    try {
      const vegetationLayer = await loadKrapp777Vegetation();
      spatialVegetation = new SpatialVegetation(vegetationLayer, hydroClimate);
      earthView.setVegetation(spatialVegetation, surfaceDetail);
    } catch (error) {
      console.warn("Krapp 777 ka BIOME4 vegetation layer unavailable; using hydroclimate vegetation fallback.", error);
    }
    if (selected) renderRegion(engine.snapshot(), selected.latitude, selected.longitude);
  })
  .catch((error) => console.warn("Krapp 777 ka climate layer unavailable; using regional emulator.", error));
requestAnimationFrame(frame);
