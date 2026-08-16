export const BIOME4_CHECKPOINT_VALIDATION_POLICY = "biome4-777ka-classifier-validation-v2";

function validBiomeCode(value) {
  const code = Number(value);
  return Number.isInteger(code) && code >= 0 && code <= 28 ? code : null;
}

// Validation reads the published category and the already-derived classifier
// output. It intentionally does not rerun, tune, or alter either system.
export function validateBiome4CheckpointCell({ annualVegetation, pftDiagnostics } = {}) {
  const publishedBiomeCode = validBiomeCode(annualVegetation?.biomeCode);
  const classifier = pftDiagnostics?.classifier ?? null;
  const predictedBiomeCode = validBiomeCode(classifier?.biomeCode);
  if (publishedBiomeCode == null || predictedBiomeCode == null || pftDiagnostics?.status !== "resolved") {
    return Object.freeze({
      policy: BIOME4_CHECKPOINT_VALIDATION_POLICY,
      status: "unresolved",
      appliedToVegetation: false,
      calibrationFeedbackEnabled: false,
      epistemicStatus: "Validation requires both a published checkpoint category and an independently resolved classifier output; missing values remain unresolved."
    });
  }
  return Object.freeze({
    policy: BIOME4_CHECKPOINT_VALIDATION_POLICY,
    status: "resolved",
    publishedBiomeCode,
    publishedBiomeLabel: annualVegetation.biomeLabel ?? null,
    predictedBiomeCode,
    predictedBiomeLabel: classifier.biomeLabel ?? null,
    checkpointMatch: publishedBiomeCode === predictedBiomeCode,
    classifierPolicy: classifier.policy ?? null,
    appliedToVegetation: false,
    calibrationFeedbackEnabled: false,
    epistemicStatus: "Published BIOME4 checkpoint output is compared with the independent PFT pipeline for diagnosis only. A mismatch is retained as evidence of model/input divergence and does not steer simulation state."
  });
}

export function summarizeBiome4CheckpointValidation(results = []) {
  if (!Array.isArray(results)) throw new TypeError("BIOME4 checkpoint validation summary requires an array.");
  const resolved = results.filter((result) => result?.status === "resolved");
  const matches = resolved.filter((result) => result.checkpointMatch).length;
  const mismatches = resolved.length - matches;
  const confusionCounts = new Map();
  for (const result of resolved) {
    const key = `${result.publishedBiomeCode}:${result.predictedBiomeCode}`;
    confusionCounts.set(key, (confusionCounts.get(key) ?? 0) + 1);
  }
  const confusion = [...confusionCounts.entries()]
    .map(([key, count]) => {
      const [publishedBiomeCode, predictedBiomeCode] = key.split(":").map(Number);
      return Object.freeze({ publishedBiomeCode, predictedBiomeCode, count });
    })
    .sort((a, b) => a.publishedBiomeCode - b.publishedBiomeCode || a.predictedBiomeCode - b.predictedBiomeCode);
  return Object.freeze({
    policy: BIOME4_CHECKPOINT_VALIDATION_POLICY,
    probes: results.length,
    resolvedProbes: resolved.length,
    unresolvedProbes: results.length - resolved.length,
    matches,
    mismatches,
    matchFraction: resolved.length ? matches / resolved.length : null,
    confusion: Object.freeze(confusion),
    calibrationFeedbackEnabled: false,
    epistemicStatus: "A validation summary retains category-level agreement and disagreement without becoming a fitted correction or an authoritative vegetation state."
  });
}
