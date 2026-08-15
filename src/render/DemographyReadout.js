import { HOMININ_DEMOGRAPHY_TELEMETRY_KEY } from "../sim/DemographyTelemetry.js";
import { classifyEmergentCulture } from "./EmergentCultureClassifier.js";

function signedPercent(value) {
  const percent = (Number(value) || 0) * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(3)}%/yr`;
}

function update() {
  const readout = document.querySelector("#hominin-readout");
  const state = globalThis[HOMININ_DEMOGRAPHY_TELEMETRY_KEY];
  if (!readout || !state || !Number.isFinite(state.populationPersons)) return;
  const text = Math.round(state.populationPersons).toLocaleString();
  const social = Number.isFinite(state.householdCount)
    ? ` · ${state.householdCount.toLocaleString()} households · ${state.residentialGroupCount.toLocaleString()} residential groups · ${state.activeSiteCount.toLocaleString()} occupied sites (${state.persistentSiteCount.toLocaleString()} persistent) · largest co-resident site ${state.largestSitePopulationPersons.toLocaleString()} · ${state.exchangeEdgeCount.toLocaleString()} exchange ties`
    : "";
  const transport = Number.isFinite(state.waterRouteCount)
    ? ` · ${state.waterTransportSiteCount.toLocaleString()} water-transport sites · ${state.waterRouteCount.toLocaleString()} water routes`
    : "";
  const conflict = Number.isFinite(state.conflictEdgeCount)
    ? ` · ${state.conflictEdgeCount.toLocaleString()} conflict contacts · ${state.defensiveSiteCount.toLocaleString()} defensive sites (${state.highDefenseSiteCount.toLocaleString()} high investment)`
    : "";
  const observed = classifyEmergentCulture(state).observations;
  const observerLabels = observed.length ? ` · observer: ${observed.map((entry) => entry.label).join("; ")}` : "";
  const title = `${state.speciesRichness.toLocaleString()} lineage${state.speciesRichness === 1 ? "" : "s"} · ${state.demeCount.toLocaleString()} demes${social}${transport}${conflict}${observerLabels} · births ${Math.round(state.birthsPerYear).toLocaleString()}/yr · deaths ${Math.round(state.deathsPerYear).toLocaleString()}/yr · net ${signedPercent(state.growthPerYear)}`;
  if (readout.textContent !== text) readout.textContent = text;
  if (readout.title !== title) readout.title = title;
}

update();
const observer = new MutationObserver(update);
const readout = document.querySelector("#hominin-readout");
if (readout) observer.observe(readout, { childList: true, characterData: true, subtree: true });
setInterval(update, 250);
