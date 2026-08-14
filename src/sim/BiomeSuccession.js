const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export const BIOME_SUCCESSION_POLICY = "pft-competition-succession-v1";

function broadBiomeForSelection(selectedPftId, competition, climateIndices, annualPrecipitationMm) {
  const lai = Number(competition?.dominantWoodyLai) || 0;
  const precipitation = Number(annualPrecipitationMm) || 0;
  const warmest = Number(climateIndices?.warmestMonthCelsius) || 0;
  switch (selectedPftId) {
    case 0: return "barren / sparsely vegetated";
    case 2: return lai >= 3.2 ? "tropical seasonal forest" : "tropical woodland / savanna";
    case 3: return lai >= 2.5 ? "warm-temperate evergreen forest" : "warm-temperate woodland";
    case 4: return lai >= 2.5 ? "temperate summergreen forest" : "temperate open woodland";
    case 5: return lai >= 2.2 ? "cool conifer forest" : "cool conifer woodland";
    case 6: return "boreal evergreen forest";
    case 7: return "boreal deciduous woodland";
    case 8: return precipitation < 420 ? "temperate dry grassland" : "temperate grassland";
    case 9: return warmest > 22 ? "warm savanna / grassland" : "warm-temperate grassland";
    case 10: return "woody desert / semi-desert";
    case 11: return "shrub tundra";
    case 12: return "cold herbaceous tundra";
    case 13: return "lichen / forb tundra";
    case 14: return warmest > 18 ? "mixed woodland–savanna" : "mixed woodland–grassland";
    default: return "competitive vegetation mosaic";
  }
}

export function deriveCompetitiveBiomeSuccession({
  elapsedYears = 0,
  checkpointBiomeLabel = "checkpoint vegetation",
  competition = null,
  climateIndices = null,
  annualPrecipitationMm = 0,
  transitionPressure = 0
} = {}) {
  if (!competition || !Number.isFinite(Number(competition.selectedPftId))) {
    return Object.freeze({
      policy: BIOME_SUCCESSION_POLICY,
      status: "unresolved",
      progress: 0,
      biomeLabel: checkpointBiomeLabel,
      selectedPftId: null
    });
  }
  const selectedPftId = Number(competition.selectedPftId);
  const candidateBiomeLabel = broadBiomeForSelection(selectedPftId, competition, climateIndices, annualPrecipitationMm);
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
    candidateBiomeLabel,
    biomeLabel,
    progress,
    transitionPressure: pressure,
    successionTimeScaleYears: tauYears,
    competitionPolicy: competition.policy,
    epistemicStatus: "competitive PFT outcome is converted into a lagged broad biome state; this enables branch succession without claiming the full historical BIOME4 newassignbiome classifier"
  });
}
