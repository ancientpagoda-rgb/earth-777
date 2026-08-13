import { biome4BiomeClassifierDiagnostic } from "./Biome4BiomeClassifier.js";
import { biome4PftCompetitionDiagnostic } from "./Biome4PftCompetition.js";

export const BIOME4_CHECKPOINT_VALIDATION_POLICY = "biome4-777ka-validation-v1";

function annualPrecipitation(monthly) {
  if (!Array.isArray(monthly) || monthly.length !== 12) return null;
  const values = monthly.map(Number);
  if (!values.every(Number.isFinite)) return null;
  return values.reduce((sum, value) => sum + value / 12, 0);
}

export function validateBiome4CheckpointCell({ annualVegetation, pftDiagnostics, monthlyPrecipitationMmPerYear }) {
  const precipitation = annualPrecipitation(monthlyPrecipitationMmPerYear);
  if (!annualVegetation?.pftClimateIndices || pftDiagnostics?.status !== "resolved" || precipitation == null) {
    return Object.freeze({ policy: BIOME4_CHECKPOINT_VALIDATION_POLICY, status: "unresolved", appliedToVegetation: false });
  }
  const competition = biome4PftCompetitionDiagnostic({
    candidates: pftDiagnostics.candidates,
    climateIndices: annualVegetation.pftClimateIndices,
    annualPrecipitationMm: precipitation
  });
  const classifier = biome4BiomeClassifierDiagnostic({ competition, candidates: pftDiagnostics.candidates });
  const publishedBiomeCode = Number(annualVegetation.biomeCode);
  return Object.freeze({
    policy: BIOME4_CHECKPOINT_VALIDATION_POLICY,
    status: "resolved",
    publishedBiomeCode,
    publishedBiomeLabel: annualVegetation.biomeLabel,
    predictedBiomeCode: classifier.biomeCode,
    predictedBiomeLabel: classifier.biomeLabel,
    checkpointMatch: classifier.biomeCode === publishedBiomeCode,
    competition,
    classifier,
    appliedToVegetation: false,
    checkpointCategoryMutationEnabled: false
  });
}
