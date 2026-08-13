const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 6) => Number(value.toFixed(digits));

export const BIOME4_FIRE_DRYNESS_POLICY = "biome4-4.1-fire-dryness-independent-v1";
export const BIOME4_FIRE_WETNESS_THRESHOLDS = Object.freeze([
  0.25, 0.20, 0.40, 0.33, 0.40, 0.33, 0.33, 0.40, 0.40, 0.33, 0.33, 0.33, 0.33
]);

export const BIOME4_FIRE_SOURCE_QUIRKS = Object.freeze({
  transitionDiscontinuity: "BIOME4 uses exp(-(wet-threshold)) inside the threshold-to-threshold+0.05 transition, but switches abruptly to zero only when wet is strictly greater than threshold+0.05. Earth 777 reproduces that operational discontinuity.",
  burnMetricUnusedByClassifier: "The source computes litter and a burnfraction-like litter-loss metric, but competition reads only firedays. Earth 777 exposes the metric for provenance and does not treat it as an occupancy input.",
  nppScalingOrder: "BIOME4 computes raw fire fraction and the litter burn metric before scaling firedays linearly by NPP below 1000. Earth 777 preserves that order."
});

function requirePftId(pftId) {
  const id = Math.trunc(Number(pftId));
  if (!(id >= 1 && id <= 13)) throw new RangeError(`BIOME4 fire diagnostic requires PFT 1-13; got ${pftId}.`);
  return id;
}

function requireDailyWetness(values) {
  if (!Array.isArray(values) || values.length !== 365) {
    throw new TypeError("BIOME4 fire diagnostic requires 365 daily root-zone wetness values.");
  }
  const wetness = values.map(Number);
  if (wetness.some((value) => !Number.isFinite(value))) {
    throw new TypeError("BIOME4 fire diagnostic requires finite daily root-zone wetness values.");
  }
  return wetness;
}

function requireMonthlyLayerWetness(values) {
  if (!Array.isArray(values) || values.length !== 12) {
    throw new TypeError("BIOME4 dryness diagnostic requires 12 monthly [root, top, bottom] wetness records.");
  }
  const normalized = values.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 3) throw new TypeError("Each monthly wetness record must contain root, top and bottom wetness.");
    const row = entry.slice(0, 3).map(Number);
    if (row.some((value) => !Number.isFinite(value))) throw new TypeError("Monthly wetness records must be finite.");
    return row;
  });
  return normalized;
}

export function biome4FireBurnWeight(rootZoneWetness, pftId) {
  const id = requirePftId(pftId);
  const wet = Number(rootZoneWetness);
  if (!Number.isFinite(wet)) throw new TypeError("BIOME4 fire burn weight requires finite root-zone wetness.");
  const threshold = BIOME4_FIRE_WETNESS_THRESHOLDS[id - 1];
  if (wet < threshold) return 1;
  if (wet > threshold + 0.05) return 0;
  return 1 / Math.exp(wet - threshold);
}

export function biome4DrynessDiagnostic(monthlyMeanRootWetness) {
  const monthly = requireMonthlyLayerWetness(monthlyMeanRootWetness);
  let driestMonthIndex = 0;
  let driestTopWetness = Number.POSITIVE_INFINITY;
  let wettestTopWetness = Number.NEGATIVE_INFINITY;
  let meanRoot = 0;
  let meanTop = 0;
  let meanBottom = 0;
  for (let month = 0; month < 12; month += 1) {
    const [root, top, bottom] = monthly[month];
    meanRoot += root / 12;
    meanTop += top / 12;
    meanBottom += bottom / 12;
    if (top < driestTopWetness) {
      driestTopWetness = top;
      driestMonthIndex = month;
    }
    if (top > wettestTopWetness) wettestTopWetness = top;
  }
  return Object.freeze({
    driestMonthIndex,
    driestMonthNumber: driestMonthIndex + 1,
    meanRootZoneWetness: round(meanRoot),
    meanTopLayerWetness: round(meanTop),
    meanBottomLayerWetness: round(meanBottom),
    meanTopLayerWetnessPercent: round(meanTop * 100, 4),
    meanBottomLayerWetnessPercent: round(meanBottom * 100, 4),
    driestTopLayerWetness: round(driestTopWetness),
    driestTopLayerWetnessPercent: round(driestTopWetness * 100, 4),
    wettestTopLayerWetness: round(wettestTopWetness),
    wettestTopLayerWetnessPercent: round(wettestTopWetness * 100, 4),
    sourceCompetitionSemantics: "BIOME4 competition averages optdata monthly top-layer wetness for annual wetness, and identifies the driest month from that same top-layer series."
  });
}

export function biome4FireDiagnostic({
  pftId,
  lai,
  npp,
  dailyRootZoneWetness
}) {
  const id = requirePftId(pftId);
  const wetness = requireDailyWetness(dailyRootZoneWetness);
  const leafArea = Math.max(0, Number(lai) || 0);
  const annualNpp = Number(npp);
  if (!Number.isFinite(annualNpp)) throw new TypeError("BIOME4 fire diagnostic requires finite annual NPP.");
  const threshold = BIOME4_FIRE_WETNESS_THRESHOLDS[id - 1];

  if (annualNpp <= 0) {
    return Object.freeze({
      policy: BIOME4_FIRE_DRYNESS_POLICY,
      pftId: id,
      threshold,
      rawPotentialFireDays: 0,
      scaledPotentialFireDays: 0,
      fireFractionBeforeNppScaling: 0,
      nppFireScalingFactor: 0,
      minimumRootZoneWetness: round(Math.min(...wetness)),
      maximumRootZoneWetness: round(Math.max(...wetness)),
      fullyDryDays: 0,
      transitionDays: 0,
      fullyWetDays: 365,
      litterMetric: 0,
      sourceBurnMetric: 0,
      sourceQuirks: BIOME4_FIRE_SOURCE_QUIRKS,
      epistemicStatus: "BIOME4 growth returns before calling fire when operational NPP is non-positive; Earth 777 therefore reports zero competition-relevant fire days for a non-viable candidate."
    });
  }

  let rawFireDays = 0;
  let fullyDryDays = 0;
  let transitionDays = 0;
  let fullyWetDays = 0;
  const dailyBurnWeight = [];
  let minimumWetness = Number.POSITIVE_INFINITY;
  let maximumWetness = Number.NEGATIVE_INFINITY;
  for (let day = 0; day < 365; day += 1) {
    const wet = wetness[day];
    const weight = biome4FireBurnWeight(wet, id);
    dailyBurnWeight.push(round(weight));
    rawFireDays += weight;
    minimumWetness = Math.min(minimumWetness, wet);
    maximumWetness = Math.max(maximumWetness, wet);
    if (wet < threshold) fullyDryDays += 1;
    else if (wet > threshold + 0.05) fullyWetDays += 1;
    else transitionDays += 1;
  }

  const fireFraction = rawFireDays / 365;
  const litter = (leafArea / 5) * annualNpp;
  const sourceBurnMetric = litter * (1 - Math.exp(-0.2 * fireFraction ** 1.5) ** 1.5);
  const nppScalingFactor = annualNpp < 1000 ? annualNpp / 1000 : 1;
  const scaledFireDays = rawFireDays * nppScalingFactor;

  return Object.freeze({
    policy: BIOME4_FIRE_DRYNESS_POLICY,
    pftId: id,
    threshold,
    rawPotentialFireDays: round(rawFireDays),
    scaledPotentialFireDays: round(scaledFireDays),
    fireFractionBeforeNppScaling: round(fireFraction),
    nppFireScalingFactor: round(nppScalingFactor),
    minimumRootZoneWetness: round(minimumWetness),
    maximumRootZoneWetness: round(maximumWetness),
    fullyDryDays,
    transitionDays,
    fullyWetDays,
    litterMetric: round(litter),
    sourceBurnMetric: round(sourceBurnMetric),
    dailyBurnWeight: Object.freeze(dailyBurnWeight),
    sourceQuirks: BIOME4_FIRE_SOURCE_QUIRKS,
    epistemicStatus: "independent reproduction of BIOME4 4.1 potential-fire-days diagnostic from the candidate PFT's daily root-zone wetness, optimized LAI and operational NPP. Fire days remain a competition diagnostic only; no burning event, carbon loss, occupancy decision or biome transition is enacted."
  });
}

export function biome4FireDrynessDiagnostic({
  pftId,
  lai,
  npp,
  hydrology
}) {
  if (!hydrology?.daily || hydrology.daily.length !== 365 || !hydrology?.monthlyMeanRootWetness) {
    throw new TypeError("BIOME4 fire/dryness diagnostic requires the optimized candidate's 365-day hydrology and monthly wetness summaries.");
  }
  const dailyRootZoneWetness = hydrology.daily.map((day) => Number(day.rootZoneWetness));
  return Object.freeze({
    policy: BIOME4_FIRE_DRYNESS_POLICY,
    fire: biome4FireDiagnostic({ pftId, lai, npp, dailyRootZoneWetness }),
    dryness: biome4DrynessDiagnostic(hydrology.monthlyMeanRootWetness),
    occupancyFeedbackEnabled: false,
    categoricalBiomeTransitionsEnabled: false,
    epistemicStatus: "source-operational BIOME4 4.1 fire and top-layer dryness diagnostics attached to one optimized parallel PFT candidate; values are exposed for the forthcoming competition stage and do not yet select vegetation occupancy."
  });
}
