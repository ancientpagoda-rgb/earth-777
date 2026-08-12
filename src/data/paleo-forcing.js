import { CHECKPOINT_777 } from "./checkpoint-777.js";
import {
  ORBITAL_SERIES,
  PALEO_FORCING_META,
  SEA_LEVEL_SERIES
} from "./generated/paleo-forcing.generated.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeDegrees = (value) => ((value % 360) + 360) % 360;
const angularDelta = (from, to) => ((to - from + 540) % 360) - 180;

function interpolate(series, kaBP, angularColumn = -1) {
  const position = clamp(kaBP, 0, series.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  if (lower === upper) return [...series[lower]];
  return series[lower].map((value, column) => column === angularColumn
    ? normalizeDegrees(value + angularDelta(value, series[upper][column]) * fraction)
    : value + (series[upper][column] - value) * fraction);
}

const rawCheckpointOrbit = interpolate(ORBITAL_SERIES, 777, 2);
const publishedCheckpoint = CHECKPOINT_777.boundary;

// Vavrus et al. prescribe a canonical CCSM4 checkpoint that differs slightly
// from the nominal La2004 row. Preserve that experiment exactly, then apply
// La2004's observed anomalies through time. This is a transparent bias-corrected
// forcing trajectory, not a claim that the two chronologies are identical.
export const ORBITAL_ANCHOR = Object.freeze({
  eccentricityOffset: publishedCheckpoint.eccentricity.value - rawCheckpointOrbit[0],
  obliquityOffset: publishedCheckpoint.obliquity.value - rawCheckpointOrbit[1],
  precessionOffset: angularDelta(rawCheckpointOrbit[2], publishedCheckpoint.climaticPrecession.value),
  transitionYears: 2_300
});

export function paleoForcingAt(yearBP) {
  const kaBP = clamp(Number(yearBP) / 1_000, 0, 777);
  const [rawEccentricity, rawObliquity, rawPrecession] = interpolate(ORBITAL_SERIES, kaBP, 2);
  const [seaLevel, seaLevelSigma, seaLevelLower95, seaLevelUpper95] = interpolate(SEA_LEVEL_SERIES, kaBP);
  const yearsAfterCheckpoint = 777_000 - kaBP * 1_000;
  const anchorWeight = clamp(1 - yearsAfterCheckpoint / ORBITAL_ANCHOR.transitionYears, 0, 1);
  return Object.freeze({
    yearBP: kaBP * 1_000,
    eccentricity: rawEccentricity + ORBITAL_ANCHOR.eccentricityOffset * anchorWeight,
    obliquity: rawObliquity + ORBITAL_ANCHOR.obliquityOffset * anchorWeight,
    precession: normalizeDegrees(rawPrecession + ORBITAL_ANCHOR.precessionOffset * anchorWeight),
    anchorWeight,
    rawOrbit: Object.freeze({
      eccentricity: rawEccentricity,
      obliquity: rawObliquity,
      longitudePerihelion: rawPrecession
    }),
    seaLevel,
    seaLevelSigma,
    seaLevelLower95,
    seaLevelUpper95
  });
}

export { PALEO_FORCING_META };
