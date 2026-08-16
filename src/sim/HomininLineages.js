const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const positive = (value, floor = 1e-9) => Math.max(floor, Number(value) || 0);
const relax = (current, target, dtYears, tauYears) => current + (target - current) * (1 - Math.exp(-dtYears / tauYears));

function hash32(value) {
  let x = Number(value) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function unit(seed, index, salt) {
  return hash32((Number(seed) >>> 0) ^ Math.imul(index + 1, salt)) / 0x100000000;
}

function initialHominin(seed, index) {
  return {
    id: `H${index + 1}`,
    parentId: null,
    birthYearBP: 777000,
    extinctionYearBP: null,
    populationIndex: 0.34 + unit(seed, index, 0x9e3779b1) * 0.44,
    brainIndex: 0.34 + unit(seed, index, 0x85ebca77) * 0.17,
    dexterity: 0.46 + unit(seed, index, 0xc2b2ae3d) * 0.18,
    sociality: 0.38 + unit(seed, index, 0x27d4eb2f) * 0.20,
    mobility: 0.44 + unit(seed, index, 0x165667b1) * 0.24,
    communication: 0.24 + unit(seed, index, 0xd3a2646c) * 0.18,
    cumulativeCulture: 0.08 + unit(seed, index, 0xfd7046c5) * 0.10,
    toolComplexity: 0.12 + unit(seed, index, 0xb55a4f09) * 0.10,
    fireReliance: 0.04 + unit(seed, index, 0x94d049bb) * 0.08,
    ecologicalBreadth: 0.38 + unit(seed, index, 0x369dea0f) * 0.24,
    divergence: unit(seed, index, 0xdb4f0b91) * 0.18
  };
}

export const HOMININ_LINEAGE_POLICY = "population-culture-lineage-coevolution-v1";

export function initializeHomininLineages(state, seed = 777001) {
  if (!Array.isArray(state.homininLineages)) {
    state.homininLineages = [initialHominin(seed, 0), initialHominin(seed, 1)];
  }
  state.nextHomininLineageId ??= state.homininLineages.length + 1;
  state.homininSpeciesRichness ??= state.homininLineages.length;
  state.cognitionIndex ??= state.homininLineages.reduce((sum, lineage) => sum + lineage.brainIndex, 0) / state.homininLineages.length;
  state.cultureIndex ??= state.homininLineages.reduce((sum, lineage) => sum + lineage.cumulativeCulture, 0) / state.homininLineages.length;
  state.technologyIndex ??= state.homininLineages.reduce((sum, lineage) => sum + lineage.toolComplexity, 0) / state.homininLineages.length;
  state.communicationIndex ??= state.homininLineages.reduce((sum, lineage) => sum + lineage.communication, 0) / state.homininLineages.length;
  return state;
}

function mutate(parent, id, state, random) {
  const centered = () => (random() + random() - 1);
  return {
    id: `H${id}`,
    parentId: parent.id,
    birthYearBP: Math.round(state.yearBP),
    extinctionYearBP: null,
    populationIndex: parent.populationIndex * 0.31,
    brainIndex: clamp01(parent.brainIndex + centered() * 0.055),
    dexterity: clamp01(parent.dexterity + centered() * 0.045),
    sociality: clamp01(parent.sociality + centered() * 0.055),
    mobility: clamp01(parent.mobility + centered() * 0.07),
    communication: clamp01(parent.communication + centered() * 0.055),
    cumulativeCulture: clamp01(parent.cumulativeCulture * (0.72 + random() * 0.18)),
    toolComplexity: clamp01(parent.toolComplexity * (0.78 + random() * 0.16)),
    fireReliance: clamp01(parent.fireReliance * (0.82 + random() * 0.15)),
    ecologicalBreadth: clamp01(parent.ecologicalBreadth + centered() * 0.065),
    divergence: 0
  };
}

export function advanceHomininLineages(state, dtYears, random = Math.random) {
  initializeHomininLineages(state, state.seed ?? 777001);
  const dt = Math.max(0, Number(dtYears) || 0);
  if (dt <= 0) return state;
  const temperature = Number(state.temperatureAnomaly ?? -1.27);
  const productivity = positive(state.productivityIndex ?? 1, 0.001);
  const preyBiomass = positive(
    state.animalPlantMatterBiomass ?? state.herbivoreBiomass ?? state.animalBiomass ?? 1,
    0.001
  );
  const ecologicalDiversity = Math.log1p(Math.max(0, Number(state.speciesRichness) || 1));
  const climateVariability = Math.min(3, Math.abs(Number(state.greenhouseForcing) || 0) * 0.16 + Math.abs((state.iceIndex ?? 0.18) - 0.18) * 2.1);
  const living = state.homininLineages.filter((lineage) => lineage.extinctionYearBP == null);
  const children = [];

  for (const lineage of living) {
    const technology = lineage.toolComplexity;
    const thermalBuffer = 0.58 + lineage.fireReliance * 0.34 + technology * 0.22;
    const climateSuitability = Math.exp(-0.045 * (temperature + 0.7 - lineage.ecologicalBreadth * 1.4) ** 2 * (1.2 - thermalBuffer * 0.35));
    const subsistence = productivity ** (0.36 + lineage.ecologicalBreadth * 0.18)
      * preyBiomass ** (0.18 + technology * 0.16)
      * (1 + ecologicalDiversity * 0.055);
    const cooperation = 0.66 + lineage.sociality * 0.52 + lineage.communication * 0.33;
    const carryingCapacity = positive(subsistence * climateSuitability * cooperation * (0.58 + lineage.mobility * 0.38 + technology * 0.24), 1e-8);
    lineage.populationIndex = positive(relax(lineage.populationIndex, carryingCapacity, dt, 110), 1e-12);

    const effectivePopulation = lineage.populationIndex / (0.12 + lineage.populationIndex);
    const innovationOpportunity = effectivePopulation
      * (0.25 + lineage.brainIndex * 0.43 + lineage.dexterity * 0.20 + lineage.communication * 0.22)
      * (0.45 + climateVariability * 0.18 + lineage.ecologicalBreadth * 0.25);
    const innovationRate = innovationOpportunity / 18_000;
    const culturalLossRate = (1 - effectivePopulation) * (1 - lineage.sociality * 0.55) / 8_500;
    lineage.cumulativeCulture = clamp01(lineage.cumulativeCulture + dt * (innovationRate * (1 - lineage.cumulativeCulture) - culturalLossRate * lineage.cumulativeCulture));

    const toolTarget = clamp01(0.10 + lineage.cumulativeCulture * 0.64 + lineage.dexterity * 0.18 + lineage.brainIndex * 0.12);
    lineage.toolComplexity = clamp01(relax(lineage.toolComplexity, toolTarget, dt, 6_800));
    const communicationTarget = clamp01(0.12 + lineage.sociality * 0.35 + lineage.brainIndex * 0.32 + lineage.cumulativeCulture * 0.23);
    lineage.communication = clamp01(relax(lineage.communication, communicationTarget, dt, 15_000));
    const fireTarget = clamp01(lineage.toolComplexity * lineage.cumulativeCulture * (0.42 + climateVariability * 0.18));
    lineage.fireReliance = clamp01(relax(lineage.fireReliance, fireTarget, dt, 11_000));

    const brainTarget = clamp01(0.22 + lineage.sociality * 0.22 + lineage.communication * 0.20 + lineage.ecologicalBreadth * 0.12 + climateVariability * 0.045);
    lineage.brainIndex = clamp01(relax(lineage.brainIndex, brainTarget, dt, 95_000));
    lineage.sociality = clamp01(relax(lineage.sociality, 0.24 + lineage.communication * 0.42 + effectivePopulation * 0.19, dt, 72_000));
    lineage.mobility = clamp01(relax(lineage.mobility, 0.28 + climateVariability * 0.12 + lineage.ecologicalBreadth * 0.34, dt, 42_000));
    lineage.ecologicalBreadth = clamp01(relax(lineage.ecologicalBreadth, 0.25 + lineage.toolComplexity * 0.28 + lineage.mobility * 0.23, dt, 68_000));

    lineage.divergence += dt / 150_000 * (0.42 + climateVariability * 0.23 + lineage.mobility * 0.16);
    const speciationHazard = dt / 220_000
      * effectivePopulation
      * (0.25 + lineage.divergence)
      * (0.45 + climateVariability * 0.14);
    if (lineage.populationIndex > 0.06 && lineage.divergence > 0.42 && random() < speciationHazard) {
      const child = mutate(lineage, state.nextHomininLineageId++, state, random);
      lineage.populationIndex *= 0.69;
      lineage.divergence *= 0.25;
      children.push(child);
    }

    if (lineage.populationIndex < 1e-8 && (777000 - Number(lineage.birthYearBP || 777000)) > 3_000) {
      lineage.extinctionYearBP = Math.round(state.yearBP);
      lineage.populationIndex = 0;
    }
  }

  if (children.length) state.homininLineages.push(...children);
  const survivors = state.homininLineages.filter((lineage) => lineage.extinctionYearBP == null && lineage.populationIndex > 0);
  const totalPopulation = survivors.reduce((sum, lineage) => sum + lineage.populationIndex, 0);
  state.homininSpeciesRichness = survivors.length;
  state.homininPopulationIndex = totalPopulation;
  const weighted = (key) => totalPopulation > 0
    ? survivors.reduce((sum, lineage) => sum + lineage[key] * lineage.populationIndex, 0) / totalPopulation
    : 0;
  state.cognitionIndex = weighted("brainIndex");
  state.cultureIndex = weighted("cumulativeCulture");
  state.technologyIndex = weighted("toolComplexity");
  state.communicationIndex = weighted("communication");
  state.fireUseIndex = weighted("fireReliance");
  return state;
}
