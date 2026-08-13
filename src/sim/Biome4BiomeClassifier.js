import { biome4CompetitionCandidateTable } from "./Biome4PftCompetition.js";

export const BIOME4_BIOME_CLASSIFIER_POLICY = "biome4-4.1-newassignbiome-independent-v1";

export const BIOME4_BIOME_NAMES = Object.freeze({
  0: "unassigned",
  1: "Tropical evergreen forest",
  2: "Tropical semi-deciduous forest",
  3: "Tropical deciduous forest/woodland",
  4: "Temperate deciduous forest",
  5: "Temperate conifer forest",
  6: "Warm mixed forest",
  7: "Cool mixed forest",
  8: "Cool conifer forest",
  9: "Cold mixed forest",
  10: "Evergreen taiga/montane forest",
  11: "Deciduous taiga/montane forest",
  12: "Tropical savanna",
  13: "Tropical xerophytic shrubland",
  14: "Temperate xerophytic shrubland",
  15: "Temperate sclerophyll woodland",
  16: "Temperate broadleaved savanna",
  17: "Open conifer woodland",
  18: "Boreal parkland",
  19: "Tropical grassland",
  20: "Temperate grassland",
  21: "Desert",
  22: "Steppe tundra",
  23: "Shrub tundra",
  24: "Dwarf shrub tundra",
  25: "Prostrate shrub tundra",
  26: "Cushion forb lichen moss tundra",
  27: "Barren",
  28: "Land ice"
});

export const BIOME4_CLASSIFIER_SOURCE_QUIRKS = Object.freeze({
  pft8LowNppOrBug: "newassignbiome tests (subpft.ne.6.or.subpft.ne.7), which is always true. Earth 777 preserves the executable behavior: low-NPP PFT 8 enters desert regardless of whether subpft is 6 or 7.",
  mixedScalarOverwrite: "competition2 computes mixed pseudo-PFT 14 scalar LAI/NPP, then overwrites scalar lai/npp from the woody dominant before calling newassignbiome. The classifier therefore receives woody-dominant NPP plus separate woody/grass LAI/NPP inputs.",
  landIceUpstream: "newassignbiome lists biome 28 but does not assign it in this routine; land ice is an upstream surface/driver state rather than a PFT-classifier outcome."
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function classify(code, rule, details = {}) {
  return Object.freeze({ code, label: BIOME4_BIOME_NAMES[code] ?? "unknown", rule, details: Object.freeze(details) });
}

export function biome4BiomeClassifierDiagnostic({ competition, candidates = [] }) {
  if (!competition || typeof competition !== "object") {
    throw new TypeError("BIOME4 biome classifier requires a competition diagnostic.");
  }
  const { table } = biome4CompetitionCandidateTable(candidates);
  const optpft = Math.trunc(finite(competition.selectedPftId));
  const woodpft = Math.trunc(finite(competition.dominantWoodyPftId));
  const grasspft = Math.trunc(finite(competition.dominantGrassPftId));
  const subpft = Math.trunc(finite(competition.subdominantWoodyPftId));
  const dom = Math.trunc(finite(competition.dominantDataPftId, optpft));
  const present = new Set(Array.isArray(competition.presentPftIds) ? competition.presentPftIds : []);
  const climate = competition.climateInputs ?? {};
  const gdd0 = finite(climate.gdd0);
  const gdd5 = finite(climate.gdd5);
  const tcm = finite(climate.tcm);
  const tmin = finite(climate.tmin);
  const optnpp = finite(table[dom]?.npp);
  const woodnpp = finite(table[woodpft]?.npp);
  const grassnpp = finite(table[grasspft]?.npp);
  const subnpp = finite(table[subpft]?.npp);
  const woodylai = finite(table[woodpft]?.lai);
  const grasslai = finite(table[grasspft]?.lai);
  const greendays = Math.max(0, Math.min(365, Math.round(finite(table[woodpft]?.greenDays))));
  const nppdif = optnpp - subnpp;
  let result = null;

  if (optpft === 0) result = classify(27, "barren optpft=0");

  if (!result && optpft === 13) result = classify(26, "PFT13 cushion-forb tundra");
  if (!result && optpft === 11) {
    if (gdd0 < 200) result = classify(25, "PFT11 prostrate shrub tundra", { gdd0 });
    else if (gdd0 < 500) result = classify(24, "PFT11 dwarf shrub tundra", { gdd0 });
    else result = classify(23, "PFT11 shrub tundra", { gdd0 });
  }
  if (!result && optpft === 12) result = classify(22, "PFT12 steppe tundra");

  if (!result && optpft === 10) {
    if (grasslai > 1) {
      result = tmin >= 0
        ? classify(13, "PFT10 warm xerophytic shrubland", { grasslai, tmin })
        : classify(14, "PFT10 temperate xerophytic shrubland", { grasslai, tmin });
    } else {
      result = classify(21, "PFT10 sparse desert", { grasslai });
    }
  }

  if (!result && optnpp <= 100) {
    if (optpft <= 5 || optpft === 9 || optpft === 10) {
      result = classify(21, "low-NPP desert", { optpft, optnpp });
    } else if (optpft === 8) {
      // Preserve source executable bug: (subpft.ne.6.or.subpft.ne.7) is always true.
      result = classify(21, "low-NPP PFT8 desert via source OR-condition", { subpft, optnpp });
    }
  }

  if (!result && optpft === 6) {
    if (gdd5 > 900 && tcm > -19) {
      result = present.has(4)
        ? classify(7, "warm PFT6 with PFT4 present", { gdd5, tcm })
        : classify(8, "warm PFT6 without PFT4", { gdd5, tcm });
    } else {
      result = present.has(4)
        ? classify(9, "cold PFT6 with PFT4 present", { gdd5, tcm })
        : classify(10, "cold PFT6 without PFT4", { gdd5, tcm });
    }
  }

  if (!result && optpft === 7) {
    if (subpft === 4) result = classify(4, "PFT7 with PFT4 subdominant");
    else if (subpft === 5) result = classify(9, "PFT7 with PFT5 subdominant");
    else if (gdd5 > 900 && tcm > -19) result = classify(9, "warm PFT7 cold mixed", { gdd5, tcm });
    else result = classify(11, "cold PFT7 deciduous taiga", { gdd5, tcm });
  }

  if (!result && optpft === 8) {
    result = gdd0 >= 800
      ? classify(20, "PFT8 temperate grassland", { gdd0 })
      : classify(22, "PFT8 steppe tundra", { gdd0 });
  }

  if (!result && optpft === 3) result = classify(6, "PFT3 warm mixed forest");

  if (!result && optpft === 4) {
    if (present.has(6)) {
      result = tcm < -15
        ? classify(9, "PFT4 plus PFT6 cold mixed", { tcm })
        : classify(7, "PFT4 plus PFT6 cool mixed", { tcm });
    } else if (present.has(3) || (present.has(5) && gdd5 > 3000 && tcm > 3)) {
      result = classify(6, "PFT4 warm mixed overlap", { gdd5, tcm });
    } else {
      result = classify(4, "PFT4 temperate deciduous forest");
    }
  }

  if (!result && optpft === 5) {
    if (present.has(3)) result = classify(6, "PFT5 with PFT3 present");
    else if (subpft === 4 && nppdif < 50) result = classify(5, "PFT5 near PFT4 NPP", { nppdif });
    else if (subpft === 7) result = classify(9, "PFT5 with PFT7 subdominant");
    else result = classify(5, "PFT5 temperate conifer forest");
  }

  if (!result && optpft === 14) {
    if (woodpft <= 2) {
      result = woodylai > 4
        ? classify(12, "mixed tropical savanna", { woodpft, woodylai })
        : classify(13, "mixed tropical xerophytic shrubland", { woodpft, woodylai });
    } else if (woodpft === 3) result = classify(15, "mixed temperate sclerophyll woodland");
    else if (woodpft === 4) result = classify(16, "mixed temperate broadleaved savanna");
    else if (woodpft === 5) result = classify(17, "mixed open conifer woodland");
    else if (woodpft === 6 || woodpft === 7) result = classify(18, "mixed boreal parkland");
  }

  if (!result && (optpft <= 2 || optpft === 9)) {
    if (optpft === 1) result = classify(1, "PFT1 tropical evergreen forest");
    else if (optpft === 2) {
      if (greendays > 300) result = classify(1, "PFT2 evergreen-duration tropical forest", { greendays });
      else if (greendays > 250) result = classify(2, "PFT2 semi-deciduous tropical forest", { greendays });
      else result = classify(3, "PFT2 deciduous tropical forest/woodland", { greendays });
    } else if (optpft === 9) result = classify(19, "PFT9 tropical grassland");
  }

  if (!result) result = classify(0, "source fallthrough unassigned", { optpft });

  return Object.freeze({
    policy: BIOME4_BIOME_CLASSIFIER_POLICY,
    biomeCode: result.code,
    biomeLabel: result.label,
    rule: result.rule,
    ruleDetails: result.details,
    sourceInputs: Object.freeze({
      optpft,
      woodpft,
      grasspft,
      subpft,
      dom,
      optnpp,
      woodnpp,
      grassnpp,
      subnpp,
      woodylai,
      grasslai,
      greendays,
      gdd0,
      gdd5,
      tcm,
      tmin,
      presentPftIds: Object.freeze([...present].sort((a, b) => a - b))
    }),
    sourceQuirks: BIOME4_CLASSIFIER_SOURCE_QUIRKS,
    appliedToVegetation: false,
    checkpointCategoryMutationEnabled: false,
    epistemicStatus: "independent reproduction of BIOME4 4.1 newassignbiome from the audited executable rule order. The predicted biome is diagnostic only until it is validated against the published 777 ka BIOME4 checkpoint; Earth 777 does not yet replace the published category."
  });
}
