import { dynamicSurfaceElevationMeters } from "./GeneralAtmosphereCirculation.js";

const EARTH_RADIUS_KM = 6371.0088;
const TRANSPORT_INTERVAL_YEARS = 250;
const ROUTE_BIN_DEGREES = 18;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const relax = (current, target, dtYears, tauYears) => current + (target - current) * (1 - Math.exp(-Math.max(0, dtYears) / Math.max(1e-6, tauYears)));

export const HOMININ_WATER_TRANSPORT_POLICY = "water-access-construction-navigation-routes-v1";

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

function intermediateGreatCircle(latA, lonA, latB, lonB, fraction) {
  const r = Math.PI / 180;
  const phi1 = Number(latA) * r;
  const lambda1 = Number(lonA) * r;
  const phi2 = Number(latB) * r;
  const lambda2 = Number(lonB) * r;
  const d = distanceKm(latA, lonA, latB, lonB) / EARTH_RADIUS_KM;
  if (!(d > 1e-9)) return { latitude: Number(latA), longitude: wrapLongitude(lonA) };
  const sinD = Math.sin(d);
  const a = Math.sin((1 - fraction) * d) / sinD;
  const b = Math.sin(fraction * d) / sinD;
  const x = a * Math.cos(phi1) * Math.cos(lambda1) + b * Math.cos(phi2) * Math.cos(lambda2);
  const y = a * Math.cos(phi1) * Math.sin(lambda1) + b * Math.cos(phi2) * Math.sin(lambda2);
  const z = a * Math.sin(phi1) + b * Math.sin(phi2);
  return {
    latitude: Math.atan2(z, Math.hypot(x, y)) / r,
    longitude: wrapLongitude(Math.atan2(y, x) / r)
  };
}

function routeWaterFraction(state, a, b) {
  const seaLevel = Number(state?.seaLevel) || 0;
  let water = 0;
  let valid = 0;
  for (let sample = 1; sample <= 9; sample += 1) {
    const point = intermediateGreatCircle(a.latitude, a.longitude, b.latitude, b.longitude, sample / 10);
    const elevation = dynamicSurfaceElevationMeters(state, point.latitude, point.longitude);
    if (!Number.isFinite(elevation)) continue;
    valid += 1;
    if (elevation <= seaLevel) water += 1;
  }
  return valid > 0 ? water / valid : 0;
}

function spatialKey(latitude, longitude) {
  const latCell = Math.floor((clamp(latitude, -89.999, 89.999) + 90) / ROUTE_BIN_DEGREES);
  const lonCell = Math.floor((wrapLongitude(longitude) + 180) / ROUTE_BIN_DEGREES);
  return `${latCell}:${lonCell}`;
}

function updateCapabilities(state, elapsedYears) {
  const lineages = new Map((state.homininLineages ?? []).map((lineage) => [lineage.id, lineage]));
  const demes = new Map((state.homininDemes ?? []).map((deme) => [deme.id, deme]));
  for (const site of state.homininSites ?? []) {
    if (!site.active || !(site.sitePopulationPersons > 0)) continue;
    const lineage = lineages.get(site.lineageId);
    const deme = demes.get(site.occupantDemeId);
    if (!lineage || !deme) continue;
    const waterAccess = clamp(site.coastalAccess ?? deme.coastalAccess ?? 0, 0, 1);
    const tools = clamp(lineage.toolComplexity ?? 0, 0, 1);
    const culture = clamp(lineage.cumulativeCulture ?? 0, 0, 1);
    const communication = clamp(lineage.communication ?? 0, 0, 1);
    const dexterity = clamp(lineage.dexterity ?? 0.5, 0, 1);
    const exchangeDemand = clamp((Number(deme.exchangeDegree) || 0) / 6, 0, 1);
    const constructionSkill = clamp(tools * 0.44 + dexterity * 0.24 + culture * 0.22 + communication * 0.10, 0, 1);
    const targetTransport = clamp(
      waterAccess
        * Math.max(0, constructionSkill - 0.08) / 0.92
        * (0.48 + exchangeDemand * 0.25 + culture * 0.27),
      0,
      1
    );
    const currentTransport = clamp(site.waterTransportIndex ?? 0, 0, 1);
    site.waterTransportIndex = clamp(relax(currentTransport, targetTransport, elapsedYears, 1800), 0, 1);
    const targetNavigation = clamp(
      waterAccess * (site.waterTransportIndex * 0.45 + communication * 0.28 + culture * 0.27),
      0,
      1
    );
    site.navigationIndex = clamp(relax(site.navigationIndex ?? 0, targetNavigation, elapsedYears, 2600), 0, 1);
    site.waterTransportRangeKm = waterAccess > 0.05
      ? 35 + site.waterTransportIndex * 2200 + site.navigationIndex * 1650
      : 0;
    site.waterTransportPersonsPerTrip = waterAccess > 0.05
      ? Math.max(0, site.waterTransportIndex * (1.8 + tools * 13 + culture * 4))
      : 0;
    site.waterCargoPersonDaysPerTrip = site.waterTransportPersonsPerTrip * (2 + tools * 12 + culture * 9);
    site.watercraftConstructionLaborDaysPerYear = waterAccess
      * site.sitePopulationPersons
      * (0.02 + site.waterTransportIndex * 0.12)
      * (0.45 + constructionSkill * 0.75)
      * 365;
    deme.waterTransportIndex = site.waterTransportIndex;
    deme.navigationIndex = site.navigationIndex;
    deme.waterTransportRangeKm = site.waterTransportRangeKm;
  }
}

function buildRoutes(state) {
  const sites = (state.homininSites ?? []).filter((site) =>
    site.active
      && site.sitePopulationPersons > 0
      && site.waterTransportIndex > 0.015
      && site.coastalAccess > 0.05
  );
  const bins = new Map();
  for (const site of sites) {
    const key = spatialKey(site.latitude, site.longitude);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(site);
  }

  const latCells = Math.ceil(180 / ROUTE_BIN_DEGREES);
  const lonCells = Math.ceil(360 / ROUTE_BIN_DEGREES);
  const routes = [];
  const seen = new Set();
  for (const a of sites) {
    const latCell = Math.floor((clamp(a.latitude, -89.999, 89.999) + 90) / ROUTE_BIN_DEGREES);
    const lonCell = Math.floor((wrapLongitude(a.longitude) + 180) / ROUTE_BIN_DEGREES);
    const reachA = Math.max(0, Number(a.waterTransportRangeKm) || 0);
    const cellRadius = Math.max(1, Math.ceil(reachA / (111 * ROUTE_BIN_DEGREES)) + 1);
    for (let dLat = -cellRadius; dLat <= cellRadius; dLat += 1) {
      const neighborLat = latCell + dLat;
      if (neighborLat < 0 || neighborLat >= latCells) continue;
      for (let dLon = -cellRadius; dLon <= cellRadius; dLon += 1) {
        const neighborLon = ((lonCell + dLon) % lonCells + lonCells) % lonCells;
        for (const b of bins.get(`${neighborLat}:${neighborLon}`) ?? []) {
          if (a.id === b.id) continue;
          const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          if (seen.has(pair)) continue;
          seen.add(pair);
          const distance = distanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
          const sharedRange = Math.sqrt(
            Math.max(1, Number(a.waterTransportRangeKm) || 0)
            * Math.max(1, Number(b.waterTransportRangeKm) || 0)
          );
          if (distance > sharedRange) continue;
          const waterFraction = routeWaterFraction(state, a, b);
          if (waterFraction < 0.48) continue;
          const transport = Math.sqrt(a.waterTransportIndex * b.waterTransportIndex);
          const navigation = Math.sqrt(a.navigationIndex * b.navigationIndex);
          const routeDifficulty = clamp(distance / Math.max(1, sharedRange), 0, 1.5)
            + (1 - waterFraction) * 0.55;
          const viability = clamp(
            transport * 0.52 + navigation * 0.36 + waterFraction * 0.24 - routeDifficulty * 0.22,
            0,
            1
          );
          if (viability < 0.035) continue;
          const capacityPersons = Math.min(a.waterTransportPersonsPerTrip, b.waterTransportPersonsPerTrip);
          const tripsPerYear = viability
            * Math.sqrt(a.sitePopulationPersons * b.sitePopulationPersons)
            / Math.max(5, 28 + distance / 85);
          const cargoPersonDaysPerYear = tripsPerYear
            * Math.min(a.waterCargoPersonDaysPerTrip, b.waterCargoPersonDaysPerTrip);
          routes.push({
            aSiteId: a.id,
            bSiteId: b.id,
            aDemeId: a.occupantDemeId,
            bDemeId: b.occupantDemeId,
            distanceKm: distance,
            waterFraction,
            viability,
            transportIndex: transport,
            navigationIndex: navigation,
            personsPerTrip: capacityPersons,
            personTripsPerYear: tripsPerYear,
            cargoPersonDaysPerYear
          });
        }
      }
    }
  }
  state.homininWaterRoutes = routes;
}

function summarize(state) {
  const sites = (state.homininSites ?? []).filter((site) => site.active && site.sitePopulationPersons > 0);
  const routes = state.homininWaterRoutes ?? [];
  state.homininWaterTransportSiteCount = sites.filter((site) => Number(site.waterTransportIndex) > 0.05).length;
  state.homininWaterRouteCount = routes.length;
  state.homininWaterPersonTripsPerYear = routes.reduce((sum, route) => sum + Math.max(0, Number(route.personTripsPerYear) || 0), 0);
  state.homininWaterCargoPersonDaysPerYear = routes.reduce((sum, route) => sum + Math.max(0, Number(route.cargoPersonDaysPerYear) || 0), 0);
  state.homininMaxWaterTransportRangeKm = sites.reduce((largest, site) => Math.max(largest, Number(site.waterTransportRangeKm) || 0), 0);
  state.homininWaterTransportPolicy = HOMININ_WATER_TRANSPORT_POLICY;
}

function transportUpdate(state, elapsedYears) {
  updateCapabilities(state, elapsedYears);
  buildRoutes(state);
  summarize(state);
}

export function initializeHomininWaterTransport(state) {
  state.homininWaterRoutes ??= [];
  state.homininWaterTransportAccumulatorYears ??= 0;
  const initialized = state.homininWaterTransportPolicy === HOMININ_WATER_TRANSPORT_POLICY;
  if (!initialized && (state.homininSites ?? []).length) transportUpdate(state, 0);
  else summarize(state);
  return state;
}

export function advanceHomininWaterTransport(state, dtYears) {
  if (state.homininWaterTransportPolicy !== HOMININ_WATER_TRANSPORT_POLICY) initializeHomininWaterTransport(state);
  const dt = Math.max(0, Number(dtYears) || 0);
  if (dt <= 0) return state;
  state.homininWaterTransportAccumulatorYears += dt;
  if (state.homininWaterTransportAccumulatorYears >= TRANSPORT_INTERVAL_YEARS) {
    const elapsed = Math.floor(state.homininWaterTransportAccumulatorYears / TRANSPORT_INTERVAL_YEARS) * TRANSPORT_INTERVAL_YEARS;
    state.homininWaterTransportAccumulatorYears -= elapsed;
    transportUpdate(state, elapsed);
  } else {
    summarize(state);
  }
  return state;
}

export function homininWaterTransportAt(state, siteId) {
  const site = (state?.homininSites ?? []).find((candidate) => candidate.id === siteId) ?? null;
  if (!site) return null;
  const routes = (state.homininWaterRoutes ?? []).filter((route) => route.aSiteId === siteId || route.bSiteId === siteId);
  return Object.freeze({
    policy: HOMININ_WATER_TRANSPORT_POLICY,
    siteId,
    waterTransportIndex: clamp(site.waterTransportIndex, 0, 1),
    navigationIndex: clamp(site.navigationIndex, 0, 1),
    rangeKm: Math.max(0, Number(site.waterTransportRangeKm) || 0),
    personsPerTrip: Math.max(0, Number(site.waterTransportPersonsPerTrip) || 0),
    cargoPersonDaysPerTrip: Math.max(0, Number(site.waterCargoPersonDaysPerTrip) || 0),
    constructionLaborDaysPerYear: Math.max(0, Number(site.watercraftConstructionLaborDaysPerYear) || 0),
    routeCount: routes.length,
    personTripsPerYear: routes.reduce((sum, route) => sum + route.personTripsPerYear, 0),
    cargoPersonDaysPerYear: routes.reduce((sum, route) => sum + route.cargoPersonDaysPerYear, 0),
    epistemicStatus: "reduced-order water-transport capability and route model; capability depends on water access, construction skill, communication and accumulated navigation rather than a named vessel type or historical maritime era"
  });
}
