import { feedingProfileForLineage } from "./EvolutionaryEcology.js";

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function primaryFeedingShares(lineage) {
  const feeding = feedingProfileForLineage(lineage);
  const total = feeding.plantMatterAffinity + feeding.livePreyAffinity;
  if (total > 1e-12) {
    return Object.freeze({
      plantShare: feeding.plantMatterAffinity / total,
      livePreyShare: feeding.livePreyAffinity / total
    });
  }
  const livePreyShare = clamp01(feeding.trophicLevel ?? 0.5);
  return Object.freeze({ plantShare: 1 - livePreyShare, livePreyShare });
}

export const ANIMAL_POPULATION_PROJECTION_POLICY = "lineage-population-feeding-projection-v1";

export function projectAnimalPopulation(state = {}) {
  const living = (state.speciesLineages ?? []).filter((lineage) =>
    lineage?.extinctionYearBP == null && Number(lineage?.populationIndex) > 0);

  let totalPopulationIndex = 0;
  let plantFeedingPopulationIndex = 0;
  let livePreyFeedingPopulationIndex = 0;
  let carrionForagingPopulationIndex = 0;

  for (const lineage of living) {
    const population = Math.max(0, Number(lineage.populationIndex) || 0);
    const feeding = feedingProfileForLineage(lineage);
    const primary = primaryFeedingShares(lineage);
    totalPopulationIndex += population;
    plantFeedingPopulationIndex += population * primary.plantShare;
    livePreyFeedingPopulationIndex += population * primary.livePreyShare;
    carrionForagingPopulationIndex += population * clamp01(feeding.carrionAffinity);
  }

  const denominator = Math.max(1e-12, totalPopulationIndex);
  return Object.freeze({
    policy: ANIMAL_POPULATION_PROJECTION_POLICY,
    authoritativeWriter: "EvolutionaryEcology.speciesLineages[].populationIndex",
    totalPopulationIndex,
    plantFeedingPopulationIndex,
    livePreyFeedingPopulationIndex,
    carrionForagingPopulationIndex,
    plantFeedingFraction: totalPopulationIndex > 0 ? plantFeedingPopulationIndex / denominator : 0,
    livePreyFeedingFraction: totalPopulationIndex > 0 ? livePreyFeedingPopulationIndex / denominator : 0,
    carrionForagingFraction: totalPopulationIndex > 0 ? carrionForagingPopulationIndex / denominator : 0,
    livingLineageCount: living.length
  });
}
