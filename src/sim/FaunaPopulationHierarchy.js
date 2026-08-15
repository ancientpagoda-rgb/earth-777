import {
  FAUNA_BEHAVIOR_EPISTEMIC_STATUS,
  FAUNA_BEHAVIOR_POLICY,
  herdMotionAt,
  individualMotionAt
} from "./FaunaBehaviorDynamics.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const TAU = Math.PI * 2;
const KM_PER_DEGREE_LATITUDE = 111.32;

export const FAUNA_HIERARCHY_POLICY = "earth777-fauna-hierarchy-v2";
export const FAUNA_EPISTEMIC_STATUS = "model-derived provisional functional fauna; not yet calibrated to fossil occurrence envelopes";

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

function biomeFaunaFactor(code) {
  if (code >= 1 && code <= 3) return 0.58;
  if (code >= 4 && code <= 11) return 0.82;
  if (code >= 12 && code <= 20) return 1.0;
  if (code === 21) return 0.24;
  if (code >= 22 && code <= 27) return 0.46;
  if (code === 28) return 0.015;
  return 0.72;
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

export function faunaPopulationFieldAt({
  state = {},
  vegetationSample = null,
  hydrologySample = null,
  latitude = 0,
  longitude = 0,
  areaKm2 = 1,
  key = "fauna"
} = {}) {
  const biomass = clamp(state.herbivoreBiomass ?? 1, 0.01, 8);
  const carnivoreBiomass = clamp(state.carnivoreBiomass ?? 1, 0.005, 8);
  const npp = Math.max(0, Number(vegetationSample?.npp) || 0);
  const productivity = npp > 0
    ? clamp(Math.log1p(npp) / Math.log1p(2400), 0.04, 1)
    : clamp((state.productivityIndex ?? 1) / 1.5, 0.04, 1);
  const runoff = Math.max(0, Number(hydrologySample?.surfaceRunoffMmPerYear ?? hydrologySample?.runoffPotentialMmPerYear) || 0);
  const waterAccess = runoff > 0 ? clamp(0.32 + Math.log1p(runoff) / Math.log1p(1600) * 0.68, 0.32, 1) : 0.58;
  const biomeFactor = biomeFaunaFactor(Number(vegetationSample?.biomeCode));
  const herbivoreDensityAnimalsPerKm2 = clamp(
    0.035 + 3.4 * biomass ** 0.72 * (0.24 + productivity * 0.76) * (0.52 + waterAccess * 0.48) * biomeFactor,
    0,
    40
  );
  const predatorPressure = clamp(carnivoreBiomass / Math.max(0.05, biomass), 0, 3);
  const carnivoreDensityAnimalsPerKm2 = clamp(herbivoreDensityAnimalsPerKm2 * (0.012 + predatorPressure * 0.018), 0, 1.6);
  const preyPressure = clamp(herbivoreDensityAnimalsPerKm2 / 8, 0, 1);
  const boundedArea = Math.max(0, Number(areaKm2) || 0);
  const herbivorePopulation = Math.max(0, Math.round(herbivoreDensityAnimalsPerKm2 * boundedArea));
  const carnivorePopulation = Math.max(0, Math.round(carnivoreDensityAnimalsPerKm2 * boundedArea));
  const meanHerdSize = clamp(5 + productivity * 13 + biomass * 2.5, 4, 36);
  const meanPackSize = clamp(1.5 + preyPressure * 3.5, 1.5, 6);
  const estimatedHerds = herbivorePopulation > 0 ? Math.max(1, Math.ceil(herbivorePopulation / meanHerdSize)) : 0;
  const estimatedPacks = carnivorePopulation > 0 ? Math.max(1, Math.ceil(carnivorePopulation / meanPackSize)) : 0;

  return Object.freeze({
    policy: FAUNA_HIERARCHY_POLICY,
    epistemicStatus: FAUNA_EPISTEMIC_STATUS,
    behaviorPolicy: FAUNA_BEHAVIOR_POLICY,
    behaviorEpistemicStatus: FAUNA_BEHAVIOR_EPISTEMIC_STATUS,
    key,
    latitude: Number(latitude) || 0,
    longitude: Number(longitude) || 0,
    areaKm2: boundedArea,
    herbivoreDensityAnimalsPerKm2,
    carnivoreDensityAnimalsPerKm2,
    herbivorePopulation,
    carnivorePopulation,
    estimatedHerds,
    estimatedPacks,
    meanHerdSize,
    meanPackSize,
    productivity,
    waterAccess,
    predatorPressure,
    preyPressure,
    biomeCode: vegetationSample?.biomeCode ?? null
  });
}

export function faunaFieldsForCells(cells = [], context = {}) {
  return Object.freeze(cells.map((cell) => faunaPopulationFieldAt({
    state: context.state,
    vegetationSample: context.vegetationSample,
    hydrologySample: context.hydrologySample,
    latitude: cell.latitude,
    longitude: cell.longitude,
    areaKm2: approximateCellAreaKm2(cell),
    key: cell.key
  })));
}

export function faunaLocalSummariesForCells(cells = [], context = {}) {
  const elapsedYears = Number(context.state?.elapsedYears) || 0;
  return Object.freeze(faunaFieldsForCells(cells, context).map((field) => {
    const representative = herdMotionAt({
      id: `${field.key}:representative-herd`,
      baseX: 0,
      baseZ: 0,
      elapsedYears,
      role: "herbivore",
      productivity: field.productivity,
      waterAccess: field.waterAccess,
      predatorPressure: field.predatorPressure,
      preyPressure: field.preyPressure
    });
    return Object.freeze({
      policy: FAUNA_HIERARCHY_POLICY,
      behaviorPolicy: FAUNA_BEHAVIOR_POLICY,
      key: field.key,
      latitude: field.latitude,
      longitude: field.longitude,
      areaKm2: field.areaKm2,
      herbivorePopulation: field.herbivorePopulation,
      carnivorePopulation: field.carnivorePopulation,
      estimatedHerds: field.estimatedHerds,
      estimatedPacks: field.estimatedPacks,
      meanHerdSize: field.meanHerdSize,
      densityAnimalsPerKm2: field.herbivoreDensityAnimalsPerKm2,
      dominantBehavior: representative.behavior,
      migrationBearingRadians: representative.heading,
      migrationVectorKm: representative.migrationVectorKm
    });
  }));
}

function visiblePopulationFromDensity(densityAnimalsPerKm2, radiusKm) {
  return Math.max(0, Math.round(Math.max(0, densityAnimalsPerKm2) * Math.PI * radiusKm * radiusKm));
}

function buildGroups({ role, population, meanGroupSize, radiusKm, nearRadiusKm, focusXKm, focusZKm, baseSeed, field, elapsedYears, aggregatePrior, prefix }) {
  const groupCount = population > 0 ? Math.max(1, Math.ceil(population / meanGroupSize)) : 0;
  const groups = [];
  const individuals = [];
  let remainingPopulation = population;
  for (let index = 0; index < groupCount; index += 1) {
    const remainingGroups = groupCount - index;
    const target = remainingGroups === 1
      ? remainingPopulation
      : Math.max(1, Math.round(meanGroupSize * (0.58 + random01(baseSeed + index * 31.7) * 0.84)));
    const groupPopulation = Math.max(0, Math.min(remainingPopulation - Math.max(0, remainingGroups - 1), target));
    remainingPopulation -= groupPopulation;
    const angle = random01(baseSeed + index * 47.3 + 11) * TAU;
    const distanceKm = radiusKm * Math.sqrt(random01(baseSeed + index * 59.9 + 17));
    const baseX = focusXKm + Math.cos(angle) * distanceKm;
    const baseZ = focusZKm + Math.sin(angle) * distanceKm;
    const groupRadiusKm = role === "carnivore"
      ? clamp(0.012 + Math.sqrt(Math.max(1, groupPopulation)) * 0.0045, 0.012, 0.08)
      : clamp(0.018 + Math.sqrt(Math.max(1, groupPopulation)) * 0.0065, 0.018, 0.16);
    const id = `${prefix}-${index}-${hashText(`${baseSeed}:${index}`)}`;
    const behaviorState = herdMotionAt({ id, baseX, baseZ, elapsedYears, role, productivity: field.productivity, waterAccess: field.waterAccess, predatorPressure: field.predatorPressure, preyPressure: field.preyPressure, aggregatePrior });
    const materializeIndividuals = distanceKm <= nearRadiusKm + groupRadiusKm;
    const group = Object.freeze({
      id,
      role,
      population: groupPopulation,
      baseX,
      baseZ,
      x: behaviorState.x,
      z: behaviorState.z,
      distanceKm,
      radiusKm: groupRadiusKm,
      representation: materializeIndividuals ? "individuals" : role === "carnivore" ? "pack" : "herd",
      behavior: behaviorState.behavior,
      behaviorState
    });
    groups.push(group);

    if (materializeIndividuals) {
      for (let animalIndex = 0; animalIndex < groupPopulation; animalIndex += 1) {
        const animalAngle = random01(baseSeed + index * 101.3 + animalIndex * 13.1 + 71) * TAU;
        const animalDistance = groupRadiusKm * Math.sqrt(random01(baseSeed + index * 107.9 + animalIndex * 17.7 + 89));
        const baseIndividual = {
          id: `${id}:animal-${animalIndex}`,
          groupId: id,
          herdId: role === "herbivore" ? id : null,
          packId: role === "carnivore" ? id : null,
          role,
          offsetX: Math.cos(animalAngle) * animalDistance,
          offsetZ: Math.sin(animalAngle) * animalDistance,
          scale: role === "carnivore"
            ? 0.62 + random01(baseSeed + index * 113.3 + animalIndex * 23.9) * 0.48
            : 0.72 + random01(baseSeed + index * 113.3 + animalIndex * 23.9) * 0.72
        };
        const motion = individualMotionAt({ individual: baseIndividual, herdState: behaviorState, elapsedYears, aggregatePrior, productivity: field.productivity, waterAccess: field.waterAccess, predatorPressure: field.predatorPressure, preyPressure: field.preyPressure });
        individuals.push(Object.freeze({ ...baseIndividual, x: motion.x, z: motion.z, yaw: motion.yaw, behavior: motion.behavior, behaviorState: motion }));
      }
    }
  }
  return { groups: Object.freeze(groups), individuals: Object.freeze(individuals) };
}

export function buildObservedFaunaPlan({
  state = {},
  vegetationSample = null,
  hydrologySample = null,
  latitude = 0,
  longitude = 0,
  seed = 777001,
  focusXKm = 0,
  focusZKm = 0,
  windowRadiusKm = 3.5,
  individualRadiusKm = 0.55,
  aggregatePrior = null
} = {}) {
  const radiusKm = Math.max(0.05, Number(windowRadiusKm) || 3.5);
  const nearRadiusKm = clamp(individualRadiusKm, 0.05, radiusKm);
  const elapsedYears = Number(state.elapsedYears) || 0;
  const field = faunaPopulationFieldAt({ state, vegetationSample, hydrologySample, latitude, longitude, areaKm2: Math.PI * radiusKm * radiusKm, key: "observed-window" });
  const visiblePopulation = visiblePopulationFromDensity(field.herbivoreDensityAnimalsPerKm2, radiusKm);
  const visibleCarnivorePopulation = visiblePopulationFromDensity(field.carnivoreDensityAnimalsPerKm2, radiusKm);
  const baseSeed = (Number(seed) >>> 0) ^ hashText(`${latitude.toFixed(4)}:${longitude.toFixed(4)}`);
  const herbivores = buildGroups({ role: "herbivore", population: visiblePopulation, meanGroupSize: field.meanHerdSize, radiusKm, nearRadiusKm, focusXKm, focusZKm, baseSeed, field, elapsedYears, aggregatePrior, prefix: "herd" });
  const carnivores = buildGroups({ role: "carnivore", population: visibleCarnivorePopulation, meanGroupSize: field.meanPackSize, radiusKm, nearRadiusKm, focusXKm, focusZKm, baseSeed: baseSeed ^ 0x9e3779b9, field, elapsedYears, aggregatePrior, prefix: "pack" });
  const individuals = Object.freeze([...herbivores.individuals, ...carnivores.individuals]);
  const allGroups = [...herbivores.groups, ...carnivores.groups];
  const behaviorCounts = {};
  for (const actor of [...allGroups, ...individuals]) {
    const behavior = actor.behavior ?? "aggregate";
    const weight = Math.max(1, Number(actor.population) || 1);
    behaviorCounts[behavior] = (behaviorCounts[behavior] || 0) + weight;
  }
  return Object.freeze({
    policy: FAUNA_HIERARCHY_POLICY,
    epistemicStatus: FAUNA_EPISTEMIC_STATUS,
    behaviorPolicy: FAUNA_BEHAVIOR_POLICY,
    behaviorEpistemicStatus: FAUNA_BEHAVIOR_EPISTEMIC_STATUS,
    elapsedYears,
    field,
    focusKey: `observed:${Number(seed) >>> 0}:${Math.round(latitude * 10)}:${Math.round(longitude * 10)}`,
    aggregatePrior,
    windowRadiusKm: radiusKm,
    individualRadiusKm: nearRadiusKm,
    visiblePopulation,
    visibleCarnivorePopulation,
    herds: herbivores.groups,
    packs: carnivores.groups,
    individuals,
    behaviorCounts: Object.freeze(behaviorCounts),
    aggregateOnlyPopulation: herbivores.groups.filter((group) => group.representation === "herd").reduce((sum, group) => sum + group.population, 0),
    aggregateOnlyCarnivorePopulation: carnivores.groups.filter((group) => group.representation === "pack").reduce((sum, group) => sum + group.population, 0),
    materializedPopulation: herbivores.individuals.length,
    materializedCarnivores: carnivores.individuals.length,
    totalMaterializedPopulation: individuals.length
  });
}
