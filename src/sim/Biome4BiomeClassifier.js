import { biome4CompetitionCandidateTable } from "./Biome4PftCompetition.js";

// Independent, rule-level reproduction of BIOME4 4.1's `newassignbiome`
// decision order. It consumes the competition diagnostic; it never writes
// hydrology, productivity, or the published checkpoint category.
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
  pft8LowNppOrBug: "The source PFT8 low-NPP condition uses an OR between not-PFT6 and not-PFT7; it is therefore always true and is preserved here.",
  mixedScalarOverwrite: "competition2 passes woody-dominant scalar NPP for pseudo-PFT 14 while retaining woody/grass LAI inputs.",
  landIceUpstream: "BIOME4 lists land ice but newassignbiome never assigns it; Earth 777 retains land ice as an upstream surface state."
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const classify = (biomeCode, rule, ruleDetails = {}) => Object.freeze({
  biomeCode,
  biomeLabel: BIOME4_BIOME_NAMES[biomeCode] ?? "unknown",
  rule,
  ruleDetails: Object.freeze(ruleDetails)
});

export function biome4BiomeClassifierDiagnostic({ competition, candidates = [] } = {}) {
  if (!competition || typeof competition !== "object") throw new TypeError("BIOME4 biome classifier requires a competition diagnostic.");
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
  if (!result && optpft === 11) result = gdd0 < 200
    ? classify(25, "PFT11 prostrate shrub tundra", { gdd0 })
    : gdd0 < 500 ? classify(24, "PFT11 dwarf shrub tundra", { gdd0 }) : classify(23, "PFT11 shrub tundra", { gdd0 });
  if (!result && optpft === 12) result = classify(22, "PFT12 steppe tundra");
  if (!result && optpft === 10) result = grasslai > 1
    ? classify(tmin >= 0 ? 13 : 14, "PFT10 xerophytic shrubland", { grasslai, tmin })
    : classify(21, "PFT10 sparse desert", { grasslai });
  if (!result && optnpp <= 100 && (optpft <= 5 || optpft === 9 || optpft === 10 || optpft === 8)) {
    result = classify(21, optpft === 8 ? "low-NPP PFT8 desert via source OR-condition" : "low-NPP desert", { optpft, optnpp, subpft });
  }
  if (!result && optpft === 6) result = gdd5 > 900 && tcm > -19
    ? classify(present.has(4) ? 7 : 8, "warm PFT6 boreal split", { gdd5, tcm })
    : classify(present.has(4) ? 9 : 10, "cold PFT6 boreal split", { gdd5, tcm });
  if (!result && optpft === 7) result = subpft === 4 ? classify(4, "PFT7 with PFT4 subdominant")
    : subpft === 5 || (gdd5 > 900 && tcm > -19) ? classify(9, "PFT7 cold mixed split", { subpft, gdd5, tcm })
      : classify(11, "PFT7 deciduous taiga", { gdd5, tcm });
  if (!result && optpft === 8) result = classify(gdd0 >= 800 ? 20 : 22, "PFT8 grassland/tundra split", { gdd0 });
  if (!result && optpft === 3) result = classify(6, "PFT3 warm mixed forest");
  if (!result && optpft === 4) result = present.has(6)
    ? classify(tcm < -15 ? 9 : 7, "PFT4 PFT6 mixed-forest split", { tcm })
    : present.has(3) || (present.has(5) && gdd5 > 3000 && tcm > 3)
      ? classify(6, "PFT4 warm mixed overlap", { gdd5, tcm }) : classify(4, "PFT4 temperate deciduous forest");
  if (!result && optpft === 5) result = present.has(3) ? classify(6, "PFT5 with PFT3 present")
    : subpft === 4 && nppdif < 50 ? classify(5, "PFT5 near PFT4 NPP", { nppdif })
      : subpft === 7 ? classify(9, "PFT5 with PFT7 subdominant") : classify(5, "PFT5 temperate conifer forest");
  if (!result && optpft === 14) result = woodpft <= 2 ? classify(woodylai > 4 ? 12 : 13, "mixed tropical split", { woodpft, woodylai })
    : woodpft === 3 ? classify(15, "mixed temperate sclerophyll woodland") : woodpft === 4 ? classify(16, "mixed temperate broadleaved savanna")
      : woodpft === 5 ? classify(17, "mixed open conifer woodland") : (woodpft === 6 || woodpft === 7) ? classify(18, "mixed boreal parkland") : null;
  if (!result && (optpft <= 2 || optpft === 9)) result = optpft === 1 ? classify(1, "PFT1 tropical evergreen forest")
    : optpft === 2 ? classify(greendays > 300 ? 1 : greendays > 250 ? 2 : 3, "PFT2 green-days tropical split", { greendays })
      : classify(19, "PFT9 tropical grassland");
  if (!result) result = classify(0, "source fallthrough unassigned", { optpft });

  return Object.freeze({
    policy: BIOME4_BIOME_CLASSIFIER_POLICY,
    ...result,
    sourceInputs: Object.freeze({ optpft, woodpft, grasspft, subpft, dom, optnpp, woodnpp, grassnpp, subnpp, woodylai, grasslai, greendays, gdd0, gdd5, tcm, tmin, presentPftIds: Object.freeze([...present].sort((a, b) => a - b)) }),
    sourceQuirks: BIOME4_CLASSIFIER_SOURCE_QUIRKS,
    appliedToVegetation: false,
    checkpointCategoryMutationEnabled: false,
    epistemicStatus: "Independent rule-level reproduction of BIOME4 4.1 newassignbiome, verified against the checksum-pinned upstream package. It is diagnostic at the 777 ka checkpoint and only supplies the model-derived destination of a later lagged branch succession."
  });
}
