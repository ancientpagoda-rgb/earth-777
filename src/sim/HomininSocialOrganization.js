import { dynamicSurfaceElevationMeters } from "./GeneralAtmosphereCirculation.js";

const EARTH_RADIUS_KM = 6371.0088;
const SOCIAL_INTERVAL_YEARS = 250;
const SPATIAL_BIN_DEGREES = 12;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const relax = (current, target, dtYears, tauYears) => current + (target - current) * (1 - Math.exp(-Math.max(0, dtYears) / Math.max(1e-6, tauYears)));

export const HOMININ_SOCIAL_POLICY = "household-band-site-exchange-network-v1";

function hash32(value) {
  let x = Number(value) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function unit(seed, salt) {
  return hash32((Number(seed) >>> 0) ^ Math.imul((Number(salt) || 0) + 1, 0x9e3779b1)) / 0x100000000;
}

function idNumber(id) {
  const match = String(id ?? "").match(/\d+/);
  return match ? Number(match[0]) : hash32(String(id ?? "").length);
}

function wrapLongitude(value) {
  return ((Number(value) + 540) % 360) - 180;
}

function distanceKm(latA, lonA, latB, lonB) {
  const r = Math.PI / 180;
  const phi1 = Number(latA) * r;
  const phi2 = Number(latB) * r;
  const dPhi = (Number(latB) - Number(latA)) * r;
  const dLambda = wrapLongitude(Number(lonB) - Number(lonA)) * r;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function destination(latitude, longitude, bearingRadians, distanceKmValue) {
  const delta = Math.max(0, Number(distanceKmValue) || 0) / EARTH_RADIUS_KM;
  const phi1 = Number(latitude) * Math.PI / 180;
  const lambda1 = Number(longitude) * Math.PI / 180;
  const phi2 = Math.asin(clamp(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearingRadians),
    -1,
    1
  ));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
  );
  return { latitude: clamp(phi2 * 180 / Math.PI, -89.5, 89.5), longitude: wrapLongitude(lambda2 * 180 / Math.PI) };
}

function moveToward(latitude, longitude, targetLatitude, targetLongitude, fraction) {
  const f = clamp(fraction, 0, 1);
  const dLon = wrapLongitude(Number(targetLongitude) - Number(longitude));
  return {
    latitude: clamp(Number(latitude) + (Number(targetLatitude) - Number(latitude)) * f, -89.5, 89.5),
    longitude: wrapLongitude(Number(longitude) + dLon * f)
  };
}

function localEnvironment(state, latitude, longitude) {
  const seaLevel = Number(state?.seaLevel) || 0;
  const centerElevation = dynamicSurfaceElevationMeters(state, latitude, longitude);
  if (!Number.isFinite(centerElevation) || centerElevation <= seaLevel) {
    return Object.freeze({ land: false, elevationMeters: centerElevation, coastalAccess: 1, ruggedness: 0, resourceReliability: 0, resourceConcentration: 0, defensibility: 0 });
  }

  let waterSamples = 0;
  let reliefSum = 0;
  let maxRelief = 0;
  const radiusKm = 70;
  for (let index = 0; index < 8; index += 1) {
    const point = destination(latitude, longitude, index * Math.PI / 4, radiusKm);
    const elevation = dynamicSurfaceElevationMeters(state, point.latitude, point.longitude);
    if (!Number.isFinite(elevation) || elevation <= seaLevel) waterSamples += 1;
    if (Number.isFinite(elevation)) {
      const relief = Math.abs(elevation - centerElevation);
      reliefSum += relief;
      maxRelief = Math.max(maxRelief, relief);
    }
  }

  const coastalAccess = clamp(waterSamples / 3, 0, 1);
  const ruggedness = clamp((reliefSum / 8) / 1300, 0, 1);
  const productivity = clamp(Number(state?.productivityIndex) || 1, 0.02, 5);
  const productivitySignal = clamp(Math.sqrt(productivity / 1.4), 0.08, 1.6);
  const climateStress = clamp(Math.abs((Number(state?.temperatureAnomaly) || -1.27) + 1.27) / 5, 0, 1.5);
  const resourceReliability = clamp(
    0.18 + productivitySignal * 0.48 + coastalAccess * 0.16 + (1 - ruggedness) * 0.10 - climateStress * 0.08,
    0.03,
    1
  );
  const resourceConcentration = clamp(
    0.10 + coastalAccess * 0.45 + productivitySignal * 0.18 + ruggedness * 0.08,
    0.02,
    1
  );
  const defensibility = clamp(ruggedness * 0.58 + Math.min(1, Math.max(0, centerElevation - seaLevel) / 1800) * 0.30, 0, 1);
  return Object.freeze({ land: true, elevationMeters: centerElevation, coastalAccess, ruggedness, resourceReliability, resourceConcentration, defensibility, maxReliefMeters: maxRelief });
}

function socialTargets(state, lineage, deme, environment) {
  const sociality = clamp(lineage?.sociality ?? 0.5, 0, 1);
  const communication = clamp(lineage?.communication ?? 0.3, 0, 1);
  const culture = clamp(lineage?.cumulativeCulture ?? 0.1, 0, 1);
  const tools = clamp(lineage?.toolComplexity ?? 0.15, 0, 1);
  const fire = clamp(lineage?.fireReliance ?? 0.05, 0, 1);
  const mobility = clamp(lineage?.mobility ?? 0.55, 0, 1);
  const headcount = Math.max(0, Math.round(Number(deme?.headcount) || 0));

  const householdSize = clamp(4.15 + sociality * 0.85 + culture * 0.35, 3.4, 6.5);
  const residentialGroupSize = clamp(
    10 + sociality * 24 + communication * 18 + environment.resourceReliability * 10,
    householdSize * 2,
    92
  );
  const aggregationScale = 2.1 + communication * 1.7 + sociality * 0.9 + culture * 0.7;
  const periodicAggregationSize = Math.min(headcount, Math.max(residentialGroupSize, residentialGroupSize * aggregationScale));
  const storageTechnology = clamp((tools - 0.07) * 0.64 + culture * 0.34 + fire * 0.12, 0, 1);
  const storageCapacityDays = 2 * Math.exp(storageTechnology * 5.3);
  const surplusFraction = clamp(
    (environment.resourceReliability - 0.38) * 0.30 + tools * 0.07 + culture * 0.06,
    0,
    0.38
  );
  const settlementDrive = storageTechnology
    * (0.24 + environment.resourceConcentration * 0.76)
    * (0.22 + environment.resourceReliability * 0.78)
    * (0.58 + sociality * 0.42);
  const climateStress = clamp(Math.abs((Number(state?.temperatureAnomaly) || -1.27) + 1.27) / 6, 0, 1);
  const mobilityDrive = mobility * (0.72 + (1 - environment.resourceReliability) * 0.46 + climateStress * 0.12);
  const persistenceTarget = clamp(settlementDrive / Math.max(1e-6, settlementDrive + mobilityDrive * 0.82 + 0.12), 0, 1);
  const coordinationMultiplier = Math.exp(communication * 1.2 + culture * 1.05 + sociality * 0.55);
  const sitePopulationTarget = Math.min(
    headcount,
    Math.max(residentialGroupSize, residentialGroupSize * (1 + persistenceTarget * coordinationMultiplier * 2.5))
  );
  const reserveTargetPersonDays = headcount
    * storageCapacityDays
    * surplusFraction
    * (0.12 + persistenceTarget * 0.88);
  const exchangeReachKm = 120 + mobility * 780 + communication * 1080 + culture * 860;
  const movesPerYear = Math.max(0,
    (0.25 + mobility * 5.3)
    * (1 - persistenceTarget) ** 2
    * (0.82 + climateStress * 0.35)
  );

  return Object.freeze({
    householdSize,
    householdCount: headcount > 0 ? Math.max(1, Math.round(headcount / householdSize)) : 0,
    residentialGroupSize,
    residentialGroupCount: headcount > 0 ? Math.max(1, Math.ceil(headcount / residentialGroupSize)) : 0,
    periodicAggregationSize,
    storageTechnology,
    storageCapacityDays,
    surplusFraction,
    persistenceTarget,
    sitePopulationTarget,
    reserveTargetPersonDays,
    exchangeReachKm,
    movesPerYear,
    coordinationMultiplier
  });
}

function createSite(state, deme, lineage, targets, environment) {
  state.nextHomininSiteId ??= 1;
  const id = `HS${state.nextHomininSiteId++}`;
  const initialPersistence = targets.persistenceTarget * 0.72;
  return {
    id,
    occupantDemeId: deme.id,
    lineageId: lineage.id,
    latitude: Number(deme.latitude),
    longitude: Number(deme.longitude),
    active: true,
    foundedYearBP: Math.round(Number(state.yearBP) || 777_000),
    abandonedYearBP: null,
    tenureYears: 0,
    persistence: initialPersistence,
    sitePopulationPersons: Math.max(1, Math.round(targets.sitePopulationTarget)),
    householdSizePersons: targets.householdSize,
    householdCount: Math.max(1, Math.round(targets.sitePopulationTarget / targets.householdSize)),
    builtEnvironmentIndex: initialPersistence * targets.storageTechnology * 0.2,
    storedFoodPersonDays: Math.max(0, targets.reserveTargetPersonDays * 0.35),
    resourceReliability: environment.resourceReliability,
    resourceConcentration: environment.resourceConcentration,
    coastalAccess: environment.coastalAccess,
    ruggedness: environment.ruggedness,
    defensibility: environment.defensibility
  };
}

function activeSiteForDeme(state, demeId) {
  return (state.homininSites ?? []).find((site) => site.active && site.occupantDemeId === demeId) ?? null;
}

function updateDemeAndSite(state, deme, lineage, elapsedYears, seed) {
  const environment = localEnvironment(state, deme.latitude, deme.longitude);
  if (!environment.land) return null;
  const targets = socialTargets(state, lineage, deme, environment);
  let site = activeSiteForDeme(state, deme.id);
  if (!site) {
    site = createSite(state, deme, lineage, targets, environment);
    state.homininSites.push(site);
  }

  const previousPersistence = clamp(site.persistence ?? targets.persistenceTarget, 0, 1);
  const siteDistance = distanceKm(deme.latitude, deme.longitude, site.latitude, site.longitude);
  if (previousPersistence >= 0.34 && siteDistance > 75 + (1 - previousPersistence) * 180) {
    site.active = false;
    site.abandonedYearBP = Math.round(Number(state.yearBP) || 0);
    site.occupantDemeId = null;
    site.sitePopulationPersons = 0;
    site.storedFoodPersonDays = 0;
    site = createSite(state, deme, lineage, targets, environment);
    state.homininSites.push(site);
  } else if (previousPersistence < 0.34 && siteDistance > 10) {
    site.latitude = Number(deme.latitude);
    site.longitude = Number(deme.longitude);
    site.foundedYearBP = Math.round(Number(state.yearBP) || 0);
    site.tenureYears = 0;
  } else if (previousPersistence >= 0.34 && siteDistance > 0.5) {
    const retention = clamp(previousPersistence ** 2 * 0.78, 0, 0.76);
    const anchored = moveToward(deme.latitude, deme.longitude, site.latitude, site.longitude, retention);
    deme.latitude = anchored.latitude;
    deme.longitude = anchored.longitude;
  }

  site.persistence = clamp(relax(site.persistence ?? 0, targets.persistenceTarget, elapsedYears, 700), 0, 1);
  site.sitePopulationPersons = Math.max(1, Math.round(relax(
    site.sitePopulationPersons ?? targets.residentialGroupSize,
    targets.sitePopulationTarget,
    elapsedYears,
    360
  )));
  site.sitePopulationPersons = Math.min(Math.max(0, Number(deme.headcount) || 0), site.sitePopulationPersons);
  site.householdSizePersons = targets.householdSize;
  site.householdCount = site.sitePopulationPersons > 0 ? Math.max(1, Math.round(site.sitePopulationPersons / targets.householdSize)) : 0;
  site.storedFoodPersonDays = Math.max(0, relax(
    site.storedFoodPersonDays ?? 0,
    targets.reserveTargetPersonDays,
    elapsedYears,
    120 + (1 - targets.storageTechnology) * 220
  ));
  const builtTarget = clamp(
    site.persistence
      * (0.18 + targets.storageTechnology * 0.82)
      * Math.log1p(site.sitePopulationPersons) / Math.log1p(1200),
    0,
    1
  );
  site.builtEnvironmentIndex = clamp(relax(site.builtEnvironmentIndex ?? 0, builtTarget, elapsedYears, 850), 0, 1);
  site.tenureYears = Math.max(0, Number(site.tenureYears) || 0) + elapsedYears;
  site.resourceReliability = environment.resourceReliability;
  site.resourceConcentration = environment.resourceConcentration;
  site.coastalAccess = environment.coastalAccess;
  site.ruggedness = environment.ruggedness;
  site.defensibility = environment.defensibility;
  site.lineageId = lineage.id;
  site.occupantDemeId = deme.id;

  deme.householdSizePersons = targets.householdSize;
  deme.householdCount = targets.householdCount;
  deme.meanResidentialGroupSizePersons = targets.residentialGroupSize;
  deme.residentialGroupCount = targets.residentialGroupCount;
  deme.periodicAggregationSizePersons = targets.periodicAggregationSize;
  deme.storageTechnologyIndex = targets.storageTechnology;
  deme.storageCapacityDays = targets.storageCapacityDays;
  deme.surplusFraction = targets.surplusFraction;
  deme.residentialMovesPerYear = targets.movesPerYear;
  deme.settlementPersistence = site.persistence;
  deme.activeSiteId = site.id;
  deme.exchangeReachKm = targets.exchangeReachKm;
  deme.resourceReliability = environment.resourceReliability;
  deme.resourceConcentration = environment.resourceConcentration;
  deme.coastalAccess = environment.coastalAccess;
  deme.defensibility = environment.defensibility;
  deme.socialOrganizationSeed = hash32((Number(seed) >>> 0) ^ idNumber(deme.id));
  return site;
}

function decayAbandonedSites(state, elapsedYears) {
  for (const site of state.homininSites ?? []) {
    if (site.active) continue;
    site.builtEnvironmentIndex = Math.max(0, (Number(site.builtEnvironmentIndex) || 0) * Math.exp(-elapsedYears / 4_500));
    site.storedFoodPersonDays = 0;
  }
  const retained = [];
  for (const site of state.homininSites ?? []) {
    if (site.active || Number(site.builtEnvironmentIndex) > 0.003) retained.push(site);
    else state.homininDecayedSiteCount = (Number(state.homininDecayedSiteCount) || 0) + 1;
  }
  state.homininSites = retained;
}

function spatialKey(latitude, longitude) {
  const latCell = Math.floor((clamp(latitude, -89.999, 89.999) + 90) / SPATIAL_BIN_DEGREES);
  const lonCell = Math.floor((wrapLongitude(longitude) + 180) / SPATIAL_BIN_DEGREES);
  return `${latCell}:${lonCell}`;
}

function rebuildExchangeNetwork(state, elapsedYears) {
  const demes = (state.homininDemes ?? []).filter((deme) => deme.headcount > 0 && Number.isFinite(deme.latitude) && Number.isFinite(deme.longitude));
  const byId = new Map(demes.map((deme) => [deme.id, deme]));
  const lineages = new Map((state.homininLineages ?? []).map((lineage) => [lineage.id, lineage]));
  const sitesByDeme = new Map((state.homininSites ?? []).filter((site) => site.active).map((site) => [site.occupantDemeId, site]));
  const bins = new Map();
  for (const deme of demes) {
    const key = spatialKey(deme.latitude, deme.longitude);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(deme);
  }

  const lonCells = Math.ceil(360 / SPATIAL_BIN_DEGREES);
  const edges = [];
  const seen = new Set();
  for (const a of demes) {
    const latCell = Math.floor((clamp(a.latitude, -89.999, 89.999) + 90) / SPATIAL_BIN_DEGREES);
    const lonCell = Math.floor((wrapLongitude(a.longitude) + 180) / SPATIAL_BIN_DEGREES);
    const reachA = Math.max(120, Number(a.exchangeReachKm) || 120);
    const cellRadius = Math.max(1, Math.ceil(reachA / (111 * SPATIAL_BIN_DEGREES)) + 1);
    for (let dLat = -cellRadius; dLat <= cellRadius; dLat += 1) {
      const neighborLat = latCell + dLat;
      if (neighborLat < 0 || neighborLat >= Math.ceil(180 / SPATIAL_BIN_DEGREES)) continue;
      for (let dLon = -cellRadius; dLon <= cellRadius; dLon += 1) {
        const neighborLon = ((lonCell + dLon) % lonCells + lonCells) % lonCells;
        const candidates = bins.get(`${neighborLat}:${neighborLon}`) ?? [];
        for (const b of candidates) {
          if (a.id === b.id) continue;
          const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          if (seen.has(pair)) continue;
          seen.add(pair);
          const reachB = Math.max(120, Number(b.exchangeReachKm) || 120);
          const reach = Math.sqrt(reachA * reachB);
          const d = distanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
          if (d > reach) continue;
          const lineageA = lineages.get(a.lineageId);
          const lineageB = lineages.get(b.lineageId);
          const communication = Math.sqrt(
            (0.12 + clamp(lineageA?.communication ?? 0, 0, 1))
            * (0.12 + clamp(lineageB?.communication ?? 0, 0, 1))
          );
          const culture = (clamp(lineageA?.cumulativeCulture ?? 0, 0, 1) + clamp(lineageB?.cumulativeCulture ?? 0, 0, 1)) / 2;
          const weight = Math.exp(-d / Math.max(1, reach * 0.42)) * communication * (0.72 + culture * 0.55);
          if (weight < 0.045) continue;
          const annualTrips = weight * Math.sqrt(Math.max(1, a.headcount) * Math.max(1, b.headcount)) / 38;
          const toolMean = (clamp(lineageA?.toolComplexity ?? 0, 0, 1) + clamp(lineageB?.toolComplexity ?? 0, 0, 1)) / 2;
          const transportCapacityPersonDaysPerYear = annualTrips * (1.5 + toolMean * 8.5);
          const siteA = sitesByDeme.get(a.id);
          const siteB = sitesByDeme.get(b.id);
          let exchangedPersonDays = 0;
          if (siteA && siteB && elapsedYears > 0) {
            const reserveA = Math.max(0, Number(siteA.storedFoodPersonDays) || 0);
            const reserveB = Math.max(0, Number(siteB.storedFoodPersonDays) || 0);
            const perA = reserveA / Math.max(1, a.headcount);
            const perB = reserveB / Math.max(1, b.headcount);
            if (Math.abs(perA - perB) > 0.05) {
              const donor = perA > perB ? siteA : siteB;
              const receiver = donor === siteA ? siteB : siteA;
              const donorReserve = Math.max(0, Number(donor.storedFoodPersonDays) || 0);
              const imbalance = Math.abs(perA - perB) * Math.min(a.headcount, b.headcount);
              exchangedPersonDays = Math.min(
                donorReserve * 0.10,
                imbalance * 0.12,
                transportCapacityPersonDaysPerYear * Math.min(elapsedYears, 50)
              );
              donor.storedFoodPersonDays -= exchangedPersonDays;
              receiver.storedFoodPersonDays += exchangedPersonDays;
            }
          }
          edges.push({
            aDemeId: a.id,
            bDemeId: b.id,
            distanceKm: d,
            interactionWeight: weight,
            personTripsPerYear: annualTrips,
            transportCapacityPersonDaysPerYear,
            foodEquivalentPersonDaysPerYear: elapsedYears > 0 ? exchangedPersonDays / elapsedYears : 0
          });
        }
      }
    }
  }
  state.homininExchangeEdges = edges;
  for (const deme of demes) deme.exchangeDegree = 0;
  for (const edge of edges) {
    if (byId.has(edge.aDemeId)) byId.get(edge.aDemeId).exchangeDegree += 1;
    if (byId.has(edge.bDemeId)) byId.get(edge.bDemeId).exchangeDegree += 1;
  }
}

function summarize(state) {
  const demes = (state.homininDemes ?? []).filter((deme) => deme.headcount > 0);
  const sites = (state.homininSites ?? []).filter((site) => site.active && site.sitePopulationPersons > 0);
  const edges = state.homininExchangeEdges ?? [];
  state.homininHouseholdCount = demes.reduce((sum, deme) => sum + Math.max(0, Math.round(Number(deme.householdCount) || 0)), 0);
  state.homininResidentialGroupCount = demes.reduce((sum, deme) => sum + Math.max(0, Math.round(Number(deme.residentialGroupCount) || 0)), 0);
  state.homininActiveSiteCount = sites.length;
  state.homininPersistentSiteCount = sites.filter((site) => Number(site.persistence) >= 0.5).length;
  state.homininSettlementPopulationPersons = sites.reduce((sum, site) => sum + Math.max(0, Number(site.sitePopulationPersons) || 0), 0);
  state.homininLargestSitePopulationPersons = sites.reduce((largest, site) => Math.max(largest, Number(site.sitePopulationPersons) || 0), 0);
  state.homininStoredFoodPersonDays = sites.reduce((sum, site) => sum + Math.max(0, Number(site.storedFoodPersonDays) || 0), 0);
  state.homininExchangeEdgeCount = edges.length;
  state.homininExchangePersonTripsPerYear = edges.reduce((sum, edge) => sum + Math.max(0, Number(edge.personTripsPerYear) || 0), 0);
  state.homininExchangeFoodPersonDaysPerYear = edges.reduce((sum, edge) => sum + Math.max(0, Number(edge.foodEquivalentPersonDaysPerYear) || 0), 0);
  const sitePopulation = Math.max(1, state.homininSettlementPopulationPersons);
  state.homininMeanSettlementPersistence = sites.reduce(
    (sum, site) => sum + (Number(site.persistence) || 0) * Math.max(0, Number(site.sitePopulationPersons) || 0),
    0
  ) / sitePopulation;
  state.homininSocialPolicy = HOMININ_SOCIAL_POLICY;
}

function socialUpdate(state, elapsedYears, seed) {
  const lineages = new Map((state.homininLineages ?? []).map((lineage) => [lineage.id, lineage]));
  for (const deme of state.homininDemes ?? []) {
    if (!(deme.headcount > 0)) continue;
    const lineage = lineages.get(deme.lineageId);
    if (!lineage || lineage.extinctionYearBP != null) continue;
    updateDemeAndSite(state, deme, lineage, elapsedYears, seed);
  }
  decayAbandonedSites(state, elapsedYears);
  rebuildExchangeNetwork(state, elapsedYears);
  summarize(state);
}

export function initializeHomininSocialOrganization(state, seed = 777001) {
  state.homininSites ??= [];
  state.homininExchangeEdges ??= [];
  state.homininSocialAccumulatorYears ??= 0;
  state.homininDecayedSiteCount ??= 0;
  if ((state.homininDemes ?? []).length) socialUpdate(state, 0, seed);
  else summarize(state);
  return state;
}

export function advanceHomininSocialOrganization(state, dtYears) {
  initializeHomininSocialOrganization(state, state.seed ?? 777001);
  const dt = Math.max(0, Number(dtYears) || 0);
  if (dt <= 0) return state;
  state.homininSocialAccumulatorYears += dt;
  if (state.homininSocialAccumulatorYears >= SOCIAL_INTERVAL_YEARS) {
    const elapsed = Math.floor(state.homininSocialAccumulatorYears / SOCIAL_INTERVAL_YEARS) * SOCIAL_INTERVAL_YEARS;
    state.homininSocialAccumulatorYears -= elapsed;
    socialUpdate(state, elapsed, state.seed ?? 777001);
  } else {
    summarize(state);
  }
  return state;
}

function settlementLabel(persistence) {
  const p = clamp(persistence, 0, 1);
  if (p < 0.18) return "mobile camp";
  if (p < 0.42) return "recurrent camp";
  if (p < 0.68) return "semi-persistent settlement";
  return "persistent settlement";
}

export function homininSocialAt(state, latitude, longitude, radiusKm = 100) {
  const sites = (state?.homininSites ?? []).filter((site) => site.active && site.sitePopulationPersons > 0);
  if (!sites.length) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  let populationWithinRadius = 0;
  const radius = Math.max(1, Number(radiusKm) || 100);
  for (const site of sites) {
    const d = distanceKm(latitude, longitude, site.latitude, site.longitude);
    if (d <= radius) populationWithinRadius += Math.max(0, Number(site.sitePopulationPersons) || 0);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = site;
    }
  }
  if (!nearest) return null;
  const meanLatitude = (Number(latitude) + Number(nearest.latitude)) / 2 * Math.PI / 180;
  const northKm = (Number(nearest.latitude) - Number(latitude)) * 111.195;
  const eastKm = wrapLongitude(Number(nearest.longitude) - Number(longitude)) * 111.195 * Math.max(0.08, Math.cos(meanLatitude));
  const nearestDeme = (state.homininDemes ?? []).find((deme) => deme.id === nearest.occupantDemeId) ?? null;
  return Object.freeze({
    policy: HOMININ_SOCIAL_POLICY,
    latitude: Number(latitude),
    longitude: Number(longitude),
    radiusKm: radius,
    activeSitePopulationWithinRadius: Math.round(populationWithinRadius),
    nearestSiteId: nearest.id,
    nearestDemeId: nearest.occupantDemeId,
    nearestLineageId: nearest.lineageId,
    nearestSiteDistanceKm: nearestDistance,
    siteOffsetEastKm: eastKm,
    siteOffsetNorthKm: northKm,
    sitePopulationPersons: Math.round(Number(nearest.sitePopulationPersons) || 0),
    householdCount: Math.round(Number(nearest.householdCount) || 0),
    householdSizePersons: Number(nearest.householdSizePersons) || null,
    settlementPersistence: clamp(nearest.persistence, 0, 1),
    settlementLabel: settlementLabel(nearest.persistence),
    builtEnvironmentIndex: clamp(nearest.builtEnvironmentIndex, 0, 1),
    storedFoodPersonDays: Math.max(0, Number(nearest.storedFoodPersonDays) || 0),
    resourceReliability: clamp(nearest.resourceReliability, 0, 1),
    coastalAccess: clamp(nearest.coastalAccess, 0, 1),
    defensibility: clamp(nearest.defensibility, 0, 1),
    exchangeDegree: Math.max(0, Math.round(Number(nearestDeme?.exchangeDegree) || 0)),
    residentialGroupCount: Math.max(0, Math.round(Number(nearestDeme?.residentialGroupCount) || 0)),
    residentialMovesPerYear: Math.max(0, Number(nearestDeme?.residentialMovesPerYear) || 0),
    epistemicStatus: "coarse emergent social organization: demographic demes are decomposed into households and residential groups; site persistence, storage and exchange arise from ecology, mobility and inherited cultural traits rather than named historical stages"
  });
}
