export const EARTH_SYSTEM_STATUS = Object.freeze({
  orbit: Object.freeze({ mode: "external-forcing", status: "dynamic", note: "La2004 orbital trajectory; not branch-randomized." }),
  geology: Object.freeze({ mode: "provisional-process", status: "dynamic", note: "Stochastic mean-reverting geologic activity drives degassing; plate tectonics/topography are not yet evolved." }),
  carbon: Object.freeze({ mode: "reservoir-process", status: "dynamic", note: "Atmosphere, surface/deep ocean, land, methane carbon and sediment exchange mass-conserving carbon." }),
  methane: Object.freeze({ mode: "source-sink-process", status: "dynamic", note: "Wetland, inland-water and geologic sources with temperature-sensitive atmospheric oxidation." }),
  nitrogen: Object.freeze({ mode: "reservoir-process", status: "dynamic", note: "N2, terrestrial/ocean reactive nitrogen and atmospheric N2O exchange through fixation, production and photolysis." }),
  climate: Object.freeze({ mode: "energy-balance-emulator", status: "dynamic", note: "CO2, CH4 and N2O forcing, orbit and ice-albedo feedback jointly drive temperature." }),
  ocean: Object.freeze({ mode: "global-reservoir-emulator", status: "dynamic", note: "Surface/deep carbon exchange and lagged ocean heat are explicit global states." }),
  cryosphere: Object.freeze({ mode: "climate-response", status: "dynamic", note: "Ice responds to branch temperature and orbit; normalized 0–1 because the variable is defined as an index." }),
  seaLevel: Object.freeze({ mode: "branch-response", status: "dynamic", note: "Driven by simulated ice and ocean heat; reconstructed sea level is retained only as a comparison series." }),
  hydrology: Object.freeze({ mode: "spatial-materialization", status: "dynamic", note: "Closed water balance and routing respond to evolving hydroclimate." }),
  vegetation: Object.freeze({ mode: "spatial-materialization", status: "dynamic-partial", note: "NPP/LAI/PFT diagnostics respond to climate, water and CO2; fully closed categorical PFT competition is still incomplete." }),
  fauna: Object.freeze({ mode: "aggregate-food-web", status: "dynamic-partial", note: "Herbivore and carnivore biomass respond to carrying capacity; species-resolved demography/evolution remain future work." }),
  hominins: Object.freeze({ mode: "aggregate-population", status: "dynamic-partial", note: "Food-web and climate carrying capacity evolve; culture, technology and species-resolved demography are not yet simulated." }),
  magnetism: Object.freeze({ mode: "secular-field-emulator", status: "dynamic-partial", note: "Reversal chronology is constrained; post-reversal field strength evolves stochastically around modern-scale strength." }),
  terrain: Object.freeze({ mode: "reference-layer", status: "fixed-explicit", note: "Modern ETOPO bedrock remains a declared baseline; paleo-topography/isostasy/tectonics are not yet evolved." })
});

export const DYNAMIC_STATE_FIELDS = Object.freeze([
  "co2", "methane", "nitrousOxide", "greenhouseForcing", "temperatureAnomaly", "oceanTemperatureAnomaly",
  "iceIndex", "seaLevel", "geologicActivityIndex", "productivityIndex", "herbivoreBiomass", "carnivoreBiomass",
  "homininPopulationIndex", "magneticStrength", "atmosphericCarbonPgC", "oceanSurfaceCarbonPgC",
  "oceanDeepCarbonPgC", "terrestrialCarbonPgC", "methaneCarbonPgC", "terrestrialReactiveNitrogenTgN",
  "oceanReactiveNitrogenTgN", "atmosphericN2ONitrogenTgN"
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
