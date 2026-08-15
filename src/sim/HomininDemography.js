import { dynamicSurfaceElevationMeters } from "./GeneralAtmosphereCirculation.js";

const EARTH_RADIUS_KM = 6371.0088;
const REFERENCE_PERSONS_PER_INDEX = 80_000;
const MIGRATION_INTERVAL_YEARS = 250;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const positive = (value, floor = 0) => Math.max(floor, Number(value) || 0);

export const HOMININ_DEMOGRAPHY_POLICY = "explicit-headcount-age-sex-migrating-demes-v2";

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

function distanceKm(latA, lonA, latB, lonB) {
  const r = Math.PI / 180;
  const phi1 = Number(latA) * r;
  const phi2 = Number(latB) * r;
  const dPhi = (Number(latB) - Number(latA)) * r;
  const dLambda = wrapLongitude(Number(lonB) - Number(lonA)) * r;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function destination(latitude, longitude, bearing, distance) {
  const delta = Math.max(0, Number(distance) || 0) / EARTH_RADIUS_KM;
  const phi1 = Number(latitude) * Math.PI / 180;
  const lambda1 = Number(longitude) * Math.PI / 180;
  const phi2 = Math.asin(clamp(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearing),
    -1,
    1
  ));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(bearing) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
  );
  return { latitude: clamp(phi2 * 180 / Math.PI, -89.5, 89.5), longitude: wrapLongitude(lambda2 * 180 / Math.PI) };
}

function habitat(state, latitude, longitude) {
  const elevation = dynamicSurfaceElevationMeters(state, latitude, longitude);
  if (!Number.isFinite(elevation) || elevation <= (Number(state?.seaLevel) || 0)) return 0;
  const absoluteLatitude = Math.abs(Number(latitude) || 0);
  const temperatureDeparture = (Number(state?.temperatureAnomaly) || -1.27) + 1.27;
  const optimum = clamp(22 + temperatureDeparture * 3.2, 10, 42);
  const thermalDistance = (absoluteLatitude - optimum) / 34;
  const thermal = Math.exp(-1 * thermalDistance ** 2);
  const elevationPenalty = Math.exp(-Math.max(0, elevation - 1700) / 1800);
  return thermal * elevationPenalty * Math.sqrt(clamp(state?.productivityIndex ?? 1, 0.05, 5));
}

function chooseHabitat(state, seed, salt, anchor = null, radiusKm = 1500) {
  let best = null;
  for (let attempt = 0; attempt < 48; attempt += 1) {
    let point;
    if (anchor) {
      const bearing = unit(seed, salt * 193 + attempt * 17) * Math.PI * 2;
      const radius = radiusKm * Math.sqrt(unit(seed, salt * 271 + attempt * 29));
      point = destination(anchor.latitude, anchor.longitude, bearing, radius);
    } else {
      const z = unit(seed, salt * 313 + attempt * 31) * 2 - 1;
      point = { latitude: Math.asin(z) * 180 / Math.PI, longitude: unit(seed, salt * 419 + attempt * 43) * 360 - 180 };
    }
    const score = habitat(state, point.latitude, point.longitude) * (0.88 + unit(seed, salt * 557 + attempt * 59) * 0.24);
    if (!best || score > best.score) best = { ...point, score };
  }
  return best?.score > 0 ? best : { latitude: 0, longitude: 0, score: 0 };
}

function setLineagePopulation(lineage, persons) {
  const total = Math.max(0, Math.round(persons));
  const culture = clamp(lineage?.cumulativeCulture ?? 0, 0, 1);
  const tools = clamp(lineage?.toolComplexity ?? 0, 0, 1);
  const juvenile = Math.round(total * clamp(0.31 - culture * 0.025, 0.22, 0.34));
  const adult = Math.round(total * 0.37);
  const elder = Math.round(total * clamp(0.035 + culture * 0.025 + tools * 0.018, 0.025, 0.10));
  const female = Math.round(total * 0.505);
  lineage.populationPersons = total;
  lineage.femalePersons = female;
  lineage.malePersons = total - female;
  lineage.ageStructure = { juvenile, adult, mature: Math.max(0, total - juvenile - adult - elder), elder };
}

function initialPersons(lineage) {
  return Math.max(25, Math.round(positive(lineage?.populationIndex, 0.001) * REFERENCE_PERSONS_PER_INDEX));
}

function createDemes(state, lineage, seed) {
  const total = Math.max(1, Number(lineage.populationPersons) || initialPersons(lineage));
  const ordinal = lineageNumber(lineage.id);
  const center = chooseHabitat(state, seed, 1000 + ordinal);
  const count = Math.max(2, Math.round(Math.sqrt(total / 12_000)));
  const weights = Array.from({ length: count }, (_, i) => 0.7 + unit(seed, ordinal * 701 + i * 67));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  let assigned = 0;
  return weights.map((weight, i) => {
    const point = i === 0 ? center : chooseHabitat(state, seed, ordinal * 2000 + i, center, 900 + i * 90);
    const headcount = i === count - 1 ? total - assigned : Math.max(1, Math.round(total * weight / weightTotal));
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

function redistribute(state, lineage) {
  let demes = state.homininDemes.filter((deme) => deme.lineageId === lineage.id && deme.headcount > 0);
  if (!demes.length) {
    state.homininDemes.push(...createDemes(state, lineage, state.seed ?? 777001));
    demes = state.homininDemes.filter((deme) => deme.lineageId === lineage.id && deme.headcount > 0);
  }
  const target = Math.max(0, Math.round(lineage.populationPersons || 0));
  const oldTotal = demes.reduce((sum, deme) => sum + deme.headcount, 0);
  let assigned = 0;
  demes.forEach((deme, index) => {
    const next = index === demes.length - 1
      ? target - assigned
      : Math.max(0, Math.round(target * (oldTotal > 0 ? deme.headcount / oldTotal : 1 / demes.length)));
    deme.headcount = next;
    assigned += next;
  });
}

function summarize(state, births = 0, deaths = 0, dt = 0) {
  const living = state.homininLineages.filter((lineage) => lineage.extinctionYearBP == null && lineage.populationPersons > 0);
  const total = living.reduce((sum, lineage) => sum + lineage.populationPersons, 0);
  const age = { juvenile: 0, adult: 0, mature: 0, elder: 0 };
  for (const lineage of living) for (const key of Object.keys(age)) age[key] += Number(lineage.ageStructure?.[key]) || 0;
  state.homininPopulationPersons = Math.round(total);
  state.homininFemalePersons = living.reduce((sum, lineage) => sum + (Number(lineage.femalePersons) || 0), 0);
  state.homininMalePersons = living.reduce((sum, lineage) => sum + (Number(lineage.malePersons) || 0), 0);
  state.homininAgeStructure = age;
  state.homininBirthsPerYear = dt > 0 ? births / dt : 0;
  state.homininDeathsPerYear = dt > 0 ? deaths / dt : 0;
  state.homininDemographicGrowthPerYear = dt > 0 && total > 0 ? (births - deaths) / dt / total : 0;
  state.homininDemeCount = state.homininDemes.filter((deme) => deme.headcount > 0).length;
  state.homininDemographyPolicy = HOMININ_DEMOGRAPHY_POLICY;
}

export function initializeHomininDemography(state, seed = 777001) {
  if (!Array.isArray(state.homininLineages)) return state;
  state.homininDemes ??= [];
  state.homininMigrationAccumulatorYears ??= 0;
  for (const lineage of state.homininLineages) {
    if (lineage.extinctionYearBP != null) continue;
    if (!Number.isFinite(lineage.populationPersons)) setLineagePopulation(lineage, initialPersons(lineage));
    if (!state.homininDemes.some((deme) => deme.lineageId === lineage.id && deme.headcount > 0)) {
      state.homininDemes.push(...createDemes(state, lineage, seed));
    }
  }
  summarize(state);
  return state;
}

function migrate(state, lineage, elapsedYears, random) {
  const variability = Math.abs((Number(state.temperatureAnomaly) || -1.27) + 1.27);
  const travelKm = (0.18 + clamp(lineage.mobility ?? 0, 0, 1) * 0.82 + variability * 0.08) * elapsedYears;
  const demes = state.homininDemes.filter((deme) => deme.lineageId === lineage.id && deme.headcount > 0);
  for (const deme of demes) {
    const base = random() * Math.PI * 2;
    let best = { latitude: deme.latitude, longitude: deme.longitude, score: habitat(state, deme.latitude, deme.longitude) };
    for (let candidate = 0; candidate < 6; candidate += 1) {
      const point = destination(deme.latitude, deme.longitude, base + candidate * Math.PI / 3, travelKm);
      const score = habitat(state, point.latitude, point.longitude) * (0.95 + random() * 0.10);
      if (score > best.score) best = { ...point, score };
    }
    deme.latitude = best.latitude;
    deme.longitude = best.longitude;
  }

  const largest = [...demes].sort((a, b) => b.headcount - a.headcount)[0];
  if (!largest) return;
  const threshold = 14_000 * (0.82 + clamp(lineage.sociality ?? 0, 0, 1) * 0.55);
  const sinceFission = Math.abs((Number(largest.lastFissionYearBP) || state.yearBP) - Number(state.yearBP));
  if (largest.headcount < threshold || sinceFission < 750) return;
  const split = Math.max(250, Math.round(largest.headcount * (0.14 + random() * 0.10)));
  if (largest.headcount - split < 200) return;
  const rangeKm = 120 + clamp(lineage.mobility ?? 0, 0, 1) * 420;
  const proposed = destination(largest.latitude, largest.longitude, random() * Math.PI * 2, rangeKm);
  const point = habitat(state, proposed.latitude, proposed.longitude) > 0
    ? proposed
    : chooseHabitat(state, state.seed ?? 777001, lineageNumber(lineage.id) + state.homininDemes.length * 101, largest, rangeKm * 1.8);
  largest.headcount -= split;
  largest.lastFissionYearBP = Math.round(state.yearBP);
  state.homininDemes.push({
    id: `${lineage.id}-D${demes.length + 1}`,
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
    if (!Number.isFinite(lineage.populationPersons)) setLineagePopulation(lineage, initialPersons(lineage));
    const current = Math.max(1, lineage.populationPersons);
    const cultureMultiplier = 0.88
      + clamp(lineage.cumulativeCulture ?? 0, 0, 1) * 0.16
      + clamp(lineage.toolComplexity ?? 0, 0, 1) * 0.24
      + clamp(lineage.fireReliance ?? 0, 0, 1) * 0.12;
    const capacity = Math.max(10, positive(lineage.populationIndex, 1e-6) * REFERENCE_PERSONS_PER_INDEX * cultureMultiplier);
    const nextFloat = current <= capacity
      ? capacity / (1 + Math.max(1e-9, (capacity - current) / current) * Math.exp(-0.0024 * dt))
      : capacity + (current - capacity) * Math.exp(-dt / 240);
    const next = Math.max(0, Math.round(nextFloat));
    const densityRatio = current / Math.max(1, capacity);
    const birthRate = 0.030
      * (0.9 + clamp(lineage.sociality ?? 0, 0, 1) * 0.08 + clamp(lineage.cumulativeCulture ?? 0, 0, 1) * 0.05)
      * clamp(1.12 - densityRatio * 0.22, 0.62, 1.12);
    const births = Math.max(0, Math.round(current * birthRate * dt));
    const deaths = Math.max(0, births - (next - current));
    birthsTotal += births;
    deathsTotal += deaths;
    setLineagePopulation(lineage, next);
    lineage.carryingCapacityPersons = Math.round(capacity);
    lineage.birthsPerYear = births / dt;
    lineage.deathsPerYear = deaths / dt;
    lineage.demographicGrowthPerYear = current > 0 ? (next - current) / dt / current : 0;
    redistribute(state, lineage);
  }

  state.homininDemes = state.homininDemes.filter((deme) => deme.headcount > 0);
  state.homininMigrationAccumulatorYears += dt;
  if (state.homininMigrationAccumulatorYears >= MIGRATION_INTERVAL_YEARS) {
    const elapsed = Math.floor(state.homininMigrationAccumulatorYears / MIGRATION_INTERVAL_YEARS) * MIGRATION_INTERVAL_YEARS;
    state.homininMigrationAccumulatorYears -= elapsed;
    for (const lineage of state.homininLineages) {
      if (lineage.extinctionYearBP == null && lineage.populationPersons > 0) migrate(state, lineage, elapsed, random);
    }
  }
  summarize(state, birthsTotal, deathsTotal, dt);
  return state;
}

export function homininPopulationAt(state, latitude, longitude, radiusKm = 100) {
  if (!Array.isArray(state?.homininDemes) || !state.homininDemes.length) return null;
  const lineages = new Map((state.homininLineages ?? []).map((lineage) => [lineage.id, lineage]));
  let density = 0;
  let nearestDistance = Infinity;
  let nearest = null;
  const byLineage = new Map();
  for (const deme of state.homininDemes) {
    const headcount = Math.max(0, Number(deme.headcount) || 0);
    if (!headcount) continue;
    const d = distanceKm(latitude, longitude, deme.latitude, deme.longitude);
    if (d < nearestDistance) { nearestDistance = d; nearest = deme; }
    const sigma = 115 + clamp(lineages.get(deme.lineageId)?.mobility ?? 0.5, 0, 1) * 185;
    const local = headcount / (2 * Math.PI * sigma * sigma) * Math.exp(-(d ** 2) / (2 * sigma * sigma));
    density += local;
    byLineage.set(deme.lineageId, (byLineage.get(deme.lineageId) || 0) + local);
  }
  const radius = Math.max(1, Number(radiusKm) || 100);
  return Object.freeze({
    policy: HOMININ_DEMOGRAPHY_POLICY,
    latitude: Number(latitude),
    longitude: Number(longitude),
    densityPersonsPerKm2: density,
    estimatedPersonsWithinRadius: Math.round(density * Math.PI * radius * radius),
    radiusKm: radius,
    nearestDemeDistanceKm: Number.isFinite(nearestDistance) ? nearestDistance : null,
    nearestDemeId: nearest?.id ?? null,
    nearestLineageId: nearest?.lineageId ?? null,
    lineageDensity: Object.freeze(Object.fromEntries(byLineage)),
    epistemicStatus: "explicit integer headcounts distributed across deterministic migrating demes; demographic counts evolve continuously while geographic range motion uses a fixed 250-year temporal LOD, not a population cap"
  });
}
