const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const clamp01 = (value) => clamp(value, 0, 1);

export const FAUNA_BEHAVIOR_POLICY = "earth777-fauna-behavior-v1";
export const FAUNA_BEHAVIOR_EPISTEMIC_STATUS = "provisional functional behavior coupled to modeled forage, water, predator/prey pressure, and simulated time";

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

function behaviorPhase(id, elapsedYears) {
  const seed = hashText(id);
  return fract((Number(elapsedYears) || 0) * 365.2425 + random01(seed) * 31.7);
}

export function faunaBehaviorAt({
  role = "herbivore",
  id = "fauna",
  elapsedYears = 0,
  productivity = 0.6,
  waterAccess = 0.6,
  predatorPressure = 0.1,
  preyPressure = 0.6,
  aggregatePrior = null
} = {}) {
  const phase = behaviorPhase(id, elapsedYears);
  const priorStress = clamp01(aggregatePrior?.meanStress ?? 0.25);
  const priorEnergy = clamp01(aggregatePrior?.meanEnergy ?? 0.62);
  const forage = clamp01(productivity);
  const water = clamp01(waterAccess);

  if (role === "carnivore") {
    const huntDrive = clamp01(preyPressure * 0.68 + (1 - priorEnergy) * 0.24 + phase * 0.18);
    let behavior = "rest";
    if (huntDrive > 0.62) behavior = "hunt";
    else if (water < 0.36 || phase > 0.82) behavior = "travel";
    else if (phase > 0.48) behavior = "stalk";
    const energy = clamp01(priorEnergy + (behavior === "rest" ? 0.08 : behavior === "hunt" ? -0.07 : -0.025));
    const stress = clamp01(priorStress * 0.72 + (behavior === "hunt" ? 0.18 : 0.04));
    return Object.freeze({ policy: FAUNA_BEHAVIOR_POLICY, role, behavior, phase, energy, stress });
  }

  const threat = clamp01(predatorPressure * 0.72 + priorStress * 0.22 + random01(hashText(id) + Math.floor(elapsedYears * 12)) * 0.12);
  const need = clamp01((1 - forage) * 0.54 + (1 - water) * 0.32 + (1 - priorEnergy) * 0.24);
  let behavior = "graze";
  if (threat > 0.66) behavior = "flee";
  else if (need > 0.58 || water < 0.34) behavior = "travel";
  else if (phase > 0.84) behavior = "rest";
  else if (phase < 0.16) behavior = "drink";
  const energy = clamp01(priorEnergy + (behavior === "graze" ? 0.055 : behavior === "rest" ? 0.035 : behavior === "drink" ? 0.02 : -0.04));
  const stress = clamp01(priorStress * 0.68 + (behavior === "flee" ? 0.34 : threat * 0.10));
  return Object.freeze({ policy: FAUNA_BEHAVIOR_POLICY, role, behavior, phase, energy, stress });
}

export function herdMotionAt({
  id,
  baseX = 0,
  baseZ = 0,
  elapsedYears = 0,
  role = "herbivore",
  productivity = 0.6,
  waterAccess = 0.6,
  predatorPressure = 0.1,
  preyPressure = 0.6,
  aggregatePrior = null
} = {}) {
  const behavior = faunaBehaviorAt({ role, id, elapsedYears, productivity, waterAccess, predatorPressure, preyPressure, aggregatePrior });
  const seed = hashText(id);
  const seasonal = (Number(elapsedYears) || 0) * TAU;
  const preferred = random01(seed + 17) * TAU;
  const waterBias = (0.5 - clamp01(waterAccess)) * 1.3;
  const heading = preferred + Math.sin(seasonal + random01(seed + 29) * TAU) * 0.72 + waterBias;
  const movementScale = behavior.behavior === "flee" ? 0.16
    : behavior.behavior === "travel" || behavior.behavior === "hunt" ? 0.11
      : behavior.behavior === "stalk" ? 0.065
        : behavior.behavior === "drink" ? 0.04
          : 0.025;
  const oscillation = Math.sin((Number(elapsedYears) || 0) * TAU * 6 + random01(seed + 43) * TAU);
  const distance = movementScale * (0.55 + Math.abs(oscillation) * 0.45);
  return Object.freeze({
    ...behavior,
    heading,
    x: Number(baseX) + Math.cos(heading) * distance,
    z: Number(baseZ) + Math.sin(heading) * distance,
    migrationVectorKm: Object.freeze({ east: Math.cos(heading) * distance, north: -Math.sin(heading) * distance })
  });
}

export function individualMotionAt({
  individual,
  herdState,
  elapsedYears = 0,
  aggregatePrior = null,
  productivity = 0.6,
  waterAccess = 0.6,
  predatorPressure = 0.1,
  preyPressure = 0.6
} = {}) {
  const role = individual?.role ?? "herbivore";
  const id = individual?.id ?? "animal";
  const state = faunaBehaviorAt({ role, id, elapsedYears, productivity, waterAccess, predatorPressure, preyPressure, aggregatePrior });
  const seed = hashText(id);
  const speed = state.behavior === "flee" ? 0.028
    : state.behavior === "hunt" ? 0.022
      : state.behavior === "travel" ? 0.017
        : state.behavior === "stalk" ? 0.010
          : 0.005;
  const heading = Number(herdState?.heading) + (random01(seed + 101) - 0.5) * 1.5;
  const phase = (Number(elapsedYears) || 0) * 365.2425 * TAU + random01(seed + 109) * TAU;
  const forward = speed * Math.sin(phase);
  const orbit = 0.008 + random01(seed + 127) * 0.014;
  const x = Number(herdState?.x ?? individual?.x ?? 0)
    + Number(individual?.offsetX || 0)
    + Math.cos(heading) * forward
    + Math.cos(phase * 0.37) * orbit;
  const z = Number(herdState?.z ?? individual?.z ?? 0)
    + Number(individual?.offsetZ || 0)
    + Math.sin(heading) * forward
    + Math.sin(phase * 0.37) * orbit;
  return Object.freeze({ ...state, heading, x, z, yaw: heading });
}

export function collapseObservedFaunaPlan(plan) {
  if (!plan) return null;
  const actors = [...(plan.herds ?? []), ...(plan.packs ?? []), ...(plan.individuals ?? [])];
  if (!actors.length) return Object.freeze({
    policy: FAUNA_BEHAVIOR_POLICY,
    meanEnergy: 0.62,
    meanStress: 0.25,
    behaviorCounts: Object.freeze({}),
    representedPopulation: 0,
    elapsedYears: Number(plan.elapsedYears) || 0
  });
  let weightedEnergy = 0;
  let weightedStress = 0;
  let totalWeight = 0;
  const behaviorCounts = {};
  for (const actor of actors) {
    const weight = Math.max(1, Number(actor.population) || 1);
    const behavior = actor.behaviorState?.behavior ?? actor.behavior ?? "aggregate";
    const energy = clamp01(actor.behaviorState?.energy ?? actor.energy ?? 0.62);
    const stress = clamp01(actor.behaviorState?.stress ?? actor.stress ?? 0.25);
    behaviorCounts[behavior] = (behaviorCounts[behavior] || 0) + weight;
    weightedEnergy += energy * weight;
    weightedStress += stress * weight;
    totalWeight += weight;
  }
  return Object.freeze({
    policy: FAUNA_BEHAVIOR_POLICY,
    meanEnergy: weightedEnergy / Math.max(1, totalWeight),
    meanStress: weightedStress / Math.max(1, totalWeight),
    behaviorCounts: Object.freeze(behaviorCounts),
    representedPopulation: totalWeight,
    elapsedYears: Number(plan.elapsedYears) || 0
  });
}
