import { HOMININ_DEMOGRAPHY_TELEMETRY_KEY } from "../sim/DemographyTelemetry.js";

function signedPercent(value) {
  const percent = (Number(value) || 0) * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(3)}%/yr`;
}

function update() {
  const readout = document.querySelector("#hominin-readout");
  const state = globalThis[HOMININ_DEMOGRAPHY_TELEMETRY_KEY];
  if (!readout || !state || !Number.isFinite(state.populationPersons)) return;
  readout.textContent = Math.round(state.populationPersons).toLocaleString();
  readout.title = `${state.speciesRichness.toLocaleString()} lineage${state.speciesRichness === 1 ? "" : "s"} · ${state.demeCount.toLocaleString()} demes · births ${Math.round(state.birthsPerYear).toLocaleString()}/yr · deaths ${Math.round(state.deathsPerYear).toLocaleString()}/yr · net ${signedPercent(state.growthPerYear)}`;
}

update();
const observer = new MutationObserver(update);
const readout = document.querySelector("#hominin-readout");
if (readout) observer.observe(readout, { childList: true, characterData: true, subtree: true });
setInterval(update, 250);
