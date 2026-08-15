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
    householdCount: Math.max(0, Math.round(Number(state?.homininHouseholdCount) || 0)),
    residentialGroupCount: Math.max(0, Math.round(Number(state?.homininResidentialGroupCount) || 0)),
    activeSiteCount: Math.max(0, Math.round(Number(state?.homininActiveSiteCount) || 0)),
    persistentSiteCount: Math.max(0, Math.round(Number(state?.homininPersistentSiteCount) || 0)),
    largestSitePopulationPersons: Math.max(0, Math.round(Number(state?.homininLargestSitePopulationPersons) || 0)),
    meanSettlementPersistence: Math.max(0, Math.min(1, Number(state?.homininMeanSettlementPersistence) || 0)),
    exchangeEdgeCount: Math.max(0, Math.round(Number(state?.homininExchangeEdgeCount) || 0)),
    exchangePersonTripsPerYear: Math.max(0, Number(state?.homininExchangePersonTripsPerYear) || 0),
    storedFoodPersonDays: Math.max(0, Number(state?.homininStoredFoodPersonDays) || 0),
    waterTransportSiteCount: Math.max(0, Math.round(Number(state?.homininWaterTransportSiteCount) || 0)),
    waterRouteCount: Math.max(0, Math.round(Number(state?.homininWaterRouteCount) || 0)),
    waterPersonTripsPerYear: Math.max(0, Number(state?.homininWaterPersonTripsPerYear) || 0),
    maxWaterTransportRangeKm: Math.max(0, Number(state?.homininMaxWaterTransportRangeKm) || 0),
    conflictEdgeCount: Math.max(0, Math.round(Number(state?.homininConflictEdgeCount) || 0)),
    resourceSeizurePersonDaysPerYear: Math.max(0, Number(state?.homininResourceSeizurePersonDaysPerYear) || 0),
    waterborneConflictShare: Math.max(0, Math.min(1, Number(state?.homininWaterborneConflictShare) || 0)),
    defensiveSiteCount: Math.max(0, Math.round(Number(state?.homininDefensiveSiteCount) || 0)),
    highDefenseSiteCount: Math.max(0, Math.round(Number(state?.homininHighDefenseSiteCount) || 0)),
    maxDefensiveWorksIndex: Math.max(0, Math.min(1, Number(state?.homininMaxDefensiveWorksIndex) || 0)),
    policy: state?.homininDemographyPolicy ?? null,
    socialPolicy: state?.homininSocialPolicy ?? null,
    waterTransportPolicy: state?.homininWaterTransportPolicy ?? null,
    conflictConstructionPolicy: state?.homininConflictConstructionPolicy ?? null
  });
  globalThis[HOMININ_DEMOGRAPHY_TELEMETRY_KEY] = snapshot;
  return snapshot;
}
