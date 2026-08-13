const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 6) => Number(value.toFixed(digits));

export const BIOME4_PFT_COMPETITION_POLICY = "biome4-4.1-competition2-preclassifier-independent-v1";
export const BIOME4_MIXED_PFT_ID = 14;
export const BIOME4_GRASS_PFT_IDS = Object.freeze([8, 9, 11, 12]);

export const BIOME4_COMPETITION_SOURCE_QUIRKS = Object.freeze({
  pft10WoodyBucket: "Although PFT 10 is numerically >=8, BIOME4 competition2 explicitly sets grass(10)=false, so it competes in the non-grass/woody bucket and has separate late fallback rules.",
  pft12ForcedPresent: "competition2 sets present(12)=true after deriving presence from NPP, allowing PFT 12 to be selected by the PFT11 dry-switch even when its optimized NPP is zero.",
  subdominantRange: "The source searches subdominant woody PFTs only over IDs 1-7; PFT 10 can be the initial dominant but never the subdominant fallback.",
  maxLaiTieBug: "On a woody LAI tie, competition2 assigns maxlai=optlai(pftmaxnpp) and pftmaxlai=pftmaxnpp rather than the current tied PFT. pftmaxlai is not used by the subsequent selection logic; Earth 777 records but does not operationalize this dead-end quirk.",
  mixedOutputOverwrite: "For pseudo-PFT 14 the source computes 1:2 woody/grass mixed LAI and NPP, then later resets scalar lai/npp from dom=wdom before calling the biome classifier. Earth 777 exposes both the computed mixture and the source-operational dominant-data PFT instead of hiding the overwrite."
});

function blankPft(id) {
  return {
    pftId: id,
    npp: 0,
    lai: 0,
    fireDays: 0,
    greenDays: 0,
    meanTopWetnessPercent: 0,
    driestTopWetnessPercent: 0,
    presentFromNpp: false,
    optimized: false,
    sourceCandidate: null
  };
}

function greenDaysFromOptimization(optimization) {
  const evaluation = optimization?.optimumEvaluation;
  if (!evaluation) return 0;
  return Number(evaluation?.hydrology?.greenDays ?? evaluation?.c3?.hydrology?.greenDays ?? 0) || 0;
}

function normalizeCandidate(candidate) {
  const id = Math.trunc(Number(candidate?.pftId));
  if (!(id >= 1 && id <= 13)) throw new RangeError(`BIOME4 competition candidate requires PFT 1-13; got ${candidate?.pftId}.`);
  const optimization = candidate?.laiNppOptimization ?? null;
  const npp = Math.max(0, Number(optimization?.optimumNpp) || 0);
  const lai = Math.max(0, Number(optimization?.optimumLai) || 0);
  const fireDryness = candidate?.fireDryness ?? optimization?.fireDryness ?? null;
  return {
    pftId: id,
    npp,
    lai,
    fireDays: Math.max(0, Number(fireDryness?.fire?.scaledPotentialFireDays) || 0),
    greenDays: Math.max(0, Math.min(365, Math.round(greenDaysFromOptimization(optimization)))),
    meanTopWetnessPercent: clamp(fireDryness?.dryness?.meanTopLayerWetnessPercent, 0, 100),
    driestTopWetnessPercent: clamp(fireDryness?.dryness?.driestTopLayerWetnessPercent, 0, 100),
    presentFromNpp: npp > 0,
    optimized: Boolean(optimization),
    sourceCandidate: candidate
  };
}

export function biome4CompetitionCandidateTable(candidates = []) {
  if (!Array.isArray(candidates)) throw new TypeError("BIOME4 competition requires a candidate array.");
  const table = Array.from({ length: 14 }, (_, id) => id === 0 ? null : blankPft(id));
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    table[normalized.pftId] = normalized;
  }
  const present = Array(14).fill(false);
  for (let id = 1; id <= 13; id += 1) present[id] = table[id].npp > 0;
  present[12] = true; // exact competition2 override
  return Object.freeze({
    table: Object.freeze(table.map((entry) => entry ? Object.freeze(entry) : null)),
    present: Object.freeze(present),
    grassPftIds: BIOME4_GRASS_PFT_IDS
  });
}

function pushTrace(trace, rule, before, after, details = {}) {
  trace.push(Object.freeze({ rule, before, after, ...details }));
}

function highestStrict(table, ids, key) {
  let bestId = 0;
  let bestValue = 0;
  for (const id of ids) {
    const value = Number(table[id]?.[key]) || 0;
    if (value > bestValue) {
      bestValue = value;
      bestId = id;
    }
  }
  return { id: bestId, value: bestValue };
}

function secondWoody(table, dominantId) {
  let id = 0;
  let npp = 0;
  for (let pft = 1; pft <= 7; pft += 1) {
    if (pft === dominantId) continue;
    if (table[pft].npp > npp) {
      npp = table[pft].npp;
      id = pft;
    }
  }
  return { id, npp };
}

function annualPrecipitation(input) {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) throw new TypeError("BIOME4 competition requires finite nonnegative annual precipitation.");
  return value;
}

export function biome4PftCompetitionDiagnostic({
  candidates,
  climateIndices,
  annualPrecipitationMm
}) {
  const normalized = biome4CompetitionCandidateTable(candidates);
  const table = normalized.table;
  const present = normalized.present;
  const indices = climateIndices ?? {};
  const tmin = Number(indices.absoluteMinimumCelsius);
  const tcm = Number(indices.coldestMonthCelsius);
  const gdd5 = Number(indices.gdd5);
  const gdd0 = Number(indices.gdd0);
  if (![tmin, tcm, gdd5, gdd0].every(Number.isFinite)) {
    throw new TypeError("BIOME4 competition requires finite tmin, coldest-month, GDD5 and GDD0 climate indices.");
  }
  const tprec = annualPrecipitation(annualPrecipitationMm);
  const grass = new Set(BIOME4_GRASS_PFT_IDS);
  const woodyIds = Array.from({ length: 12 }, (_, index) => index + 1).filter((id) => !grass.has(id));
  const grassIds = Array.from({ length: 12 }, (_, index) => index + 1).filter((id) => grass.has(id));
  const dominantWoodyInitial = highestStrict(table, woodyIds, "npp");
  const dominantGrass = highestStrict(table, grassIds, "npp");
  const maxWoodyLai = highestStrict(table, woodyIds, "lai");
  const initialSubdominant = secondWoody(table, dominantWoodyInitial.id);

  let wdom = dominantWoodyInitial.id;
  let grasspft = dominantGrass.id;
  let subpft = initialSubdominant.id;
  let optpft = wdom;
  let flop = false;
  const trace = [];
  let passes = 0;

  while (passes < 12) {
    passes += 1;
    const woody = table[wdom] ?? blankPft(0);
    const grassCandidate = table[grasspft] ?? blankPft(0);
    const firedays = wdom !== 0 ? woody.fireDays : 0;
    const greenDays = wdom !== 0 ? woody.greenDays : 0;
    const woodyLai = woody.lai;
    const nppDifference = woody.npp - grassCandidate.npp;
    let restarted = false;

    if ((wdom === 3 || wdom === 5) && tmin > 0 && gdd5 > 5000) {
      const before = wdom;
      wdom = 2;
      pushTrace(trace, "warm-gdd tropical replacement", before, wdom, { tmin, gdd5 });
      restarted = true;
    } else if (wdom === 1 && woody.npp < 2000) {
      const before = wdom;
      wdom = 2;
      subpft = 1;
      pushTrace(trace, "PFT1 low-NPP replacement", before, wdom, { npp: woody.npp, subpft });
      restarted = true;
    }
    if (restarted) continue;

    if (wdom === 2) {
      if (woodyLai < 2) optpft = grasspft;
      else if (grasspft === 9 && woodyLai < 3.6) optpft = BIOME4_MIXED_PFT_ID;
      else if (greenDays < 270 && tcm > 21 && tprec < 1700) optpft = BIOME4_MIXED_PFT_ID;
      else optpft = wdom;
      pushTrace(trace, "PFT2 competition", wdom, optpft, { woodyLai, grasspft, greenDays, tcm, tprec });
    }

    if (wdom === 3) {
      if (woody.npp < 140) optpft = grasspft;
      else if (woodyLai < 1) optpft = grasspft;
      else if (woodyLai < 2) optpft = BIOME4_MIXED_PFT_ID;
      else optpft = wdom;
      pushTrace(trace, "PFT3 competition", wdom, optpft, { npp: woody.npp, woodyLai });
    }

    if (wdom === 4) {
      if (woodyLai < 2) {
        optpft = grasspft;
      } else if (firedays > 210 && nppDifference < 0) {
        if (!flop && subpft !== 0) {
          const before = wdom;
          wdom = subpft;
          subpft = 4;
          flop = true;
          pushTrace(trace, "PFT4 extreme-fire subdominant swap", before, wdom, { firedays, nppDifference, subpft });
          continue;
        } else {
          optpft = grasspft;
        }
      } else if (woodyLai < 3 || firedays > 180) {
        if (nppDifference < 0) optpft = BIOME4_MIXED_PFT_ID;
        else if (!flop && subpft !== 0) {
          const before = wdom;
          wdom = subpft;
          subpft = 4;
          flop = true;
          pushTrace(trace, "PFT4 fire/LAI subdominant swap", before, wdom, { firedays, nppDifference, woodyLai, subpft });
          continue;
        }
      } else {
        optpft = wdom;
      }
      pushTrace(trace, "PFT4 competition", wdom, optpft, { woodyLai, firedays, nppDifference, flop });
    }

    if (wdom === 5) {
      if (present[3]) {
        const before = wdom;
        wdom = 3;
        subpft = 5;
        pushTrace(trace, "PFT5 yields to present PFT3", before, wdom, { subpft });
        continue;
      } else if (woody.npp < 140) optpft = grasspft;
      else if (woodyLai < 1.2) optpft = BIOME4_MIXED_PFT_ID;
      else optpft = wdom;
      pushTrace(trace, "PFT5 competition", wdom, optpft, { npp: woody.npp, woodyLai, pft3Present: present[3] });
    }

    if (wdom === 6) {
      if (woody.npp < 140) {
        optpft = grasspft;
      } else if (firedays > 90) {
        if (!flop && subpft !== 0) {
          const before = wdom;
          wdom = subpft;
          subpft = 6;
          flop = true;
          pushTrace(trace, "PFT6 fire subdominant swap", before, wdom, { firedays, subpft });
          continue;
        }
      } else {
        optpft = wdom;
      }
      pushTrace(trace, "PFT6 competition", wdom, optpft, { npp: woody.npp, firedays, flop });
    }

    if (wdom === 7) {
      if (woody.npp < 120) optpft = grasspft;
      else if (woody.meanTopWetnessPercent < 30 && nppDifference < 0) optpft = grasspft;
      else optpft = wdom;
      pushTrace(trace, "PFT7 competition", wdom, optpft, { npp: woody.npp, meanTopWetnessPercent: woody.meanTopWetnessPercent, nppDifference });
    }

    if (wdom === 0) {
      if (grasspft !== 0) optpft = grasspft;
      else if (table[13].npp !== 0) optpft = 13;
      else optpft = 0;
      pushTrace(trace, "no-woody fallback", 0, optpft, { grasspft, pft13Npp: table[13].npp });
    }

    break;
  }

  if (passes >= 12) throw new Error("BIOME4 competition diagnostic exceeded restart guard; source-style goto cycle did not converge.");

  if (optpft === 0 && present[10]) {
    pushTrace(trace, "PFT10 empty-selection fallback", optpft, 10);
    optpft = 10;
  }
  if (optpft === 10) {
    if (grasspft !== 9 && (table[grasspft]?.npp ?? 0) > table[10].npp) {
      const before = optpft;
      optpft = grasspft;
      pushTrace(trace, "PFT10 loses to non-PFT9 grass NPP", before, optpft, { grassNpp: table[grasspft]?.npp ?? 0, pft10Npp: table[10].npp });
    }
  }
  if (optpft === grasspft && grasspft !== 0) {
    if (table[grasspft].lai < 1.8 && present[10]) {
      const before = optpft;
      optpft = 10;
      pushTrace(trace, "sparse-grass PFT10 replacement", before, optpft, { grassLai: table[grasspft].lai });
    }
  }
  if (optpft === 11) {
    if (table[11].meanTopWetnessPercent <= 25 && present[12]) {
      const before = optpft;
      optpft = 12;
      pushTrace(trace, "dry PFT11 to forced-present PFT12", before, optpft, { meanTopWetnessPercent: table[11].meanTopWetnessPercent });
    }
  }

  const finalWoody = table[wdom] ?? blankPft(0);
  const finalGrass = table[grasspft] ?? blankPft(0);
  const subdominant = table[subpft] ?? blankPft(0);
  let mixture = null;
  let dominantDataPftId = optpft;
  if (optpft === BIOME4_MIXED_PFT_ID) {
    const ratio = finalGrass.npp > 0 ? finalWoody.npp / finalGrass.npp : Number.POSITIVE_INFINITY;
    const treeFraction = clamp((8 / 5) * ratio - 0.54, 0, 1);
    const grassFraction = 1 - treeFraction;
    mixture = Object.freeze({
      pseudoPftId: BIOME4_MIXED_PFT_ID,
      woodyPftId: wdom,
      grassPftId: grasspft,
      treeFraction: round(treeFraction),
      grassFraction: round(grassFraction),
      computedMixedLai: round((finalWoody.lai + 2 * finalGrass.lai) / 3),
      computedMixedNpp: round((finalWoody.npp + 2 * finalGrass.npp) / 3),
      sourceOperationalScalarOverwrite: "competition2 subsequently resets scalar lai/npp from dom=wdom before newassignbiome"
    });
    dominantDataPftId = wdom;
  }

  if ((table[dominantDataPftId]?.lai ?? 0) === 0 && dominantDataPftId !== 0) {
    const before = optpft;
    optpft = 0;
    pushTrace(trace, "zero-dominant-LAI nullification", before, optpft, { dominantDataPftId });
  }

  return Object.freeze({
    policy: BIOME4_PFT_COMPETITION_POLICY,
    selectedPftId: optpft,
    sourceOptPftId: optpft,
    dominantWoodyPftId: wdom,
    dominantGrassPftId: grasspft,
    subdominantWoodyPftId: subpft,
    dominantDataPftId,
    initialDominantWoodyPftId: dominantWoodyInitial.id,
    initialDominantGrassPftId: dominantGrass.id,
    maxWoodyLaiPftId: maxWoodyLai.id,
    dominantWoodyNpp: round(finalWoody.npp),
    dominantWoodyLai: round(finalWoody.lai),
    dominantGrassNpp: round(finalGrass.npp),
    dominantGrassLai: round(finalGrass.lai),
    subdominantWoodyNpp: round(subdominant.npp),
    nppDifferenceWoodyMinusGrass: round(finalWoody.npp - finalGrass.npp),
    mixture,
    presentPftIds: Object.freeze(present.map((value, id) => value ? id : null).filter((id) => id != null && id !== 0)),
    climateInputs: Object.freeze({ tmin, tcm, gdd5, gdd0, annualPrecipitationMm: tprec }),
    trace: Object.freeze(trace),
    classifierInvoked: false,
    appliedToVegetation: false,
    categoricalBiomeTransitionsEnabled: false,
    sourceQuirks: BIOME4_COMPETITION_SOURCE_QUIRKS,
    epistemicStatus: "independent reproduction of BIOME4 4.1 competition2 through the point immediately before newassignbiome. It ranks optimized PFT candidates and may report source pseudo-PFT 14, but Earth 777 does not yet apply the selected PFT to vegetation state or call the empirical biome classifier."
  });
}
