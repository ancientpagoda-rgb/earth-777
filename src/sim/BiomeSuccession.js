const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export const BIOME_SUCCESSION_POLICY = "biome4-classifier-succession-v2";

export function deriveCompetitiveBiomeSuccession({
  elapsedYears = 0,
  checkpointBiomeLabel = "checkpoint vegetation",
  competition = null,
  classifier = null,
  transitionPressure = 0
} = {}) {
  if (!competition || !Number.isFinite(Number(competition.selectedPftId)) || !classifier || !Number.isInteger(Number(classifier.biomeCode))) {
    return Object.freeze({
      policy: BIOME_SUCCESSION_POLICY,
      status: "unresolved",
      progress: 0,
      biomeLabel: checkpointBiomeLabel,
      selectedPftId: null
    });
  }
  const selectedPftId = Number(competition.selectedPftId);
  const candidateBiomeCode = Number(classifier.biomeCode);
  const candidateBiomeLabel = classifier.biomeLabel;
  const pressure = clamp01(transitionPressure);
  const tauYears = 180 + (1 - pressure) * 1_420;
  const progress = clamp01(1 - Math.exp(-Math.max(0, Number(elapsedYears) || 0) / tauYears));
  const biomeLabel = progress < 0.18
    ? checkpointBiomeLabel
    : progress < 0.72
      ? `${checkpointBiomeLabel} → ${candidateBiomeLabel}`
      : candidateBiomeLabel;
  return Object.freeze({
    policy: BIOME_SUCCESSION_POLICY,
    status: "resolved",
    selectedPftId,
    candidateBiomeCode,
    candidateBiomeLabel,
    biomeLabel,
    progress,
    transitionPressure: pressure,
    successionTimeScaleYears: tauYears,
    competitionPolicy: competition.policy,
    classifierPolicy: classifier.policy,
    epistemicStatus: "The source-grounded BIOME4 classifier supplies a model-derived branch destination; a lagged succession state prevents an instantaneous categorical replacement of the published checkpoint."
  });
}
