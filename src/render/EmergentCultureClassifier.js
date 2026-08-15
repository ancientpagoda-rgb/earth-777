export const EMERGENT_CULTURE_CLASSIFIER_POLICY = "observer-labels-no-causal-feedback-v1";

export function classifyEmergentCulture(telemetry = {}) {
  const observations = [];
  const castleLikeCount = Math.max(0, Math.round(Number(telemetry.highDefensePersistentSiteCount) || 0));
  const pirateLikeActive = Math.max(0, Math.round(Number(telemetry.waterborneSeizureEdgeCount) || 0));

  if (castleLikeCount > 0) {
    observations.push(Object.freeze({
      id: "castle-like",
      label: castleLikeCount === 1 ? "castle-like fortified complex" : `${castleLikeCount.toLocaleString()} castle-like fortified complexes`,
      count: castleLikeCount,
      basis: "observer label: persistent high-investment defensive sites with substantial built environment and co-resident population"
    }));
  }
  if (pirateLikeActive > 0) {
    observations.push(Object.freeze({
      id: "pirate-like",
      label: pirateLikeActive === 1 ? "pirate-like maritime raiding" : `pirate-like maritime raiding on ${pirateLikeActive.toLocaleString()} routes`,
      count: pirateLikeActive,
      basis: "observer label: waterborne interaction edges currently transferring seized stored resources"
    }));
  }

  return Object.freeze({
    policy: EMERGENT_CULTURE_CLASSIFIER_POLICY,
    observations: Object.freeze(observations),
    epistemicStatus: "presentation-only interpretation; labels never feed back into simulation state or mechanics"
  });
}
