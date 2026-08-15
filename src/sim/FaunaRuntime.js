const TAU = Math.PI * 2;
const KM_PER_DEGREE_LATITUDE = 111.32;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const clamp01 = (value) => clamp(value, 0, 1);

export const FAUNA_POLICY = "earth777-fauna-runtime-v4";
export const FAUNA_EPISTEMIC_STATUS = "provisional functional fauna derived from modeled productivity, water, predator/prey pressure, evolving lineage traits, and simulated time; not yet fossil-calibrated";

function fract(value) { return value - Math.floor(value); }
function random01(seed) { return fract(Math.sin(seed * 12.9898 + 78.233) * 43758.5453123); }
function hashText(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function biomeFactor(code) {
  if (code >= 1 && code <= 3) return 0.58;
  if (code >= 4 && code <= 11) return 0.82;
  if (code >= 12 && code <= 20) return 1.0;
  if (code === 21) return 0.24;
  if (code >= 22 && code <= 27) return 0.46;
  if (code === 28) return 0.015;
  return 0.72;
}

function lineagesForRole(state, role) {
  const living = (state?.speciesLineages ?? []).filter((lineage) => lineage.extinctionYearBP == null && Number(lineage.populationIndex) > 0);
  const matching = living.filter((lineage) => role === "carnivore"
    ? Number(lineage.trophicLevel) >= 0.55
    : Number(lineage.trophicLevel) < 0.55);
  return Object.freeze(matching);
}

function chooseLineage(lineages, seed) {
  if (!lineages?.length) return null;
  const total = lineages.reduce((sum, lineage) => sum + Math.max(0, Number(lineage.populationIndex) || 0), 0);
  if (total <= 0) return lineages[Math.min(lineages.length - 1, Math.floor(random01(seed) * lineages.length))];
  let cursor = random01(seed) * total;
  for (const lineage of lineages) {
    cursor -= Math.max(0, Number(lineage.populationIndex) || 0);
    if (cursor <= 0) return lineage;
  }
  return lineages.at(-1);
}

function lineageTraits(lineage) {
  if (!lineage) return Object.freeze({ mobility: 0.5, sociality: 0.5, dietBreadth: 0.5, cognition: 0.5, bodyMassLog10Kg: null });
  return Object.freeze({
    mobility: clamp01(lineage.mobility ?? 0.5),
    sociality: clamp01(lineage.sociality ?? 0.5),
    dietBreadth: clamp01(lineage.dietBreadth ?? 0.5),
    cognition: clamp01(lineage.cognition ?? 0.5),
    bodyMassLog10Kg: clamp(lineage.bodyMassLog10Kg ?? 0.4, -0.5, 3.5)
  });
}

function lineageVisualScale(lineage) {
  if (!lineage) return 1;
  const bodyMassLog10Kg = lineageTraits(lineage).bodyMassLog10Kg;
  return clamp(0.62 + (bodyMassLog10Kg + 0.5) * 0.25, 0.62, 1.62);
}

function lineageGroupSizeScale(lineage, role) {
  if (!lineage) return 1;
  const traits = lineageTraits(lineage);
  const massNorm = clamp01((traits.bodyMassLog10Kg + 0.5) / 4);
  const socialScale = 0.72 + traits.sociality * (role === "carnivore" ? 0.62 : 0.78);
  const massScale = role === "carnivore" ? 1.08 - massNorm * 0.22 : 1.14 - massNorm * 0.28;
  return clamp(socialScale * massScale, 0.62, 1.55);
}

function meanGroupSizeScale(lineages, role) {
  if (!lineages?.length) return 1;
  const total = lineages.reduce((sum, lineage) => sum + Math.max(0, Number(lineage.populationIndex) || 0), 0);
  if (total <= 0) return 1;
  return lineages.reduce((sum, lineage) => sum + lineageGroupSizeScale(lineage, role) * Math.max(0, Number(lineage.populationIndex) || 0), 0) / total;
}

export function approximateCellAreaKm2(cell) {
  const bounds = cell?.bounds;
  if (!bounds) return 0;
  const latSpan = Math.max(0, Number(bounds.north) - Number(bounds.south));
  const lonSpan = Math.max(0, Number(bounds.east) - Number(bounds.west));
  const latitude = Number(cell.latitude) || 0;
  const eastWestKm = KM_PER_DEGREE_LATITUDE * Math.max(0.015, Math.cos(latitude * Math.PI / 180));
  return latSpan * KM_PER_DEGREE_LATITUDE * lonSpan * eastWestKm;
}

export function faunaPopulationAt({
  state = {},
  vegetationSample = null,
  hydrologySample = null,
  latitude = 0,
  longitude = 0,
  areaKm2 = 1,
  key = "fauna"
} = {}) {
  const herbivoreBiomass = clamp(state.herbivoreBiomass ?? 1, 0.01, 8);
  const carnivoreBiomass = clamp(state.carnivoreBiomass ?? 1, 0.005, 8);
  const npp = Math.max(0, Number(vegetationSample?.npp) || 0);
  const productivity = npp > 0
    ? clamp(Math.log1p(npp) / Math.log1p(2400), 0.04, 1)
    : clamp((state.productivityIndex ?? 1) / 1.5, 0.04, 1);
  const runoff = Math.max(0, Number(hydrologySample?.surfaceRunoffMmPerYear ?? hydrologySample?.runoffPotentialMmPerYear) || 0);
  const waterAccess = runoff > 0 ? clamp(0.32 + Math.log1p(runoff) / Math.log1p(1600) * 0.68, 0.32, 1) : 0.58;
  const herbivoreDensity = clamp(
    0.035 + 3.4 * herbivoreBiomass ** 0.72 * (0.24 + productivity * 0.76) * (0.52 + waterAccess * 0.48) * biomeFactor(Number(vegetationSample?.biomeCode)),
    0,
    40
  );
  const predatorPressure = clamp(carnivoreBiomass / Math.max(0.05, herbivoreBiomass), 0, 3);
  const carnivoreDensity = clamp(herbivoreDensity * (0.012 + predatorPressure * 0.018), 0, 1.6);
  const preyPressure = clamp01(herbivoreDensity / 8);
  const area = Math.max(0, Number(areaKm2) || 0);
  const herbivorePopulation = Math.max(0, Math.round(herbivoreDensity * area));
  const carnivorePopulation = Math.max(0, Math.round(carnivoreDensity * area));
  const meanHerdSize = clamp(5 + productivity * 13 + herbivoreBiomass * 2.5, 4, 36);
  const meanPackSize = clamp(1.5 + preyPressure * 3.5, 1.5, 6);

  return Object.freeze({
    policy: FAUNA_POLICY,
    epistemicStatus: FAUNA_EPISTEMIC_STATUS,
    key,
    latitude: Number(latitude) || 0,
    longitude: Number(longitude) || 0,
    areaKm2: area,
    herbivoreDensityAnimalsPerKm2: herbivoreDensity,
    carnivoreDensityAnimalsPerKm2: carnivoreDensity,
    herbivorePopulation,
    carnivorePopulation,
    estimatedHerds: herbivorePopulation > 0 ? Math.max(1, Math.ceil(herbivorePopulation / meanHerdSize)) : 0,
    estimatedPacks: carnivorePopulation > 0 ? Math.max(1, Math.ceil(carnivorePopulation / meanPackSize)) : 0,
    meanHerdSize,
    meanPackSize,
    productivity,
    waterAccess,
    predatorPressure,
    preyPressure,
    biomeCode: vegetationSample?.biomeCode ?? null
  });
}

export function faunaForCells(cells = [], context = {}) {
  return Object.freeze(cells.map((cell) => faunaPopulationAt({
    state: context.state,
    vegetationSample: context.vegetationSample,
    hydrologySample: context.hydrologySample,
    latitude: cell.latitude,
    longitude: cell.longitude,
    areaKm2: approximateCellAreaKm2(cell),
    key: cell.key
  })));
}

export function faunaGroupBehaviorAt({ role = "herbivore", id = "group", elapsedYears = 0, field = {}, lineage = null } = {}) {
  const phase = fract((Number(elapsedYears) || 0) * 365.2425 + random01(hashText(id)) * 31.7);
  if (!lineage) {
    let behavior;
    if (role === "carnivore") {
      const huntDrive = clamp01((field.preyPressure ?? 0.5) * 0.76 + phase * 0.24);
      behavior = huntDrive > 0.64 ? "hunt" : phase > 0.72 ? "travel" : phase > 0.38 ? "stalk" : "rest";
    } else {
      const threat = clamp01((field.predatorPressure ?? 0.1) * 0.72 + random01(hashText(id) + Math.floor(elapsedYears * 12)) * 0.18);
      const need = clamp01((1 - (field.productivity ?? 0.6)) * 0.58 + (1 - (field.waterAccess ?? 0.6)) * 0.42);
      behavior = threat > 0.66 ? "flee"
        : need > 0.58 ? "travel"
          : phase < 0.15 ? "drink"
            : phase > 0.84 ? "rest"
              : "graze";
    }
    const seed = hashText(id);
    const seasonal = (Number(elapsedYears) || 0) * TAU;
    const heading = random01(seed + 17) * TAU + Math.sin(seasonal + random01(seed + 29) * TAU) * 0.72;
    const distanceKm = behavior === "flee" ? 0.16
      : behavior === "travel" || behavior === "hunt" ? 0.11
        : behavior === "stalk" ? 0.06
          : behavior === "drink" ? 0.04
            : 0.025;
    return Object.freeze({ role, behavior, heading, distanceKm });
  }

  const traits = lineageTraits(lineage);
  let behavior;
  if (role === "carnivore") {
    const preyDependence = 0.78 + (1 - traits.dietBreadth) * 0.22;
    const huntDrive = clamp01((field.preyPressure ?? 0.5) * 0.68 * preyDependence + phase * 0.16 + traits.mobility * 0.08 + traits.cognition * 0.08);
    behavior = huntDrive > 0.64 ? "hunt"
      : phase > 0.76 - traits.cognition * 0.12 ? "travel"
        : phase > 0.42 - traits.cognition * 0.12 ? "stalk"
          : "rest";
  } else {
    const threat = clamp01((field.predatorPressure ?? 0.1) * 0.68
      + random01(hashText(id) + Math.floor(elapsedYears * 12)) * 0.18
      + traits.cognition * 0.05
      - traits.sociality * 0.05);
    const rawNeed = clamp01((1 - (field.productivity ?? 0.6)) * 0.58 + (1 - (field.waterAccess ?? 0.6)) * 0.42);
    const need = clamp01(rawNeed * (1 - traits.dietBreadth * 0.22));
    behavior = threat > 0.66 ? "flee"
      : need > 0.58 ? "travel"
        : phase < 0.15 ? "drink"
          : phase > 0.84 ? "rest"
            : "graze";
  }

  const seed = hashText(id);
  const seasonal = (Number(elapsedYears) || 0) * TAU;
  const headingWander = 0.82 - traits.cognition * 0.34;
  const heading = random01(seed + 17) * TAU + Math.sin(seasonal + random01(seed + 29) * TAU) * headingWander;
  const baseDistanceKm = behavior === "flee" ? 0.16
    : behavior === "travel" || behavior === "hunt" ? 0.11
      : behavior === "stalk" ? 0.06
        : behavior === "drink" ? 0.04
          : 0.025;
  const mobilityScale = 0.70 + traits.mobility * 0.70;
  const distanceKm = baseDistanceKm * mobilityScale;
  return Object.freeze({ role, behavior, heading, distanceKm });
}

function visiblePopulation(density, radiusKm) {
  return Math.max(0, Math.round(Math.max(0, density) * Math.PI * radiusKm * radiusKm));
}

function buildGroups({ role, population, meanSize, radiusKm, individualRadiusKm, focusXKm, focusZKm, seed, field, elapsedYears, lineages }) {
  const effectiveMeanSize = meanSize * meanGroupSizeScale(lineages, role);
  const count = population > 0 ? Math.max(1, Math.ceil(population / Math.max(1, effectiveMeanSize))) : 0;
  const groups = [];
  const individuals = [];
  let remaining = population;

  for (let index = 0; index < count; index += 1) {
    const groupsLeft = count - index;
    const lineage = chooseLineage(lineages, seed + index * 73.1 + 23);
    const groupSizeScale = lineageGroupSizeScale(lineage, role);
    const target = groupsLeft === 1 ? remaining : Math.max(1, Math.round(meanSize * groupSizeScale * (0.58 + random01(seed + index * 31.7) * 0.84)));
    const groupPopulation = Math.max(0, Math.min(remaining - Math.max(0, groupsLeft - 1), target));
    remaining -= groupPopulation;

    const angle = random01(seed + index * 47.3 + 11) * TAU;
    const baseDistance = radiusKm * Math.sqrt(random01(seed + index * 59.9 + 17));
    const baseX = focusXKm + Math.cos(angle) * baseDistance;
    const baseZ = focusZKm + Math.sin(angle) * baseDistance;
    const id = `${role}-${index}-${hashText(`${seed}:${index}`)}`;
    const traits = lineageTraits(lineage);
    const visualScale = lineageVisualScale(lineage);
    const behavior = faunaGroupBehaviorAt({ role, id, elapsedYears, field, lineage });
    const x = baseX + Math.cos(behavior.heading) * behavior.distanceKm;
    const z = baseZ + Math.sin(behavior.heading) * behavior.distanceKm;
    const massNorm = traits.bodyMassLog10Kg == null ? 0.5 : clamp01((traits.bodyMassLog10Kg + 0.5) / 4);
    const spacingScale = 0.88 + massNorm * 0.24;
    const groupRadiusKm = (role === "carnivore"
      ? clamp(0.012 + Math.sqrt(Math.max(1, groupPopulation)) * 0.0045, 0.012, 0.08)
      : clamp(0.018 + Math.sqrt(Math.max(1, groupPopulation)) * 0.0065, 0.018, 0.16)) * spacingScale;
    const materialized = baseDistance <= individualRadiusKm + groupRadiusKm;

    groups.push(Object.freeze({
      id,
      role,
      lineageId: lineage?.id ?? null,
      population: groupPopulation,
      x,
      z,
      radiusKm: groupRadiusKm,
      representation: materialized ? "individuals" : role === "carnivore" ? "pack" : "herd",
      behavior: behavior.behavior,
      heading: behavior.heading,
      groupSizeScale: lineage ? groupSizeScale : null,
      spacingScale: lineage ? spacingScale : null,
      mobility: lineage ? traits.mobility : null,
      sociality: lineage ? traits.sociality : null,
      dietBreadth: lineage ? traits.dietBreadth : null,
      cognition: lineage ? traits.cognition : null,
      bodyMassLog10Kg: lineage?.bodyMassLog10Kg ?? null,
      trophicLevel: lineage?.trophicLevel ?? null
    }));

    if (!materialized) continue;
    for (let animalIndex = 0; animalIndex < groupPopulation; animalIndex += 1) {
      const animalSeed = seed + index * 101.3 + animalIndex * 17.7;
      const animalAngle = random01(animalSeed + 71) * TAU;
      const animalDistance = groupRadiusKm * Math.sqrt(random01(animalSeed + 89));
      const wobble = 0.004 * (lineage ? 0.75 + traits.mobility * 0.5 : 1) * Math.sin((Number(elapsedYears) || 0) * 365.2425 * TAU + random01(animalSeed + 109) * TAU);
      const baseScale = role === "carnivore" ? 0.62 + random01(animalSeed + 113) * 0.48 : 0.72 + random01(animalSeed + 113) * 0.72;
      individuals.push(Object.freeze({
        id: `${id}:${animalIndex}`,
        groupId: id,
        role,
        lineageId: lineage?.id ?? null,
        behavior: behavior.behavior,
        x: x + Math.cos(animalAngle) * animalDistance + Math.cos(behavior.heading) * wobble,
        z: z + Math.sin(animalAngle) * animalDistance + Math.sin(behavior.heading) * wobble,
        yaw: behavior.heading,
        scale: baseScale * visualScale
      }));
    }
  }

  return { groups: Object.freeze(groups), individuals: Object.freeze(individuals) };
}

export function buildObservedFauna({
  state = {},
  vegetationSample = null,
  hydrologySample = null,
  latitude = 0,
  longitude = 0,
  seed = 777001,
  focusXKm = 0,
  focusZKm = 0,
  windowRadiusKm = 3.5,
  individualRadiusKm = 0.55
} = {}) {
  const radiusKm = Math.max(0.05, Number(windowRadiusKm) || 3.5);
  const nearRadiusKm = clamp(individualRadiusKm, 0.05, radiusKm);
  const elapsedYears = Number(state.elapsedYears) || 0;
  const field = faunaPopulationAt({
    state,
    vegetationSample,
    hydrologySample,
    latitude,
    longitude,
    areaKm2: Math.PI * radiusKm * radiusKm,
    key: "observed-window"
  });
  const herbivorePopulation = visiblePopulation(field.herbivoreDensityAnimalsPerKm2, radiusKm);
  const carnivorePopulation = visiblePopulation(field.carnivoreDensityAnimalsPerKm2, radiusKm);
  const baseSeed = (Number(seed) >>> 0) ^ hashText(`${latitude.toFixed(4)}:${longitude.toFixed(4)}`);
  const herbivores = buildGroups({ role: "herbivore", population: herbivorePopulation, meanSize: field.meanHerdSize, radiusKm, individualRadiusKm: nearRadiusKm, focusXKm, focusZKm, seed: baseSeed, field, elapsedYears, lineages: lineagesForRole(state, "herbivore") });
  const carnivores = buildGroups({ role: "carnivore", population: carnivorePopulation, meanSize: field.meanPackSize, radiusKm, individualRadiusKm: nearRadiusKm, focusXKm, focusZKm, seed: baseSeed ^ 0x9e3779b9, field, elapsedYears, lineages: lineagesForRole(state, "carnivore") });
  const individuals = Object.freeze([...herbivores.individuals, ...carnivores.individuals]);
  const groups = [...herbivores.groups, ...carnivores.groups];
  const behaviorCounts = {};
  for (const group of groups) behaviorCounts[group.behavior] = (behaviorCounts[group.behavior] || 0) + group.population;
  const lineageIds = Object.freeze([...new Set(groups.map((group) => group.lineageId).filter((id) => id != null))]);

  return Object.freeze({
    policy: FAUNA_POLICY,
    epistemicStatus: FAUNA_EPISTEMIC_STATUS,
    elapsedYears,
    field,
    windowRadiusKm: radiusKm,
    individualRadiusKm: nearRadiusKm,
    visiblePopulation: herbivorePopulation,
    visibleCarnivorePopulation: carnivorePopulation,
    herds: herbivores.groups,
    packs: carnivores.groups,
    individuals,
    lineageIds,
    behaviorCounts: Object.freeze(behaviorCounts),
    materializedHerbivores: herbivores.individuals.length,
    materializedCarnivores: carnivores.individuals.length,
    totalMaterializedPopulation: individuals.length,
    aggregateOnlyPopulation: herbivores.groups.filter((group) => group.representation === "herd").reduce((sum, group) => sum + group.population, 0),
    aggregateOnlyCarnivorePopulation: carnivores.groups.filter((group) => group.representation === "pack").reduce((sum, group) => sum + group.population, 0)
  });
}
