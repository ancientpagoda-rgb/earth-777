import { dynamicSurfaceElevationMeters } from "./GeneralAtmosphereCirculation.js";

const EARTH_RADIUS_KM = 6371.0088;
const REFERENCE_PERSONS_PER_INDEX = 80_000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const positive = (value, floor = 0) => Math.max(floor, Number(value) || 0);

export const HOMININ_DEMOGRAPHY_POLICY = "explicit-headcount-age-sex-migrating-demes-v1";

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

function lineageNumber(id) {
  const match = String(id ?? "").match(/\d+/);
  return match ? Number(match[0]) : hash32(String(id ?? "").length) % 10_000;
}

function wrapLongitude(longitude) {
  return ((Number(longitude) + 540) % 360) - 180;
}

function greatCircleDistanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const toRad = Math.PI / 180;
  const phi1 = Number(latitudeA) * toRad;
  const phi2 = Number(latitudeB) * toRad;
  const dPhi = (Number(latitudeB) - Number(latitudeA)) * toRad;
  const dLambda = wrapLongitude(Number(longitudeB) - Number(longitudeA)) * toRad;
  const a = Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function destination(latitude, longitude, bearingRadians, distanceKm) {
  const angularDistance = Math.max(0, Number(distanceKm) || 0) / EARTH_RADIUS_KM;
  const phi1 = Number(latitude) * Math.PI / 180;
  const lambda1 = Number(longitude) * Math.PI / 180;
  const sinPhi2 = Math.sin(phi1) * Math.cos(angularDistance)
    + Math.cos(phi1) * Math.sin(angularDistance) * Math.cos(bearingRadians);
  const phi2 = Math.asin(clamp(sinPhi2, -1, 1));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(phi1),
    Math.cos(angularDistance) - Math.sin(phi1) * Math.sin(phi2)
  );
  return {
    latitude: clamp(phi2 * 180 / Math.PI, -89.5, 89.5),
    longitude: wrapLongitude(lambda2 * 180 / Math.PI)
  };
}

function habitatSuitability(state, latitude, longitude) {
  const elevationMeters = dynamicSurfaceElevationMeters(state, latitude, longitude);
  const seaLevel = Number(state?.seaLevel) || 0;
  if (!Number.isFinite(elevationMeters) || elevationMeters <= seaLevel) return 0;

  const absoluteLatitude = Math.abs(Number(latitude) || 0);
  const temperatureDeparture = (Number(state?.temperatureAnomaly) || -1.27) + 1.27;
  const thermalOptimumLatitude = clamp(22 + temperatureDeparture * 3.2, 10, 42);
  const thermalScore = Math.exp(-((absoluteLatitude - thermalOptimumLatitude) / 34) ** 2);
  const elevationScore = Math.exp(-Math.max(0, elevationMeters - 1700) / 1800);
  const productivity = clamp(state?.productivityIndex ?? 1, 0.05, 5);
  return thermalScore * elevationScore * Math.sqrt(productivity);
}

function bestLandPoint(state, seed, salt, anchor = null, searchRadiusKm = 1500) {
  let best = null;
  for (let attempt = 0; attempt < 96; attempt += 1) {
    let latitude;
    let longitude;
    if (anchor) {
      const bearing = unit(seed, salt * 193 + attempt * 17) * Math.PI * 2;
      const distance = searchRadiusKm * Math.sqrt(unit(seed, salt * 271 + attempt * 29));
      ({ latitude, longitude } = destination(anchor.latitude, anchor.longitude, bearing, distance));
    } else {
      const z = unit(seed, salt * 313 + attempt * 31) * 2 - 1;
      latitude = Math.asin(z) * 180 / Math.PI;
      longitude = unit(seed, salt * 419 + attempt * 43) * 360 - 180;
    }
    const suitability = habitatSuitability(state, latitude, longitude);
    const exploration = 0.82 + unit(seed, salt * 557 + attempt * 59) * 0.36;
    const score = suitability * exploration;
    if (!best || score > best.score) best = { latitude, longitude, score };
  }
  return best?.score > 0 ? best : { latitude: 0, longitude: 0, score: 0 };
}

function ageStructure(totalPersons, lineage) {
  const total = Math.max(0, Math.round(totalPersons));
  const culture = clamp(lineage?.cumulativeCulture ?? 0, 0, 1);
  const tools = clamp(lineage?.toolComplexity ?? 0, 0, 1);
  const juvenileShare = clamp(0.31 - culture * 0.025, 0.22, 0.34);
  const elderShare = clamp(0.035 + culture * 0.025 + tools * 0.018, 0.025, 0.10);
  const adultShare = 0.37;
  const juvenile = Math.round(total * juvenileShare);
  const adult = Math.round(total * adultShare);
  const elder = Math.round(total * elderShare);
  const mature = Math.max(0, total - juvenile - adult - elder);
  return { juvenile, adult, mature, elder };
}

function setLineageDemography(lineage, persons) {
  const total = Math.max(0, Math.round(persons));
  const ages = ageStructure(total, lineage);
  const female = Math.round(total * 0.505);
  lineage.populationPersons = total;
  lineage.femalePersons = female;
  lineage.malePersons = total - female;
  lineage.ageStructure = ages;
}

function initialPersons(lineage) {
  return Math.max(25, Math.round(positive(lineage?.populationIndex, 0.001) * REFERENCE_PERSONS_PER_INDEX));
}

function createInitialDemes(state, lineage, seed) {
  const ordinal = lineageNumber(lineage.id);
  const persons = Math.max(1, Number(lineage.populationPersons) || initialPersons(lineage));
  const center = bestLandPoint(state, seed, 1000 + ordinal);
  const demeCount = Math.max(2, Math.round(Math.sqrt(persons / 12_000)));
  const weights = Array.from({ length: demeCount }, (_, index) => 0.65 + unit(seed, ordinal * 701 + index * 67));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  let assigned = 0;
  return Array.from({ length: demeCount }, (_, index) => {
    const point = index === 0
      ? center
      : bestLandPoint(state, seed, ordinal * 2000 + index, center, 900 + index * 90);
    const headcount = index === demeCount - 1
      ? persons - assigned
      : Math.max(1, Math.round(persons * weights[index] / weightTotal));
    assigned += headcount;
    return {
      id: `${lineage.id}-D${index + 1}`,
      lineageId: lineage.id,
      latitude: point.latitude,
      longitude: point.longitude,
      headcount,
      foundedYearBP: Math.round(Number(state.yearBP) || 777_000),
      lastFissionYearBP: Math.round(Number(state.yearBP) || 777_000)
    };
  });
}

function redistributeDemeHeadcounts(state, lineage) {
  const demes = state.homininDemes.filter((deme) => deme.lineageId === lineage.id && deme.headcount > 0);
  if (!demes.length) {
    state.homininDemes.push(...createInitialDemes(state, lineage, state.seed ?? 777001));
    return;
  }
  const total = Math.max(0, Math.round(lineage.populationPersons || 0));
  const oldTotal = demes.reduce((sum, deme) => sum + Math.max(0, Number(deme.headcount) || 0), 0);
  let assigned = 0;
  for (let index = 0; index < demes.length; index += 1) {
    const deme = demes[index];
    const next = index === demes.length - 1
      ? total - assigned
      : Math.max(0, Math.round(total * (oldTotal > 0 ? deme.headcount / oldTotal : 1 / demes.length)));
    deme.headcount = next;
    assigned += next;
  }
}

function inheritChildPopulation(state, lineage, seed) {
  const parent = state.homininLineages.find((candidate) => candidate.id === lineage.parentId);
  if (!parent || !Number.isFinite(parent.populationPersons) || parent.populationPersons <= 2) {
    setLineageDemography(lineage, initialPersons(lineage));
    state.homininDemes.push(...createInitialDemes(state, lineage, seed));
    return;
  }

  const transferred = Math.max(2, Math.round(parent.populationPersons * 0.31));
  setLineageDemography(parent, Math.max(1, parent.populationPersons - transferred));
  setLineageDemography(lineage, transferred);
  redistributeDemeHeadcounts(state, parent);

  const parentDemes = state.homininDemes
    .filter((deme) => deme.lineageId === parent.id && deme.headcount > 0)
    .sort((a, b) => b.headcount - a.headcount);
  const anchor = parentDemes[0] ?? bestLandPoint(state, seed, lineageNumber(lineage.id) + 8000);
  const point = bestLandPoint(state, seed, lineageNumber(lineage.id) + 9000, anchor, 500);
  state.homininDemes.push({
    id: `${lineage.id}-D1`,
    lineageId: lineage.id,
    latitude: point.latitude,
    longitude: point.longitude,
    headcount: transferred,
    foundedYearBP: Math.round(Number(state.yearBP) || 0),
    lastFissionYearBP: Math.round(Number(state.yearBP) || 0)
  });
}

export function initializeHomininDemography(state, seed = 777001) {
  if (!Array.isArray(state.homininLineages)) return state;
  state.homininDemes ??= [];
  for (const lineage of state.homininLineages) {
    if (lineage.extinctionYearBP != null) continue;
    if (!Number.isFinite(lineage.populationPersons)) setLineageDemography(lineage, initialPersons(lineage));
    if (!state.homininDemes.some((deme) => deme.lineageId === lineage.id)) {
      state.homininDemes.push(...createInitialDemes(state, lineage, seed));
    }
  }
  summarize(state, 0, 0);
  state.homininDemographyPolicy = HOMININ_DEMOGRAPHY_POLICY;
  return state;
}

function moveDemes(state, lineage, dtYears, random) {
  const demes = state.homininDemes.filter((deme) => deme.lineageId === lineage.id && deme.headcount > 0);
  if (!demes.length) return;
  const temperatureVariability = Math.abs((Number(state.temperatureAnomaly) || -1.27) + 1.27);
  const migrationKm = (0.18 + clamp(lineage.mobility ?? 0, 0, 1) * 0.82 + temperatureVariability * 0.08) * dtYears;
  for (const deme of demes) {
    const baseAngle = random() * Math.PI * 2;
    let best = { latitude: deme.latitude, longitude: deme.longitude, score: habitatSuitability(state, deme.latitude, deme.longitude) };
    for (let candidate = 0; candidate < 8; candidate += 1) {
      const angle = baseAngle + candidate * Math.PI / 4;
      const point = destination(deme.latitude, deme.longitude, angle, migrationKm);
      const score = habitatSuitability(state, point.latitude, point.longitude) * (0.94 + random() * 0.12);
      if (score > best.score) best = { ...point, score };
    }
    deme.latitude = best.latitude;
    deme.longitude = best.longitude;
  }
}

function maybeFissionDeme(state, lineage, random) {
  const demes = state.homininDemes.filter((deme) => deme.lineageId === lineage.id && deme.headcount > 0);
  if (!demes.length) return;
  const threshold = 14_000 * (0.82 + clamp(lineage.sociality ?? 0, 0, 1) * 0.55);
  const candidate = demes.sort((a, b) => b.headcount - a.headcount)[0];
  const elapsedSinceFission = Math.abs((Number(candidate.lastFissionYearBP) || state.yearBP) - Number(state.yearBP));
  if (candidate.headcount < threshold || elapsedSinceFission < 750) return;

  const split = Math.max(250, Math.round(candidate.headcount * (0.14 + random() * 0.10)));
  if (candidate.headcount - split < 200) return;
  const bearing = random() * Math.PI * 2;
  const rangeKm = 120 + clamp(lineage.mobility ?? 0, 0, 1) * 420;
  const proposed = destination(candidate.latitude, candidate.longitude, bearing, rangeKm);
  const point = habitatSuitability(state, proposed.latitude, proposed.longitude) > 0
    ? proposed
    : bestLandPoint(state, state.seed ?? 777001, lineageNumber(lineage.id) + state.homininDemes.length * 101, candidate, rangeKm * 1.8);
  candidate.headcount -= split;
  candidate.lastFissionYearBP = Math.round(state.yearBP);
  const ordinal = state.homininDemes.filter((deme) => deme.lineageId === lineage.id).length + 1;
  state.homininDemes.push({
    id: `${lineage.id}-D${ordinal}`,
    lineageId: lineage.id,
    latitude: point.latitude,
    longitude: point.longitude,
    headcount: split,
    foundedYearBP: Math.round(state.yearBP),
    lastFissionYearBP: Math.round(state.yearBP)
  });
}

function summarize(state, births, deaths, dtYears = 0) {
  const living = state.homininLineages.filter((lineage) => lineage.extinctionYearBP == null && lineage.populationPersons > 0);
  const total = living.reduce((sum, lineage) => sum + Math.max(0, Number(lineage.populationPersons) || 0), 0);
  const age = living.reduce((totals, lineage) => {
    for (const key of ["juvenile", "adult", "mature", "elder"]) totals[key] += Number(lineage.ageStructure?.[key]) || 0;
    return totals;
  }, { juvenile: 0, adult: 0, mature: 0, elder: 0 });
  state.homininPopulationPersons = Math.round(total);
  state.homininBirthsPerYear = dtYears > 0 ? births / dtYears : 0;
  state.homininDeathsPerYear = dtYears > 0 ? deaths / dtYears : 0;
  state.homininDemographicGrowthPerYear = dtYears > 0 && total > 0 ? (births - deaths) / dtYears / total : 0;
  state.homininDemeCount = state.homininDemes.filter((deme) => deme.headcount > 0).length;
  state.homininAgeStructure = age;
  state.homininFemalePersons = living.reduce((sum, lineage) => sum + (Number(lineage.femalePersons) || 0), 0);
  state.homininMalePersons = living.reduce((sum, lineage) => sum + (Number(lineage.malePersons) || 0), 0);
}

export function advanceHomininDemography(state, dtYears, random = Math.random) {
  initializeHomininDemography(state, state.seed ?? 777001);
  const dt = Math.max(0, Number(dtYears) || 0);
  if (dt <= 0) return state;
  let birthsTotal = 0;
  let deathsTotal = 0;

  for (const lineage of state.homininLineages) {
    if (lineage.extinctionYearBP != null) {
      lineage.populationPersons = 0;
      for (const deme of state.homininDemes) if (deme.lineageId === lineage.id) deme.headcount = 0;
      continue;
    }
    if (!Number.isFinite(lineage.populationPersons)) inheritChildPopulation(state, lineage, state.seed ?? 777001);

    const current = Math.max(1, Number(lineage.populationPersons) || 1);
    const culturalMultiplier = 0.88
      + clamp(lineage.cumulativeCulture ?? 0, 0, 1) * 0.16
      + clamp(lineage.toolComplexity ?? 0, 0, 1) * 0.24
      + clamp(lineage.fireReliance ?? 0, 0, 1) * 0.12;
    const carryingCapacity = Math.max(10, positive(lineage.populationIndex, 1e-6) * REFERENCE_PERSONS_PER_INDEX * culturalMultiplier);
    let next;
    if (current <= carryingCapacity) {
      const intrinsicRate = 0.0024 * (0.72 + clamp(lineage.sociality ?? 0, 0, 1) * 0.16 + clamp(lineage.communication ?? 0, 0, 1) * 0.12);
      const ratio = Math.max(1e-9, (carryingCapacity - current) / current);
      next = carryingCapacity / (1 + ratio * Math.exp(-intrinsicRate * dt));
    } else {
      next = carryingCapacity + (current - carryingCapacity) * Math.exp(-dt / 240);
    }
    next = Math.max(0, Math.round(next));

    const densityRatio = current / Math.max(1, carryingCapacity);
    const crudeBirthRate = 0.030
      * (0.9 + clamp(lineage.sociality ?? 0, 0, 1) * 0.08 + clamp(lineage.cumulativeCulture ?? 0, 0, 1) * 0.05)
      * clamp(1.12 - densityRatio * 0.22, 0.62, 1.12);
    const births = Math.max(0, Math.round(current * crudeBirthRate * dt));
    const deaths = Math.max(0, births - (next - current));
    birthsTotal += births;
    deathsTotal += deaths;

    setLineageDemography(lineage, next);
    lineage.carryingCapacityPersons = Math.round(carryingCapacity);
    lineage.birthsPerYear = births / dt;
    lineage.deathsPerYear = deaths / dt;
    lineage.demographicGrowthPerYear = current > 0 ? (next - current) / dt / current : 0;
    redistributeDemeHeadcounts(state, lineage);
    moveDemes(state, lineage, dt, random);
    maybeFissionDeme(state, lineage, random);
  }

  state.homininDemes = state.homininDemes.filter((deme) => deme.headcount > 0);
  summarize(state, birthsTotal, deathsTotal, dt);
  return state;
}

export function homininPopulationAt(state, latitude, longitude, radiusKm = 100) {
  if (!Array.isArray(state?.homininDemes) || !state.homininDemes.length) return null;
  const lineageById = new Map((state.homininLineages ?? []).map((lineage) => [lineage.id, lineage]));
  let density = 0;
  let nearestDistanceKm = Infinity;
  let nearestDeme = null;
  const byLineage = new Map();

  for (const deme of state.homininDemes) {
    const headcount = Math.max(0, Number(deme.headcount) || 0);
    if (headcount <= 0) continue;
    const distanceKm = greatCircleDistanceKm(latitude, longitude, deme.latitude, deme.longitude);
    if (distanceKm < nearestDistanceKm) {
      nearestDistanceKm = distanceKm;
      nearestDeme = deme;
    }
    const lineage = lineageById.get(deme.lineageId);
    const sigmaKm = 115 + clamp(lineage?.mobility ?? 0.5, 0, 1) * 185;
    const localDensity = headcount / (2 * Math.PI * sigmaKm * sigmaKm) * Math.exp(-(distanceKm ** 2) / (2 * sigmaKm * sigmaKm));
    density += localDensity;
    byLineage.set(deme.lineageId, (byLineage.get(deme.lineageId) || 0) + localDensity);
  }

  const areaKm2 = Math.PI * Math.max(1, Number(radiusKm) || 100) ** 2;
  const estimatedPersonsWithinRadius = Math.round(density * areaKm2);
  return Object.freeze({
    policy: HOMININ_DEMOGRAPHY_POLICY,
    latitude: Number(latitude),
    longitude: Number(longitude),
    densityPersonsPerKm2: density,
    estimatedPersonsWithinRadius,
    radiusKm: Math.max(1, Number(radiusKm) || 100),
    nearestDemeDistanceKm: Number.isFinite(nearestDistanceKm) ? nearestDistanceKm : null,
    nearestDemeId: nearestDeme?.id ?? null,
    nearestLineageId: nearestDeme?.lineageId ?? null,
    lineageDensity: Object.freeze(Object.fromEntries([...byLineage.entries()])),
    epistemicStatus: "explicit demographic headcounts distributed across deterministic migrating demes; local density is a smooth coarse-grained kernel for rendering/inspection, not an invented display population"
  });
}
