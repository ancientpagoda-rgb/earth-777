export const HOMININ_DEMOGRAPHY_TELEMETRY_KEY = "__EARTH777_HOMININ_DEMOGRAPHY__";

export function publishHomininDemography(state) {
  if (typeof globalThis !== "object") return null;
  const snapshot = Object.freeze({
    populationPersons: Math.max(0, Math.round(Number(state?.homininPopulationPersons) || 0)),
    birthsPerYear: Math.max(0, Number(state?.homininBirthsPerYear) || 0),
    deathsPerYear: Math.max(0, Number(state?.homininDeathsPerYear) || 0),
    growthPerYear: Number(state?.homininDemographicGrowthPerYear) || 0,
    demeCount: Math.max(0, Math.round(Number(state?.homininDemeCount) || 0)),
    speciesRichness: Math.max(0, Math.round(Number(state?.homininSpeciesRichness) || 0)),
    femalePersons: Math.max(0, Math.round(Number(state?.homininFemalePersons) || 0)),
    malePersons: Math.max(0, Math.round(Number(state?.homininMalePersons) || 0)),
    policy: state?.homininDemographyPolicy ?? null
  });
  globalThis[HOMININ_DEMOGRAPHY_TELEMETRY_KEY] = snapshot;
  return snapshot;
}
