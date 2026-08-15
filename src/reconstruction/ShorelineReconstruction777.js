import { CHECKPOINT_777 } from "../data/checkpoint-777.js";

const SEA_LEVEL_MEAN_METERS = -12.76;
const SEA_LEVEL_SIGMA_METERS = 9.52;
const SEA_LEVEL_LOWER95_METERS = -33.06;
const SEA_LEVEL_UPPER95_METERS = 4.17;

export const SHORELINE_777_POLICY = "spratt-lisiecki-global-sea-level-confidence-v1";
export const SHORELINE_777_SOURCE = Object.freeze({
  sourceId: "spratt-lisiecki-2016",
  datasetId: "pangaea-979830-v2",
  doi: "10.1594/PANGAEA.979830",
  publicationDoi: "10.5194/cp-12-1079-2016",
  ageKaBP: 777,
  meanMetersVsModern: SEA_LEVEL_MEAN_METERS,
  sigmaMeters: SEA_LEVEL_SIGMA_METERS,
  lower95MetersVsModern: SEA_LEVEL_LOWER95_METERS,
  upper95MetersVsModern: SEA_LEVEL_UPPER95_METERS
});

// Fast normal CDF approximation (Abramowitz-Stegun style). The probability is
// epistemic: it describes uncertainty in the global sea-level datum, not daily
// tidal variability and not local GIA/vertical-land-motion uncertainty.
function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

export function shoreline777Sample(elevationMeters, {
  seaLevelMeanMeters = SEA_LEVEL_MEAN_METERS,
  seaLevelSigmaMeters = SEA_LEVEL_SIGMA_METERS,
  lower95Meters = SEA_LEVEL_LOWER95_METERS,
  upper95Meters = SEA_LEVEL_UPPER95_METERS
} = {}) {
  const elevation = Number(elevationMeters);
  if (!Number.isFinite(elevation)) throw new TypeError("Shoreline reconstruction requires a finite elevation.");
  const mean = Number(seaLevelMeanMeters);
  const sigma = Math.max(1e-6, Number(seaLevelSigmaMeters));
  const landProbability = normalCdf((elevation - mean) / sigma);
  const medianLand = elevation > mean;
  let confidenceClass = "uncertain-shoreline";
  if (elevation > Number(upper95Meters)) confidenceClass = "robust-land";
  else if (elevation < Number(lower95Meters)) confidenceClass = "robust-ocean";
  return Object.freeze({
    policy: SHORELINE_777_POLICY,
    source: SHORELINE_777_SOURCE,
    elevationMeters: elevation,
    seaLevelMeanMeters: mean,
    seaLevelSigmaMeters: sigma,
    seaLevelLower95Meters: Number(lower95Meters),
    seaLevelUpper95Meters: Number(upper95Meters),
    medianLand,
    medianOcean: !medianLand,
    landProbability,
    oceanProbability: 1 - landProbability,
    confidenceClass,
    distanceFromMedianShorelineMeters: elevation - mean,
    epistemicStatus: "Global eustatic shoreline confidence from the Spratt-Lisiecki 777 ka sea-level stack. Local GIA, tectonic vertical motion, tides, waves and unresolved terrain-hindcast uncertainty are additional terms and are not folded into this probability yet."
  });
}

export function shoreline777CheckpointConsistency() {
  const datum = CHECKPOINT_777.boundary.seaLevelAnomaly;
  return Object.freeze({
    meanMatchesCheckpoint: Math.abs(Number(datum.value) - SEA_LEVEL_MEAN_METERS) < 1e-9,
    sigmaMatchesCheckpoint: Math.abs(Number(datum.uncertainty) - SEA_LEVEL_SIGMA_METERS) < 1e-9,
    checkpointMeanMeters: Number(datum.value),
    checkpointSigmaMeters: Number(datum.uncertainty)
  });
}
