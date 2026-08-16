export const EARTH_SYSTEM_STATUS = Object.freeze({
  orbit: Object.freeze({ mode: "external-forcing", status: "dynamic", note: "La2004 orbital trajectory; not branch-randomized." }),
  geology: Object.freeze({ mode: "provisional-process", status: "dynamic-partial", note: "Stochastic mantle/geologic activity drives degassing and the evolving lithosphere; full mantle convection is not directly solved." }),
  tectonics: Object.freeze({ mode: "moving-plate-field", status: "dynamic-partial", note: "Deterministic moving plate domains create convergent/divergent/transform boundary strain and branch topographic change over the ETOPO checkpoint baseline." }),
  carbon: Object.freeze({ mode: "reservoir-process", status: "dynamic", note: "Atmosphere, surface/deep ocean, land, methane carbon and sediment exchange mass-conserving carbon." }),
  methane: Object.freeze({ mode: "source-sink-process", status: "dynamic", note: "Wetland, inland-water and geologic sources with temperature-sensitive atmospheric oxidation." }),
  nitrogen: Object.freeze({ mode: "reservoir-process", status: "dynamic", note: "N2, terrestrial/ocean reactive nitrogen and atmospheric N2O exchange through fixation, production and photolysis." }),
  climate: Object.freeze({ mode: "energy-balance-emulator", status: "dynamic", note: "CO2, CH4 and N2O forcing, orbit and ice-albedo feedback jointly drive temperature." }),
  ocean: Object.freeze({ mode: "spatial-circulation-reservoir", status: "dynamic-partial", note: "Overturning, ventilation, salinity, oxygen, surface/deep carbon exchange and spatial carbonate chemistry evolve; primitive-equation currents are not solved." }),
  cryosphere: Object.freeze({ mode: "climate-response", status: "dynamic", note: "Ice responds to branch temperature and orbit; normalized 0–1 because the variable is defined as an index." }),
  seaLevel: Object.freeze({ mode: "branch-response", status: "dynamic", note: "Driven by simulated ice and ocean heat; reconstructed sea level is retained only as a comparison series." }),
  hydrology: Object.freeze({ mode: "spatial-materialization", status: "dynamic", note: "Closed water balance and routing respond to evolving hydroclimate." }),
  vegetation: Object.freeze({ mode: "competitive-spatial-materialization", status: "dynamic-partial", note: "NPP/LAI/PFT physiology respond to climate, water, CO2 and nitrogen; selected-region competition and the BIOME4 classifier drive lagged model-derived branch succession while shared PFT hydrology feedback remains incomplete." }),
  fauna: Object.freeze({ mode: "open-lineage-evolution", status: "dynamic-partial", note: "Anonymous species lineages compete for energy, adapt traits, speciate and go extinct without an imposed richness ceiling; aggregate predation and herbivory feed back through their existing ecology and vegetation owners, while spatial individual demography remains future work." }),
  hominins: Object.freeze({ mode: "species-lineage-coevolution", status: "dynamic-partial", note: "Multiple hominin lineages undergo ecological selection, speciation/extinction and evolving cognition, mobility, communication and sociality." }),
  culture: Object.freeze({ mode: "population-culture-coevolution", status: "dynamic-partial", note: "Innovation, cultural loss, tools, communication and fire reliance emerge continuously from lineage traits and effective population; individual minds and institutions remain future work." }),
  magnetism: Object.freeze({ mode: "secular-field-emulator", status: "dynamic-partial", note: "Reversal chronology is constrained; post-reversal field strength evolves stochastically around modern-scale strength." }),
  terrain: Object.freeze({ mode: "evolving-reference-baseline", status: "dynamic-partial", note: "ETOPO is the declared checkpoint baseline; moving plate-boundary uplift/rifting and long-wavelength dynamic topography modify branch terrain while erosion/isostasy remain simplified." })
});

export const DYNAMIC_STATE_FIELDS = Object.freeze([
  "co2", "methane", "nitrousOxide", "greenhouseForcing", "temperatureAnomaly", "oceanTemperatureAnomaly",
  "oceanOverturningIndex", "oceanVentilationIndex", "iceIndex", "seaLevel", "geologicActivityIndex", "tectonicTimeMyr",
  "tectonicBoundaryActivity", "productivityIndex", "grazingPressureIndex", "herbivoreBiomass", "carnivoreBiomass", "homininPopulationIndex",
  "cognitionIndex", "cultureIndex", "technologyIndex", "communicationIndex", "magneticStrength", "atmosphericCarbonPgC",
  "oceanSurfaceCarbonPgC", "oceanDeepCarbonPgC", "terrestrialCarbonPgC", "methaneCarbonPgC",
  "terrestrialReactiveNitrogenTgN", "oceanReactiveNitrogenTgN", "atmosphericN2ONitrogenTgN"
]);

export function auditTrajectory(states, { epsilon = 1e-9 } = {}) {
  if (!Array.isArray(states) || states.length < 2) throw new TypeError("auditTrajectory requires at least two state snapshots.");
  const nonFinite = [];
  const unchanged = [];

  for (const field of DYNAMIC_STATE_FIELDS) {
    const values = states.map((state) => Number(state?.[field]));
    if (values.some((value) => !Number.isFinite(value))) {
      nonFinite.push(field);
      continue;
    }
    const baseline = values[0];
    if (values.every((value) => Math.abs(value - baseline) <= epsilon)) unchanged.push(field);
  }

  return Object.freeze({
    healthy: nonFinite.length === 0 && unchanged.length === 0,
    nonFinite: Object.freeze(nonFinite),
    unexpectedlyUnchanged: Object.freeze(unchanged),
    declaredFixedSystems: Object.freeze(Object.entries(EARTH_SYSTEM_STATUS)
      .filter(([, value]) => value.status.startsWith("fixed"))
      .map(([id]) => id)),
    partialSystems: Object.freeze(Object.entries(EARTH_SYSTEM_STATUS)
      .filter(([, value]) => value.status.includes("partial"))
      .map(([id]) => id))
  });
}
