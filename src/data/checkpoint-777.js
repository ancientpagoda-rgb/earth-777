const datum = (value, unit, confidence, kind, sources, uncertainty = null) => Object.freeze({
  value,
  unit,
  confidence,
  kind,
  sources: Object.freeze(sources),
  uncertainty
});

export const CHECKPOINT_777 = Object.freeze({
  id: "earth-777ka-v0.1",
  yearsBeforePresent: 777_000,
  stage: "Late MIS 19c",
  description: "A constrained checkpoint near the close of MIS 19c and the onset of Northern Hemisphere glacial inception.",
  boundary: Object.freeze({
    eccentricity: datum(0.023, "ratio", "high", "study", ["ruddiman-2018-mis19"]),
    obliquity: datum(23.3, "degrees", "high", "study", ["ruddiman-2018-mis19"]),
    climaticPrecession: datum(108.9, "degrees", "high", "study", ["ruddiman-2018-mis19"]),
    co2: datum(245, "ppm", "high", "study", ["ruddiman-2018-mis19"], 3),
    methane: datum(631, "ppb", "high", "study", ["ruddiman-2018-mis19"], 30),
    nitrousOxide: datum(270, "ppb", "medium", "study", ["ruddiman-2018-mis19"], 8),
    globalTemperatureAnomaly: datum(-1.27, "K vs 1850 PI", "medium", "model", ["ruddiman-2018-mis19"], 0.35),
    seaLevelAnomaly: datum(-12.76, "m vs modern", "medium", "study", ["spratt-lisiecki-2016"], 9.52),
    iceVolumeIndex: datum(0.18, "0 interglacial–1 glacial", "low", "prior", ["lr04", "ruddiman-2018-mis19"], 0.15),
    magneticDipoleStrength: datum(0.42, "fraction modern", "low", "prior", ["mb-reversal"], 0.22),
    magneticPolarity: datum(-1, "reversed", "medium", "model", ["mb-reversal"])
  }),
  layers: Object.freeze({
    terrain: Object.freeze({ status: "integrated ETOPO 2022 bedrock baseline", target: "time-varying paleo topography and isostasy", sources: ["etopo-2022"] }),
    climate: Object.freeze({ status: "Krapp 777 ka checkpoint + model-derived gridded branch response", target: "coupled branch-evolving atmospheric circulation", sources: ["krapp-2021"] }),
    hydrology: Object.freeze({ status: "BIOME4 static 0.5° two-layer soil + closed daily land-water budget + upstream-accumulating ETOPO river network", target: "groundwater/baseflow, lakes, snow/glacier routing, floodplain/channel storage and sub-degree observed routing", sources: ["krapp-2021", "biome4-4.1-soil", "etopo-2022", "priestley-taylor-1972", "fao56"] }),
    orbital: Object.freeze({ status: "Vavrus-anchored La2004 series", target: "Direct 1 kyr astronomical forcing", sources: ["ruddiman-2018-mis19", "la2004"] }),
    seaLevel: Object.freeze({ status: "reconstruction with uncertainty", target: "Spratt–Lisiecki five-record stack", sources: ["spratt-lisiecki-2016"] }),
    vegetation: Object.freeze({ status: "published Krapp BIOME4 777 ka biome/NPP/LAI checkpoint + model-derived hydro-CO₂ response + independent BIOME4 4.1 PFT climate eligibility using static tmin/snow diagnostics and daily rooting/water/phenology diagnostics", target: "PFT-specific hydrology feedback, optimized PFT LAI/NPP, fire/dryness diagnostics, competition and categorical biome transitions", sources: ["krapp-2021", "biome4-4.1-soil"] }),
    fauna: Object.freeze({ status: "functional guilds", target: "Neotoma/PBDB evidence envelopes", sources: ["neotoma", "madingley"] }),
    hominins: Object.freeze({ status: "regional populations", target: "ROAD evidence envelopes", sources: ["road"] })
  })
});

export function checkpointState() {
  const b = CHECKPOINT_777.boundary;
  return {
    yearBP: CHECKPOINT_777.yearsBeforePresent,
    elapsedYears: 0,
    stage: CHECKPOINT_777.stage,
    eccentricity: b.eccentricity.value,
    obliquity: b.obliquity.value,
    precession: b.climaticPrecession.value,
    co2: b.co2.value,
    methane: b.methane.value,
    nitrousOxide: b.nitrousOxide.value,
    temperatureAnomaly: b.globalTemperatureAnomaly.value,
    seaLevel: b.seaLevelAnomaly.value,
    seaLevelReference: b.seaLevelAnomaly.value,
    seaLevelUncertainty: b.seaLevelAnomaly.uncertainty,
    seaLevelLower95: -33.06,
    seaLevelUpper95: 4.17,
    iceIndex: b.iceVolumeIndex.value,
    magneticStrength: b.magneticDipoleStrength.value,
    magneticPolarity: b.magneticPolarity.value,
    productivityIndex: 1,
    herbivoreBiomass: 1,
    carnivoreBiomass: 1,
    homininPopulationIndex: 1,
    branch: 1
  };
}
