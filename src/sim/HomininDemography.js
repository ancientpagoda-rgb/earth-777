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
  return match ? Number(match[0]) : 1;
}

function wrapLongitude(value) {
  return ((Number(value) + 540) % 360) - 180;
}

function greatCircleDistanceKm(latA, lonA, latB, lonB) {
  const r = Math.PI / 180;
  const phi1 = Number(latA) * r;
  const phi2 = Number(latB) * r;
  const dPhi = (Number(latB) - Number(latA)) * r;
  const dLambda = wrapLongitude(Number(lonB) - Number(lonA)) * r;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
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
  if (!Number.isFinite(elevationMeters) || elevationMeters <= (Number(state?.seaLevel) || 0)) return 0;
  const absoluteLatitude = Math.abs(Number(latitude) || 0);
  const temperatureDeparture = (Number(state?.temperatureAnomaly) || -1.27) + 1.27;
  const optimumLatitude = clamp(22 + temperatureDeparture * 3.2, 10, 42);
  const thermalDistance = (absoluteLatitude - optimumLatitude) / 34;
  const thermalScore = Math.exp(-1 * (thermalDistance ** 2));
  const elevationScore = Math.exp(-Math.max(0, elevationMeters - 1700) / 1800);
  return thermalScore * elevationScore * Math.sqrt(clamp(state?.productivityIndex ?? 1, 0.05, 5));
}

function chooseLandPoint(state, seed, salt, anchor = null, radiusKm = 1500) {
  let best = null;
  for (let attempt = 0; attempt < 72; attempt += 1) {
    let point;
    if (anchor) {
      const bearing = unit(seed, salt * 193 + attempt * 17) * Math.PI * 2;
      const distance = radiusKm * Math.sqrt(unit(seed, salt * 271 + attempt * 29));
      point = destination(anchor.latitude, anchor.longitude, bearing, distance);
    } else {
      const z = unit(seed, salt * 313 + attempt * 31) * 2 - 1;
      point = {
        latitude: Math.asin(z) * 180 / Math.PI,
        longitude: unit(seed, salt * 419 + attempt * 43) * 360 - 180
      };
    }
    const score = habitatSuitability(state, point.latitude, point.longitude)
      * (0.82 + unit(seed, salt * 557 + attempt * 59) * 0.36);
    if (!best || score > best.score) best = { ...point, score };
  }
  return best?.score > 0 ? best : { latitude: 0, longitude: 0, score: 0 };
}

function ageStructure(totalPersons, lineage) {
  const total = Math.max(0, Math.round(totalPersons));
  const culture = clamp(lineage?.cumulativeCulture ?? 0, 0, 1);
  const tools = clamp(lineage?.toolComplexity ?? 0, 0, 1);
  const juvenile = Math.round(total * clamp(0.31 - culture * 0.025, 0.22, 0.34));
  const adult = Math.round(total * 0.37);
  const elder = Math.round(total * clamp(0.035 + culture * 0.025 + tools * 0.018, 0.025, 0.10));
  return { juvenile, adult, mature: Math.max(0, total - juvenile - adult - elder), elder };
}

function setLineageDemography(lineage, persons) {
  const total = Math.max(0, Math.round(persons));
  const female = Math.round(total * 0.505);
  lineage.populationPersons = total;
  lineage.femalePersons = female;
  lineage.malePersons = total - female;
  lineage.ageStructure = ageStructure(total, lineage);
}

function initialPersons(lineage) {
  return Math.max(25, Math.round(positive(lineage?.populationIndex, 0.001) * REFERENCE_PERSONS_PER_INDEX));
}

function makeInitialDemes(state, lineage, seed) {
  const persons = Math.max(1, Number(lineage.populationPersons) || initialPersons(lineage));
  const ordinal = lineageNumber(lineage.id);
  const center = chooseLandPoint(state, seed, 1000 + ordinal);
  const count = Math.max(2, Math.round(Math.sqrt(persons / 12_000)));
  const weights = Array.from({ length: count }, (_, i) => 0.65 + unit(seed, ordinal * 701 + i * 67));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  let assigned = 0;
  return Array.from({ length: count }, (_, i) => {
    const point = i === 0 ? center : chooseLandPoint(state, seed, ordinal * 2000 + i, center, 900 + i * 90);
    const headcount = i === count - 1 ? persons - assigned : Math.max(1, Math.round(persons * weights[i] / weightTotal));
    assigned += headcount;
    return {
      id: `${lineage.id}-D${i + 1}`,
      lineageId: lineage.id,
      latitude: point.latitude,
      longitude: point.longitude,
      headcount,
      foundedYearBP: Math.round(Number(state.yearBP) || 777_000),
      lastFissionYearBP: Math.round(Number(state.yearBP) || 777_000)
    };
  });
}

function redistributeDemes(state, lineage) {
  let demes = state.homininDemes.filter((deme) => deme.lineageId === lineage.id && deme.headcount > 0);
  if (!demes.length) {
    state.homininDemes.push(...makeInitialDemes(state, lineage, state.seed ?? 777001));
    demes = state.homininDemes.filter((deme) => deme.lineageId === lineage.id && deme.headcount > 0);
  }
  const target = Math.max(0, Math.round(lineage.populationPersons || 0));
  const oldTotal = demes.reduce((sum, deme) => sum + deme.headcount, 0);
  let assigned = 0;
  for (let i = 0; i < demes.length; i += 1) {
    const next = i === demes.length - 1
      ? target - assigned
      : Math.max(0, Math.round(target * (oldTotal > 0 ? demes[i].headcount / oldTotal : 1 / demes.length)));
    demes[i].headcount = next;
    assigned += next;
  }
}

function summarize(state, births = 0, deaths = 0, dtYears = 0) {
  const living = state.homininLineages.filter((lineage) => lineage.extinctionYearBP == null && lineage.populationPersons > 0);
  const total = living.reduce((sum, lineage) => sum + lineage.populationPersons, 0);
  const ages = { juvenile: 0, adult: 0, mature: 0, elder: 0 };
  for (const lineage of living) for (const key of Object.keys(ages)) ages[key] += Number(lineage.ageStructure?.[key]) || 0;
  state.homininPopulationPersons = Math.round(total);
  state.homininFemalePersons = living.reduce((sum, lineage) => sum + (Number(lineage.femalePersons) || 0), 0);
  state.homininMalePersons = living.reduce((sum, lineage) => sum + (Number(lineage.malePersons) || 0), 0);
  state.homininAgeStructure = ages;
  state.homininBirthsPerYear = dtYears > 0 ? births / dtYears : 0;
  state.homininDeathsPerYear = dtYears > 0 ? deaths / dtYears : 0;
  state.homininDemographicGrowthPerYear = dtYears > 0 && total > 0 ? (births - deaths) / dtYears / total : 0;
  state.homininDemeCount = state.homininDemes.filter((deme) => deme.headcount > 0).length;
  state.homininDemographyPolicy = HOMININ_DEMOGRAPHY_POLICY;
}

export function initializeHomininDemography(state, seed = 777001) {
  if (!Array.isArray(state.homininLineages)) return state;
  state.homininDemes ??= [];
  for (const lineage of state.homininLineages) {
    if (lineage.extinctionYearBP != null) continue;
    if (!Number.isFinite(lineage.populationPersons)) setLineageDemography(lineage, initialPersons(lineage));
    if (!state.homininDemes.some((deme) => deme.lineageId === lineage.id && deme.headcount > 0)) {
      state.homininDemes.push(...makeInitialDemes(state, lineage, seed));
    }
  }
  summarize(state);
  return state;
}

function migrateDemes(state, lineage, dt, random) {
  const variability = Math.abs((Number(state.temperatureAnomaly) || -1.27) + 1.27);
  const distanceKm = (0.18 + clamp(lineage.mobility ?? 0, 0, 1) * 0.82 + variability * 0.08) * dt;
  for (const deme of state.homininDemes.filter((candidate) => candidate.lineageId === lineage.id && candidate.headcount > 0)) {
    const baseAngle = random() * Math.PI * 2;
    let best = { latitude: deme.latitude, longitude: deme.longitude, score: habitatSuitability(state, deme.latitude, deme.longitude) };
    for (let i = 0; i < 8; i += 1) {
      const point = destination(deme.latitude, deme.longitude, baseAngle + i * Math.PI / 4, distanceKm);
      const score = habitatSuitability(state, point.latitude, point.longitude) * (0.94 + random() * 0.12);
      if (score > best.score) best = { ...point, score };
    }
    deme.latitude = best.latitude;
    deme.longitude = best.longitude;
  }
}

function maybeFission(state, lineage, random) {
  const demes = state.homininDemes.filter((deme) => deme.lineageId === lineage.id && deme.headcount > 0);
  if (!demes.length) return;
  const candidate = [...demes].sort((a, b) => b.headcount - a.headcount)[0];
  const threshold = 14_000 * (0.82 + clamp(lineage.sociality ?? 0, 0, 1) * 0.55);
  const elapsed = Math.abs((Number(candidate.lastFissionYearBP) || state.yearBP) - Number(state.yearBP));
  if (candidate.headcount < threshold || elapsed < 750) return;
  const split = Math.max(250, Math.round(candidate.headcount * (0.14 + random() * 0.10)));
  if (candidate.headcount - split < 200) return;
  const rangeKm = 120 + clamp(lineage.mobility ?? 0, 0, 1) * 420;
  const proposed = destination(candidate.latitude, candidate.longitude, random() * Math.PI * 2, rangeKm);
  const point = habitatSuitability(state, proposed.latitude, proposed.longitude) > 0
    ? proposed
    : chooseLandPoint(state, state.seed ?? 777001, lineageNumber(lineage.id) + state.homininDemes.length * 101, candidate, rangeKm * 1.8);
  candidate.headcount -= split;
  candidate.lastFissionYearBP = Math.round(state.yearBP);
  const ordinal = demes.length + 1;
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
    if (!Number.isFinite(lineage.populationPersons)) setLineageDemography(lineage, initialPersons(lineage));
    const current = Math.max(1, lineage.populationPersons);
    const culturalMultiplier = 0.88
      + clamp(lineage.cumulativeCulture ?? 0, 0, 1) * 0.16
      + clamp(lineage.toolComplexity ?? 0, 0, 1) * 0.24
      + clamp(lineage.fireReliance ?? 0, 0, 1) * 0.12;
    const capacity = Math.max(10, positive(lineage.populationIndex, 1e-6) * REFERENCE_PERSONS_PER_INDEX * culturalMultiplier);
    let next;
    if (current <= capacity) {
      const r = 0.0024 * (0.72 + clamp(lineage.sociality ?? 0, 0, 1) * 0.16 + clamp(lineage.communication ?? 0, 0, 1) * 0.12);
      const ratio = Math.max(1e-9, (capacity - current) / current);
      next = capacity / (1 + ratio * Math.exp(-r * dt));
    } else {
      next = capacity + (current - capacity) * Math.exp(-dt / 240);
    }
    next = Math.max(0, Math.round(next));

    const densityRatio = current / Math.max(1, capacity);
    const birthRate = 0.030
      * (0.9 + clamp(lineage.sociality ?? 0, 0, 1) * 0.08 + clamp(lineage.cumulativeCulture ?? 0, 0, 1) * 0.05)
      * clamp(1.12 - densityRatio * 0.22, 0.62, 1.12);
    const births = Math.max(0, Math.round(current * birthRate * dt));
    const deaths = Math.max(0, births - (next - current));
    birthsTotal += births;
    deathsTotal += deaths;

    setLineageDemography(lineage, next);
    lineage.carryingCapacityPersons = Math.round(capacity);
    lineage.birthsPerYear = births / dt;
    lineage.deathsPerYear = deaths / dt;
    lineage.demographicGrowthPerYear = current > 0 ? (next - current) / dt / current : 0;
    redistributeDemes(state, lineage);
    migrateDemes(state, lineage, dt, random);
    maybeFission(state, lineage, random);
  }

  state.homininDemes = state.homininDemes.filter((deme) => deme.headcount > 0);
  summarize(state, birthsTotal, deathsTotal, dt);
  return state;
}

export function homininPopulationAt(state, latitude, longitude, radiusKm = 100) {
  if (!Array.isArray(state?.homininDemes) || !state.homininDemes.length) return null;
  const lineages = new Map((state.homininLineages ?? []).map((lineage) => [lineage.id, lineage]));
  let density = 0;
  let nearestDistanceKm = Infinity;
  let nearestDeme = null;
  const lineageDensity = new Map();
  for (const deme of state.homininDemes) {
    const headcount = Math.max(0, Number(deme.headcount) || 0);
    if (!headcount) continue;
    const distanceKm = greatCircleDistanceKm(latitude, longitude, deme.latitude, deme.longitude);
    if (distanceKm < nearestDistanceKm) {
      nearestDistanceKm = distanceKm;
      nearestDeme = deme;
    }
    const sigmaKm = 115 + clamp(lineages.get(deme.lineageId)?.mobility ?? 0.5, 0, 1) * 185;
    const localDensity = headcount / (2 * Math.PI * sigmaKm * sigmaKm) * Math.exp(-(distanceKm ** 2) / (2 * sigmaKm * sigmaKm));
    density += localDensity;
    lineageDensity.set(deme.lineageId, (lineageDensity.get(deme.lineageId) || 0) + localDensity);
  }
  const radius = Math.max(1, Number(radiusKm) || 100);
  return Object.freeze({
    policy: HOMININ_DEMOGRAPHY_POLICY,
    latitude: Number(latitude),
    longitude: Number(longitude),
    densityPersonsPerKm2: density,
    estimatedPersonsWithinRadius: Math.round(density * Math.PI * radius * radius),
    radiusKm: radius,
    nearestDemeDistanceKm: Number.isFinite(nearestDistanceKm) ? nearestDistanceKm : null,
    nearestDemeId: nearestDeme?.id ?? null,
    nearestLineageId: nearestDeme?.lineageId ?? null,
    lineageDensity: Object.freeze(Object.fromEntries(lineageDensity)),
    epistemicStatus: "explicit demographic headcounts distributed across deterministic migrating demes; local density is a smooth coarse-grained kernel for rendering/inspection, not an invented display population"
  });
}
