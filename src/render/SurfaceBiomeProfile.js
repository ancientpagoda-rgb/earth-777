import { homininPopulationAt } from "../sim/HomininDemography.js";
import { homininSocialAt } from "../sim/HomininSocialOrganization.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

const BIOMES = Object.freeze({
  tropicalForest: Object.freeze({ groundColor: [0.20, 0.31, 0.16], tree: 1.0, grass: 0.38, shrub: 0.45, rock: 0.18 }),
  woodland: Object.freeze({ groundColor: [0.27, 0.36, 0.19], tree: 0.70, grass: 0.62, shrub: 0.52, rock: 0.26 }),
  grassland: Object.freeze({ groundColor: [0.36, 0.39, 0.19], tree: 0.12, grass: 1.0, shrub: 0.34, rock: 0.22 }),
  desert: Object.freeze({ groundColor: [0.48, 0.39, 0.22], tree: 0.02, grass: 0.10, shrub: 0.12, rock: 0.52 }),
  tundra: Object.freeze({ groundColor: [0.35, 0.38, 0.29], tree: 0.05, grass: 0.46, shrub: 0.18, rock: 0.48 }),
  ice: Object.freeze({ groundColor: [0.65, 0.69, 0.66], tree: 0, grass: 0.02, shrub: 0, rock: 0.30 })
});

function familyForCode(code) {
  if (code >= 1 && code <= 3) return BIOMES.tropicalForest;
  if (code >= 4 && code <= 11) return BIOMES.woodland;
  if (code >= 12 && code <= 20) return BIOMES.grassland;
  if (code === 21) return BIOMES.desert;
  if (code >= 22 && code <= 27) return BIOMES.tundra;
  if (code === 28) return BIOMES.ice;
  return BIOMES.grassland;
}

export function surfaceBiomeProfile(vegetationSample = null, state = {}, latitude = 0, longitude = 0) {
  const family = familyForCode(vegetationSample?.biomeCode);
  const npp = clamp(Math.log1p(Math.max(0, vegetationSample?.npp ?? 0)) / Math.log1p(2214), 0, 1);
  const lai = clamp((vegetationSample?.lai ?? 0) / 7.12, 0, 1);
  const productivity = clamp((state.productivityIndex ?? 1) / 1.45, 0.25, 1);
  const vigor = clamp(npp * 0.62 + lai * 0.28 + productivity * 0.10, 0.08, 1);
  const localHominins = homininPopulationAt(state, latitude, longitude, 100);
  const localSocial = homininSocialAt(state, latitude, longitude, 100);
  const localDensity = Math.max(0, Number(localHominins?.densityPersonsPerKm2) || 0);
  const homininDensity = localDensity > 0 ? localDensity / (localDensity + 0.018) : 0;
  return Object.freeze({
    groundColor: family.groundColor,
    grassDensity: clamp(family.grass * (0.48 + vigor * 0.72), 0, 1.15),
    treeDensity: clamp(family.tree * (0.38 + vigor * 0.82), 0, 1.15),
    shrubDensity: clamp(family.shrub * (0.45 + vigor * 0.72), 0, 1.15),
    rockDensity: family.rock,
    herbivoreDensity: clamp((state.herbivoreBiomass ?? 1) / 1.6 * (0.35 + vigor * 0.65), 0.08, 1),
    homininDensity: clamp(homininDensity, 0, 1),
    homininPersonsWithin100Km: localHominins?.estimatedPersonsWithinRadius ?? 0,
    nearestHomininDemeDistanceKm: localHominins?.nearestDemeDistanceKm ?? null,
    homininSocialSiteId: localSocial?.nearestSiteId ?? null,
    homininSocialSiteDistanceKm: localSocial?.nearestSiteDistanceKm ?? null,
    homininSocialSiteOffsetEastKm: localSocial?.siteOffsetEastKm ?? null,
    homininSocialSiteOffsetNorthKm: localSocial?.siteOffsetNorthKm ?? null,
    homininSocialSitePopulationPersons: localSocial?.sitePopulationPersons ?? 0,
    homininSocialSiteHouseholds: localSocial?.householdCount ?? 0,
    homininSettlementPersistence: localSocial?.settlementPersistence ?? 0,
    homininSettlementLabel: localSocial?.settlementLabel ?? null,
    homininBuiltEnvironmentIndex: localSocial?.builtEnvironmentIndex ?? 0,
    homininStoredFoodPersonDays: localSocial?.storedFoodPersonDays ?? 0,
    homininExchangeDegree: localSocial?.exchangeDegree ?? 0,
    homininResidentialMovesPerYear: localSocial?.residentialMovesPerYear ?? 0,
    vigor,
    biomeCode: vegetationSample?.biomeCode ?? null,
    biomeLabel: vegetationSample?.biomeLabel ?? null
  });
}
