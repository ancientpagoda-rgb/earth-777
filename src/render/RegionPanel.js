import { bedrockElevationAt } from "../data/generated/etopo-2022.generated.js";
import { regionalState } from "../sim/regional-state.js";
import { tectonicElevationOffsetMeters, tectonicSampleAt } from "../sim/DynamicLithosphere.js";
import { spatialOceanState } from "../sim/SpatialOceanCirculation.js";

function signed(value, digits = 2) {
  const rounded = Number(value).toFixed(digits);
  return Number(value) > 0 ? `+${rounded}` : rounded.replace("-", "−");
}

function latitudeLabel(latitude) {
  if (!Number.isFinite(latitude)) return null;
  return `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}`;
}

export function renderRegionPanel(ui, state, latitude, longitude, { climateLayer, hydroClimate, vegetation, spatialDetail }) {
  const region = regionalState(state, latitude, longitude, { climateLayer, hydroClimate, vegetation, spatialDetail });
  const river = hydroClimate?.networkSample?.(state, latitude, longitude, spatialDetail) ?? null;
  const waterSystem = hydroClimate?.groundwaterLakeSample?.(state, latitude, longitude, spatialDetail) ?? null;
  const soilEvolution = hydroClimate?.soilEvolutionSample?.(state, latitude, longitude, spatialDetail) ?? null;
  const tectonics = tectonicSampleAt(state, latitude, longitude, state.seed);
  const topographyOffsetMeters = tectonicElevationOffsetMeters(state, latitude, longitude, state.seed);
  const evolvedElevationMeters = bedrockElevationAt(latitude, longitude) + topographyOffsetMeters;
  const ocean = spatialOceanState(state, latitude, longitude, evolvedElevationMeters);
  const pft = ocean.isOcean ? null : vegetation?.pftDiagnostics?.(state, latitude, longitude, spatialDetail) ?? null;
  const latLabel = `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? "N" : "S"}`;
  const lonLabel = `${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? "E" : "W"}`;
  const localLake = Number(waterSystem?.lakeCoverageFraction) > 0.005;

  ui.locationTitle.textContent = ocean.isOcean
    ? "branch ocean"
    : localLake
      ? waterSystem.lakeSpilling ? "overflowing branch lake" : "closed branch lake"
      : pft?.succession?.biomeLabel ?? region.hydroclimatePotentialBiome ?? region.biome;

  const details = [`mean annual temperature ${signed(region.annualTemperature, 1)} °C`];
  if (Number.isFinite(region.annualPrecipitation)) details.push(`precipitation ${Math.round(region.annualPrecipitation).toLocaleString()} mm/yr`);
  if (Number.isFinite(region.cloudCover)) details.push(`cloud ${region.cloudCover.toFixed(1)}%`);
  if (Number.isFinite(region.windSpeed)) {
    const east = Number.isFinite(region.windEast) ? signed(region.windEast, 1) : "—";
    const north = Number.isFinite(region.windNorth) ? signed(region.windNorth, 1) : "—";
    details.push(`wind ${region.windSpeed.toFixed(1)} m/s · E ${east} / N ${north}`);
  }
  const itcz = latitudeLabel(region.itczLatitude);
  if (itcz) details.push(`wet-season ITCZ ${itcz}`);
  if (Number.isFinite(region.oceanMoistureFetch)) details.push(`ocean moisture fetch ${Math.round(region.oceanMoistureFetch * 100)}%`);
  if (region.landSurfaceFeedbackActive) {
    const surfaceBits = [];
    if (Number.isFinite(region.vegetationCoverFraction)) surfaceBits.push(`cover ${Math.round(region.vegetationCoverFraction * 100)}%`);
    if (Number.isFinite(region.estimatedVegetationLai)) surfaceBits.push(`est. LAI ${region.estimatedVegetationLai.toFixed(2)}`);
    if (Number.isFinite(region.moistureRecyclingRatio)) surfaceBits.push(`recycling ${region.moistureRecyclingRatio.toFixed(2)}×`);
    if (Number.isFinite(region.surfaceAlbedoDelta)) surfaceBits.push(`albedo Δ ${signed(region.surfaceAlbedoDelta, 3)}`);
    if (Number.isFinite(region.evaporativeFractionDelta)) surfaceBits.push(`ET fraction Δ ${signed(region.evaporativeFractionDelta, 3)}`);
    if (surfaceBits.length) details.push(`land feedback ${surfaceBits.join(" · ")}`);
  }
  if (Number.isFinite(region.subtropicalSubsidence) && region.subtropicalSubsidence > 0.12) details.push(`subsidence ${Math.round(region.subtropicalSubsidence * 100)}%`);
  if (Number.isFinite(region.orographicLift) && region.orographicLift > 0.08) details.push(`orographic lift ${Math.round(region.orographicLift * 100)}%`);
  if (Number.isFinite(region.rainShadow) && region.rainShadow > 0.08) details.push(`rain shadow ${Math.round(region.rainShadow * 100)}%`);
  details.push(`elevation ${Math.round(evolvedElevationMeters).toLocaleString()} m`);
  if (Math.abs(topographyOffsetMeters) >= 1) details.push(`branch tectonic offset ${signed(topographyOffsetMeters, 0)} m`);
  details.push(`plate ${tectonics.plateId} · ${tectonics.boundaryType}`);
  if (tectonics.boundaryWeight > 0.2) details.push(`uplift/rift ${signed(tectonics.upliftRateMmPerYear, 3)} mm/yr`);

  if (ocean.isOcean) {
    details.push(`SST ${signed(ocean.temperatureCelsius, 1)} °C`);
    details.push(`salinity ${ocean.salinityPsu.toFixed(2)} PSU`);
    details.push(`pH ${ocean.pH.toFixed(2)}`);
    details.push(`DIC ${Math.round(ocean.dissolvedInorganicCarbonUmolKg).toLocaleString()} µmol/kg`);
    details.push(`O₂ ${Math.round(ocean.oxygenUmolKg).toLocaleString()} µmol/kg`);
    details.push(`current ${ocean.currentSpeedMps.toFixed(2)} m/s`);
    details.push(`overturning ${ocean.overturningIndex.toFixed(2)}×`);
  } else {
    details.push(`soil moisture ${Math.round(region.moisture * 100)}%`);
    if (region.hydroclimatePotentialBiome && region.hydroclimatePotentialBiome !== region.biome) details.push(`hydroclimate tendency ${region.hydroclimatePotentialBiome}`);
    if (region.soilProfileApplied && Number.isFinite(region.soilWaterCapacity)) details.push(`checkpoint BIOME4 soil capacity ${Math.round(region.soilWaterCapacity).toLocaleString()} mm`);
    else if (region.soilStatus && region.soilStatus !== "unavailable") details.push(`BIOME4 soil ${region.soilStatus} · fallback bucket`);
    if (soilEvolution?.evolved) {
      const soilBits = [];
      if (Number.isFinite(soilEvolution.soilDepthMeters)) soilBits.push(`effective depth ${soilEvolution.soilDepthMeters.toFixed(2)} m`);
      if (Number.isFinite(soilEvolution.totalWaterCapacityMm)) soilBits.push(`capacity ${Math.round(soilEvolution.totalWaterCapacityMm).toLocaleString()} mm`);
      if (Number.isFinite(soilEvolution.capacityMultiplier)) soilBits.push(`${soilEvolution.capacityMultiplier.toFixed(2)}× checkpoint`);
      if (Number.isFinite(soilEvolution.soilProductionMmPerYear)) soilBits.push(`production ${soilEvolution.soilProductionMmPerYear.toFixed(3)} mm/yr`);
      if (Number.isFinite(soilEvolution.erosionLossMmPerYear)) soilBits.push(`loss ${soilEvolution.erosionLossMmPerYear.toFixed(3)} mm/yr`);
      if (Number.isFinite(soilEvolution.depositionGainMmPerYear)) soilBits.push(`deposition gain ${soilEvolution.depositionGainMmPerYear.toFixed(3)} mm/yr`);
      if (Number.isFinite(soilEvolution.fertilityIndex)) soilBits.push(`fertility ${soilEvolution.fertilityIndex.toFixed(2)}×`);
      if (soilBits.length) details.push(`evolved soil ${soilBits.join(" · ")}`);
    }
    if (Number.isFinite(region.surfaceRunoff)) details.push(`first-pass surface runoff ${Math.round(region.surfaceRunoff).toLocaleString()} mm/yr`);
    if (Number.isFinite(region.deepDrainage)) details.push(`first-pass deep drainage ${Math.round(region.deepDrainage).toLocaleString()} mm/yr`);
    if (waterSystem) {
      const groundwaterBits = [];
      if (Number.isFinite(waterSystem.baseflowMmPerYear)) groundwaterBits.push(`final baseflow ${waterSystem.baseflowMmPerYear.toFixed(1)} mm/yr`);
      if (Number.isFinite(waterSystem.baseflowFraction)) groundwaterBits.push(`${Math.round(waterSystem.baseflowFraction * 100)}% of routed flow`);
      if (Number.isFinite(waterSystem.groundwaterStorageChangeMmPerYear)) groundwaterBits.push(`aquifer storage ${signed(waterSystem.groundwaterStorageChangeMmPerYear, 1)} mm/yr`);
      if (Number.isFinite(waterSystem.groundwaterResidenceTimeYears)) groundwaterBits.push(`residence ~${Math.round(waterSystem.groundwaterResidenceTimeYears).toLocaleString()} yr`);
      if (groundwaterBits.length) details.push(`groundwater ${groundwaterBits.join(" · ")}`);
      if (localLake) {
        const lakeBits = [];
        if (Number.isFinite(waterSystem.lakeAreaKm2)) lakeBits.push(`area ${Math.round(waterSystem.lakeAreaKm2).toLocaleString()} km²`);
        if (Number.isFinite(waterSystem.lakeDepthMeters)) lakeBits.push(`local depth ${waterSystem.lakeDepthMeters.toFixed(1)} m`);
        if (Number.isFinite(waterSystem.lakeFillFraction)) lakeBits.push(`fill ${Math.round(waterSystem.lakeFillFraction * 100)}%`);
        if (Number.isFinite(waterSystem.lakeEvaporationM3PerYear)) lakeBits.push(`evap ${Math.round(waterSystem.lakeEvaporationM3PerYear).toLocaleString()} m³/yr`);
        if (waterSystem.lakeSpilling && Number.isFinite(waterSystem.lakeOverflowM3PerYear)) lakeBits.push(`spill ${Math.round(waterSystem.lakeOverflowM3PerYear).toLocaleString()} m³/yr`);
        if (lakeBits.length) details.push(`lake ${lakeBits.join(" · ")}`);
      }
    }
    if (Number.isFinite(region.runoffPotential) && !Number.isFinite(region.surfaceRunoff)) details.push(`local runoff ${Math.round(region.runoffPotential).toLocaleString()} mm/yr`);
    if (Number.isFinite(region.npp)) details.push(`BIOME4 NPP ${region.npp.toFixed(1)} source units`);
    if (Number.isFinite(region.lai)) details.push(`LAI ${region.lai.toFixed(2)}`);
    if (region.climateEligiblePftIds?.length) details.push(`PFT climate candidates ${region.climateEligiblePftIds.join("/")}`);
    if (region.climateUnresolvedPftIds?.length) details.push(`PFT unresolved ${region.climateUnresolvedPftIds.join("/")} · source-driver coverage`);
    if (pft?.competition) details.push(`competitive PFT ${pft.competition.selectedPftId}`);
    if (pft?.succession?.status === "resolved") details.push(`biome succession ${Math.round(pft.succession.progress * 100)}%`);
    if (pft?.status === "resolved") {
      details.push(`PFT daily phenology ${pft.resolvedCount}/${pft.candidateCount}`);
      if (pft.raingreenDiscrepancyPftIds?.length) details.push(`BIOME4 rain-threshold source quirk preserved for PFT ${pft.raingreenDiscrepancyPftIds.join("/")}`);
    } else if (pft?.status === "unresolved-water-trace") details.push("PFT competition unresolved at this soil cell");
    if (Number.isFinite(region.vegetationTransitionPressure) && region.vegetationTransitionPressure > 0.02) details.push(`vegetation transition pressure ${Math.round(region.vegetationTransitionPressure * 100)}%`);
    if (river) {
      details.push(`final river ${river.meanDischargeM3s.toLocaleString(undefined, { maximumFractionDigits: 2 })} m³/s`);
      details.push(`upstream area ${Math.round(river.upstreamAreaKm2).toLocaleString()} km²`);
      details.push(`forcing coverage ${Math.round(river.upstreamClimateForcingCoverageFraction * 100)}% of upstream area`);
      details.push(`drainage ${river.outlet} · ${river.routeCellsToOutlet} routed cells`);
      if (river.geomorphologyPolicy) {
        const geomorphicBits = [];
        if (Number.isFinite(river.erosionRateMmPerYear)) geomorphicBits.push(`erosion ${river.erosionRateMmPerYear.toFixed(3)} mm/yr`);
        if (Number.isFinite(river.depositionRateMmPerYear)) geomorphicBits.push(`deposition ${river.depositionRateMmPerYear.toFixed(3)} mm/yr`);
        if (Number.isFinite(river.geomorphicElevationOffsetMeters)) geomorphicBits.push(`relief Δ ${signed(river.geomorphicElevationOffsetMeters, 1)} m`);
        if (Number.isFinite(river.sedimentOutgoingM3PerYear)) geomorphicBits.push(`sediment ${river.sedimentOutgoingM3PerYear.toLocaleString(undefined, { maximumFractionDigits: 0 })} m³/yr`);
        if (geomorphicBits.length) details.push(`geomorphology ${geomorphicBits.join(" · ")}`);
        if (river.drainageReroutedCellCount > 0) details.push(`drainage links migrated ${river.drainageReroutedCellCount.toLocaleString()} cells globally at this network solve`);
      }
    }
  }

  ui.locationDetail.textContent = `${region.checkpointClimate ? "Climate" : "Modeled climate"}: ${details.join(" · ")}.`;
  const routingNote = river && !ocean.isOcean
    ? ` · ${river.spacingDegrees}° accumulating network · global forcing coverage ${Math.round((river.globalClimateForcingFraction ?? river.globalClimateForcingCoverageFraction) * 100)}% · river closure ${Math.abs(river.networkRelativeClosureError).toExponential(1)}${Number.isFinite(river.sedimentRelativeClosureError) ? ` · sediment closure ${Math.abs(river.sedimentRelativeClosureError).toExponential(1)}` : ""}${Number.isFinite(waterSystem?.waterSystemRelativeClosureError) ? ` · full water closure ${Math.abs(waterSystem.waterSystemRelativeClosureError).toExponential(1)}` : ""}`
    : "";
  const oceanNote = ocean.isOcean ? ` · ${ocean.policy}` : "";
  const atmosphereNote = region.atmospherePolicy ? ` · ${region.atmospherePolicy}` : "";
  const landSurfaceNote = region.landSurfacePolicy ? ` · ${region.landSurfacePolicy}` : "";
  const soilNote = soilEvolution?.policy ? ` · ${soilEvolution.policy}` : "";
  const geomorphologyNote = river?.geomorphologyPolicy ? ` · ${river.geomorphologyPolicy}` : "";
  const groundwaterNote = waterSystem?.groundwaterPolicy ? ` · ${waterSystem.groundwaterPolicy}` : "";
  const lakeNote = waterSystem?.lakePolicy ? ` · ${waterSystem.lakePolicy}` : "";
  ui.locationCoordinates.textContent = `${latLabel}  ${lonLabel} · ${region.confidence}${routingNote}${oceanNote}${atmosphereNote}${landSurfaceNote}${soilNote}${geomorphologyNote}${groundwaterNote}${lakeNote}`;
}