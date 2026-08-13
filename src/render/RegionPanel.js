import { regionalState } from "../sim/regional-state.js";

function signed(value, digits = 2) {
  const rounded = Number(value).toFixed(digits);
  return Number(value) > 0 ? `+${rounded}` : rounded.replace("-", "−");
}

export function renderRegionPanel(ui, state, latitude, longitude, { climateLayer, hydroClimate, vegetation, spatialDetail }) {
  const region = regionalState(state, latitude, longitude, { climateLayer, hydroClimate, vegetation, spatialDetail });
  const river = hydroClimate?.networkSample?.(state, latitude, longitude, spatialDetail) ?? null;
  const latLabel = `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}`;
  const lonLabel = `${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`;
  ui.locationTitle.textContent = region.biome;
  const details = [`mean annual temperature ${signed(region.annualTemperature, 1)} °C`];
  if (Number.isFinite(region.annualPrecipitation)) details.push(`precipitation ${Math.round(region.annualPrecipitation).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.cloudCover)) details.push(`cloud ${region.cloudCover.toFixed(1)}%`);
  details.push(`soil moisture ${Math.round(region.moisture * 100)}%`);
  if (region.soilProfileApplied && Number.isFinite(region.soilWaterCapacity)) details.push(`BIOME4 soil capacity ${Math.round(region.soilWaterCapacity).toLocaleString()} mm`);
  else if (region.soilStatus && region.soilStatus !== "unavailable") details.push(`BIOME4 soil ${region.soilStatus} · fallback bucket`);
  if (Number.isFinite(region.surfaceRunoff)) details.push(`surface runoff ${Math.round(region.surfaceRunoff).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.deepDrainage)) details.push(`deep drainage ${Math.round(region.deepDrainage).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.runoffPotential) && !Number.isFinite(region.surfaceRunoff)) details.push(`local runoff ${Math.round(region.runoffPotential).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.npp)) details.push(`BIOME4 NPP ${region.npp.toFixed(1)} source units`);
  if (Number.isFinite(region.lai)) details.push(`LAI ${region.lai.toFixed(2)}`);
  if (region.climateEligiblePftIds?.length) details.push(`PFT climate candidates ${region.climateEligiblePftIds.join("/")}`);
  if (region.climateUnresolvedPftIds?.length) details.push(`PFT unresolved ${region.climateUnresolvedPftIds.join("/")} · source-driver coverage`);
  if (region.pftWaterPhenology?.status === "resolved") {
    details.push(`PFT daily phenology ${region.pftWaterPhenology.resolvedCount}/${region.pftWaterPhenology.candidateCount}`);
    if (region.pftWaterPhenology.raingreenDiscrepancyPftIds?.length) details.push(`BIOME4 rain-threshold source quirk preserved for PFT ${region.pftWaterPhenology.raingreenDiscrepancyPftIds.join("/")}`);
  } else if (region.pftWaterPhenology?.status === "unresolved-water-trace") details.push("PFT daily water/phenology unresolved at this soil cell");
  if (Number.isFinite(region.vegetationTransitionPressure) && region.vegetationTransitionPressure > 0.02) details.push(`vegetation transition pressure ${Math.round(region.vegetationTransitionPressure * 100)}%`);
  if (river) {
    details.push(`river ${river.meanDischargeM3s.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³/s`);
    details.push(`upstream area ${Math.round(river.upstreamAreaKm2).toLocaleString()} km²`);
    details.push(`forcing coverage ${Math.round(river.upstreamClimateForcingCoverageFraction * 100)}% of upstream area`);
    details.push(`drainage ${river.outlet} · ${river.routeCellsToOutlet} routed cells`);
  }
  ui.locationDetail.textContent = `${region.checkpointClimate ? "Climate" : "Modeled climate"}: ${details.join(" · ")}.`;
  const routingNote = river
    ? ` · ${river.spacingDegrees}° accumulating network · global forcing coverage ${Math.round((river.globalClimateForcingFraction ?? river.globalClimateForcingCoverageFraction) * 100)}% · closure ${Math.abs(river.networkRelativeClosureError).toExponential(1)}`
    : "";
  ui.locationCoordinates.textContent = `${latLabel}  ${lonLabel} · ${region.confidence}${routingNote}`;
}
