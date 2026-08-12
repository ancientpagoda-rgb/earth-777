const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback = 1) => Math.max(1e-9, finite(value, fallback));

export function consequenceWeightedScore(target = {}) {
  const causalInfluence = Math.max(0, finite(target.causalInfluence));
  const sensitivity = Math.max(0, finite(target.sensitivity));
  const uncertainty = Math.max(0, finite(target.uncertainty));
  const systemsAffected = Math.max(0, finite(target.systemsAffected));
  const relevance = Math.max(0, finite(target.relevance));
  const computeCost = positive(target.computeCost);

  return (
    causalInfluence *
    sensitivity *
    uncertainty *
    Math.max(1, systemsAffected) *
    relevance
  ) / computeCost;
}

export function rankFidelityTargets(targets = []) {
  const scored = targets.map((target) => ({
    ...target,
    score: consequenceWeightedScore(target)
  }));
  scored.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  const totalScore = scored.reduce((sum, target) => sum + target.score, 0);

  return Object.freeze(scored.map((target, index) => Object.freeze({
    ...target,
    rank: index + 1,
    scoreShare: totalScore > 0 ? target.score / totalScore : 0
  })));
}

export function allocateFidelityBudget(targets = [], { budget = 1 } = {}) {
  const ranked = rankFidelityTargets(targets);
  const boundedBudget = Math.max(0, finite(budget, 1));
  return Object.freeze(ranked.map((target) => Object.freeze({
    ...target,
    allocation: target.scoreShare * boundedBudget,
    tier: target.rank <= Math.max(1, Math.ceil(ranked.length * 0.2))
      ? "high"
      : target.rank <= Math.max(2, Math.ceil(ranked.length * 0.55))
        ? "medium"
        : "background"
  })));
}
