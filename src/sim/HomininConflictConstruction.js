const CONFLICT_INTERVAL_YEARS = 250;
const CONTACT_BIN_DEGREES = 10;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const relax = (current, target, dtYears, tauYears) => current + (target - current) * (1 - Math.exp(-Math.max(0, dtYears) / Math.max(1e-6, tauYears)));

export const HOMININ_CONFLICT_CONSTRUCTION_POLICY = "resource-competition-seizure-defensive-investment-v1";

function wrapLongitude(value) {
  return ((Number(value) + 540) % 360) - 180;
}

function distanceKm(latA, lonA, latB, lonB) {
  const r = Math.PI / 180;
  const phi1 = Number(latA) * r;
  const phi2 = Number(latB) * r;
  const dPhi = (Number(latB) - Number(latA)) * r;
  const dLambda = wrapLongitude(Number(lonB) - Number(lonA)) * r;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function pairKey(a, b) {
  return String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`;
}

function spatialKey(latitude, longitude) {
  const latCell = Math.floor((clamp(latitude, -89.999, 89.999) + 90) / CONTACT_BIN_DEGREES);
  const lonCell = Math.floor((wrapLongitude(longitude) + 180) / CONTACT_BIN_DEGREES);
  return `${latCell}:${lonCell}`;
}

function siteSignals(state, site, deme, lineage) {
  const population = Math.max(1, Number(site.sitePopulationPersons) || 1);
  const reserveDaysPerPerson = Math.max(0, Number(site.storedFoodPersonDays) || 0) / population;
  const storedValue = clamp(Math.log1p(reserveDaysPerPerson) / Math.log1p(365), 0, 1.4);
  const reliability = clamp(site.resourceReliability ?? deme.resourceReliability ?? 0.5, 0, 1);
  const concentration = clamp(site.resourceConcentration ?? deme.resourceConcentration ?? 0.4, 0, 1);
  const persistence = clamp(site.persistence ?? deme.settlementPersistence ?? 0, 0, 1);
  const lineagePopulation = Math.max(1, Number(lineage.populationPersons) || Number(deme.headcount) || 1);
  const lineageCapacity = Math.max(1, Number(lineage.carryingCapacityPersons) || lineagePopulation);
  const populationPressure = clamp(lineagePopulation / lineageCapacity, 0.2, 2.5);
  const scarcity = 1 - reliability;
  const territoriality = clamp(
    persistence
      * (0.22 + concentration * 0.50 + storedValue * 0.28)
      * (0.72 + clamp(populationPressure - 0.6, 0, 1.9) * 0.22),
    0,
    1.5
  );
  return { population, reserveDaysPerPerson, storedValue, reliability, concentration, persistence, populationPressure, scarcity, territoriality };
}

function buildContactPairs(state) {
  const sites = (state.homininSites ?? []).filter((site) => site.active && site.sitePopulationPersons > 0);
  const demes = new Map((state.homininDemes ?? []).map((deme) => [deme.id, deme]));
  const waterByPair = new Map();
  for (const route of state.homininWaterRoutes ?? []) waterByPair.set(pairKey(route.aSiteId, route.bSiteId), route);
  const exchangeByDemePair = new Map();
  for (const edge of state.homininExchangeEdges ?? []) exchangeByDemePair.set(pairKey(edge.aDemeId, edge.bDemeId), edge);

  const bins = new Map();
  for (const site of sites) {
    const key = spatialKey(site.latitude, site.longitude);
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(site);
  }

  const latCells = Math.ceil(180 / CONTACT_BIN_DEGREES);
  const lonCells = Math.ceil(360 / CONTACT_BIN_DEGREES);
  const pairs = new Map();
  for (const a of sites) {
    const demeA = demes.get(a.occupantDemeId);
    const contactRange = 260 + clamp(demeA?.mobility ?? 0.5, 0, 1) * 640 + clamp(demeA?.exchangeReachKm ?? 0, 0, 1800) * 0.18;
    const latCell = Math.floor((clamp(a.latitude, -89.999, 89.999) + 90) / CONTACT_BIN_DEGREES);
    const lonCell = Math.floor((wrapLongitude(a.longitude) + 180) / CONTACT_BIN_DEGREES);
    const cellRadius = Math.max(1, Math.ceil(contactRange / (111 * CONTACT_BIN_DEGREES)) + 1);
    for (let dLat = -cellRadius; dLat <= cellRadius; dLat += 1) {
      const neighborLat = latCell + dLat;
      if (neighborLat < 0 || neighborLat >= latCells) continue;
      for (let dLon = -cellRadius; dLon <= cellRadius; dLon += 1) {
        const neighborLon = ((lonCell + dLon) % lonCells + lonCells) % lonCells;
        for (const b of bins.get(`${neighborLat}:${neighborLon}`) ?? []) {
          if (a.id === b.id) continue;
          const key = pairKey(a.id, b.id);
          if (pairs.has(key)) continue;
          const demeB = demes.get(b.occupantDemeId);
          const rangeB = 260 + clamp(demeB?.mobility ?? 0.5, 0, 1) * 640 + clamp(demeB?.exchangeReachKm ?? 0, 0, 1800) * 0.18;
          const distance = distanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
          const overlandReach = Math.sqrt(contactRange * rangeB);
          const waterRoute = waterByPair.get(key) ?? null;
          if (distance > overlandReach && !waterRoute) continue;
          const exchange = exchangeByDemePair.get(pairKey(a.occupantDemeId, b.occupantDemeId)) ?? null;
          pairs.set(key, {
            key,
            a,
            b,
            distanceKm: distance,
            overlandContact: distance <= overlandReach,
            waterRoute,
            exchange
          });
        }
      }
    }
  }

  for (const route of state.homininWaterRoutes ?? []) {
    const key = pairKey(route.aSiteId, route.bSiteId);
    if (pairs.has(key)) continue;
    const a = sites.find((site) => site.id === route.aSiteId);
    const b = sites.find((site) => site.id === route.bSiteId);
    if (!a || !b) continue;
    const exchange = exchangeByDemePair.get(pairKey(a.occupantDemeId, b.occupantDemeId)) ?? null;
    pairs.set(key, { key, a, b, distanceKm: route.distanceKm, overlandContact: false, waterRoute: route, exchange });
  }
  return [...pairs.values()];
}

function projectionCapacity(site, deme, lineage, medium) {
  const population = Math.max(1, Number(deme.headcount) || Number(site.sitePopulationPersons) || 1);
  const tools = clamp(lineage.toolComplexity ?? 0, 0, 1);
  const sociality = clamp(lineage.sociality ?? 0, 0, 1);
  const communication = clamp(lineage.communication ?? 0, 0, 1);
  const mobility = clamp(lineage.mobility ?? 0, 0, 1);
  const organization = 0.40 + tools * 0.22 + sociality * 0.20 + communication * 0.18;
  const mobilityProjection = 0.42 + mobility * 0.58;
  const mediumFactor = medium === "water"
    ? 0.08 + clamp(site.waterTransportIndex ?? 0, 0, 1) * 0.55 + clamp(site.navigationIndex ?? 0, 0, 1) * 0.37
    : 1;
  return Math.sqrt(population) * organization * mobilityProjection * mediumFactor;
}

function defenseCapacity(site, lineage) {
  const population = Math.max(1, Number(site.sitePopulationPersons) || 1);
  const tools = clamp(lineage.toolComplexity ?? 0, 0, 1);
  const sociality = clamp(lineage.sociality ?? 0, 0, 1);
  const terrain = clamp(site.defensibility ?? 0, 0, 1);
  const works = clamp(site.defensiveWorksIndex ?? 0, 0, 1);
  return Math.sqrt(population)
    * (0.44 + tools * 0.22 + sociality * 0.14 + terrain * 0.30 + works * 0.58);
}

function interactionUpdate(state, elapsedYears) {
  const demes = new Map((state.homininDemes ?? []).map((deme) => [deme.id, deme]));
  const lineages = new Map((state.homininLineages ?? []).map((lineage) => [lineage.id, lineage]));
  const previous = new Map((state.homininConflictEdges ?? []).map((edge) => [edge.key, edge]));
  const threat = new Map();
  const edges = [];
  const reserveBefore = (state.homininSites ?? []).reduce((sum, site) => sum + Math.max(0, Number(site.storedFoodPersonDays) || 0), 0);

  for (const pair of buildContactPairs(state)) {
    const { a, b } = pair;
    const demeA = demes.get(a.occupantDemeId);
    const demeB = demes.get(b.occupantDemeId);
    const lineageA = lineages.get(a.lineageId);
    const lineageB = lineages.get(b.lineageId);
    if (!demeA || !demeB || !lineageA || !lineageB) continue;
    const signalA = siteSignals(state, a, demeA, lineageA);
    const signalB = siteSignals(state, b, demeB, lineageB);
    const scarcity = (signalA.scarcity + signalB.scarcity) / 2;
    const concentration = (signalA.concentration + signalB.concentration) / 2;
    const pressure = (signalA.populationPressure + signalB.populationPressure) / 2;
    const storedOpportunity = (signalA.storedValue + signalB.storedValue) / 2;
    const territoriality = (signalA.territoriality + signalB.territoriality) / 2;
    const sameLineage = a.lineageId === b.lineageId ? 1 : 0;
    const communication = (clamp(lineageA.communication ?? 0, 0, 1) + clamp(lineageB.communication ?? 0, 0, 1)) / 2;
    const sociality = (clamp(lineageA.sociality ?? 0, 0, 1) + clamp(lineageB.sociality ?? 0, 0, 1)) / 2;
    const exchangeInterdependence = clamp(Number(pair.exchange?.interactionWeight) || 0, 0, 1.5);
    const distanceContact = pair.overlandContact
      ? Math.exp(-pair.distanceKm / 620)
      : clamp(Number(pair.waterRoute?.viability) || 0, 0, 1);
    const competition = clamp(
      scarcity * (0.36 + concentration * 0.52)
        + clamp(pressure - 0.72, 0, 1.8) * 0.22
        + territoriality * 0.24,
      0,
      1.7
    );
    const hostilityTarget = clamp(
      competition * 0.55
        + storedOpportunity * territoriality * 0.25
        + distanceContact * 0.08
        - exchangeInterdependence * 0.22
        - communication * 0.08
        - sociality * 0.05
        - sameLineage * 0.08,
      0,
      1
    );
    const previousEdge = previous.get(pair.key);
    const hostility = clamp(relax(previousEdge?.hostility ?? 0, hostilityTarget, elapsedYears, 650), 0, 1);
    const waterViability = clamp(Number(pair.waterRoute?.viability) || 0, 0, 1);
    const waterProjection = pair.waterRoute
      ? Math.sqrt(clamp(a.waterTransportIndex ?? 0, 0, 1) * clamp(b.waterTransportIndex ?? 0, 0, 1)) * waterViability
      : 0;
    const medium = waterProjection > 0.16 && (!pair.overlandContact || waterProjection > 0.45) ? "water" : "land";
    const contactIntensity = medium === "water" ? waterProjection : distanceContact;
    const intensity = clamp(hostility * contactIntensity, 0, 1);

    const projectionA = projectionCapacity(a, demeA, lineageA, medium);
    const projectionB = projectionCapacity(b, demeB, lineageB, medium);
    const defenseA = defenseCapacity(a, lineageA);
    const defenseB = defenseCapacity(b, lineageB);
    const successA = projectionA / Math.max(1e-6, defenseB);
    const successB = projectionB / Math.max(1e-6, defenseA);
    let winner = null;
    let loser = null;
    let advantage = 1;
    if (successA > successB * 1.06) { winner = a; loser = b; advantage = successA / Math.max(1e-6, successB); }
    else if (successB > successA * 1.06) { winner = b; loser = a; advantage = successB / Math.max(1e-6, successA); }

    let transferredPersonDays = 0;
    if (winner && loser && intensity > 0.08) {
      const loserReserve = Math.max(0, Number(loser.storedFoodPersonDays) || 0);
      const intervalFactor = 1 - Math.exp(-Math.min(elapsedYears, 250) / 250);
      const seizureFraction = clamp(
        (advantage - 1) * 0.045 * intensity * intervalFactor,
        0,
        0.075
      );
      transferredPersonDays = Math.min(loserReserve, loserReserve * seizureFraction);
      loser.storedFoodPersonDays = loserReserve - transferredPersonDays;
      winner.storedFoodPersonDays = Math.max(0, Number(winner.storedFoodPersonDays) || 0) + transferredPersonDays;
    }

    const threatA = intensity * (projectionB / Math.max(1e-6, defenseA));
    const threatB = intensity * (projectionA / Math.max(1e-6, defenseB));
    threat.set(a.id, (threat.get(a.id) || 0) + threatA);
    threat.set(b.id, (threat.get(b.id) || 0) + threatB);
    edges.push({
      key: pair.key,
      aSiteId: a.id,
      bSiteId: b.id,
      aDemeId: a.occupantDemeId,
      bDemeId: b.occupantDemeId,
      distanceKm: pair.distanceKm,
      medium,
      hostility,
      conflictIntensity: intensity,
      competitionPressure: competition,
      exchangeInterdependence,
      resourceTransferPersonDays: transferredPersonDays,
      resourceTransferPersonDaysPerYear: elapsedYears > 0 ? transferredPersonDays / elapsedYears : 0,
      winnerSiteId: winner?.id ?? null,
      loserSiteId: loser?.id ?? null
    });
  }

  state.homininConflictEdges = edges;
  const reserveAfter = (state.homininSites ?? []).reduce((sum, site) => sum + Math.max(0, Number(site.storedFoodPersonDays) || 0), 0);
  state.homininConflictResourceTransferClosureErrorPersonDays = reserveAfter - reserveBefore;
  return threat;
}

function updateDefensiveConstruction(state, elapsedYears, threat) {
  const lineages = new Map((state.homininLineages ?? []).map((lineage) => [lineage.id, lineage]));
  const demes = new Map((state.homininDemes ?? []).map((deme) => [deme.id, deme]));
  for (const site of state.homininSites ?? []) {
    if (!site.active || !(site.sitePopulationPersons > 0)) continue;
    const lineage = lineages.get(site.lineageId);
    const deme = demes.get(site.occupantDemeId);
    if (!lineage || !deme) continue;
    const signal = siteSignals(state, site, deme, lineage);
    const tools = clamp(lineage.toolComplexity ?? 0, 0, 1);
    const culture = clamp(lineage.cumulativeCulture ?? 0, 0, 1);
    const communication = clamp(lineage.communication ?? 0, 0, 1);
    const dexterity = clamp(lineage.dexterity ?? 0.5, 0, 1);
    const constructionSkill = clamp(tools * 0.38 + culture * 0.26 + communication * 0.12 + dexterity * 0.24, 0, 1);
    const materialAvailability = clamp(
      0.24 + clamp(site.ruggedness ?? 0, 0, 1) * 0.30 + signal.reliability * 0.30 + clamp(site.builtEnvironmentIndex ?? 0, 0, 1) * 0.16,
      0.12,
      1
    );
    const reserveBuffer = clamp(signal.reserveDaysPerPerson / 90, 0, 1.5);
    const laborCapacity = site.sitePopulationPersons
      * 365
      * (0.025 + constructionSkill * 0.13)
      * (0.55 + reserveBuffer * 0.45);
    const threatIndex = clamp(threat.get(site.id) || 0, 0, 2);
    const defenseTarget = clamp(
      threatIndex
        * signal.territoriality
        * (0.30 + constructionSkill * 0.70)
        * (0.42 + materialAvailability * 0.58),
      0,
      1
    );
    site.threatIndex = threatIndex;
    site.territorialityIndex = clamp(signal.territoriality, 0, 1);
    site.constructionSkillIndex = constructionSkill;
    site.constructionMaterialAvailabilityIndex = materialAvailability;
    site.defensiveConstructionLaborDaysPerYear = laborCapacity * defenseTarget * 0.28;
    site.defensiveWorksIndex = clamp(relax(site.defensiveWorksIndex ?? 0, defenseTarget, elapsedYears, 720), 0, 1);
    site.defensiveBarrierEquivalentMeters = site.defensiveWorksIndex
      * (0.6 + constructionSkill * 5.4 + materialAvailability * 2.2);
    site.controlRadiusKm = signal.territoriality
      * (4 + site.sitePopulationPersons ** 0.35 * 5 + communication * 45);
    deme.threatIndex = site.threatIndex;
    deme.territorialityIndex = site.territorialityIndex;
    deme.defensiveWorksIndex = site.defensiveWorksIndex;
  }
}

function summarize(state) {
  const sites = (state.homininSites ?? []).filter((site) => site.active && site.sitePopulationPersons > 0);
  const edges = state.homininConflictEdges ?? [];
  state.homininConflictEdgeCount = edges.filter((edge) => edge.conflictIntensity > 0.02).length;
  state.homininResourceSeizurePersonDaysPerYear = edges.reduce((sum, edge) => sum + Math.max(0, Number(edge.resourceTransferPersonDaysPerYear) || 0), 0);
  const totalConflict = edges.reduce((sum, edge) => sum + Math.max(0, Number(edge.conflictIntensity) || 0), 0);
  const waterConflict = edges.reduce((sum, edge) => sum + (edge.medium === "water" ? Math.max(0, Number(edge.conflictIntensity) || 0) : 0), 0);
  state.homininWaterborneConflictShare = totalConflict > 0 ? waterConflict / totalConflict : 0;
  state.homininDefensiveSiteCount = sites.filter((site) => Number(site.defensiveWorksIndex) > 0.12).length;
  state.homininHighDefenseSiteCount = sites.filter((site) => Number(site.defensiveWorksIndex) > 0.55).length;
  state.homininMaxDefensiveWorksIndex = sites.reduce((largest, site) => Math.max(largest, Number(site.defensiveWorksIndex) || 0), 0);
  state.homininMeanThreatIndex = sites.length
    ? sites.reduce((sum, site) => sum + Math.max(0, Number(site.threatIndex) || 0), 0) / sites.length
    : 0;
  state.homininConflictConstructionPolicy = HOMININ_CONFLICT_CONSTRUCTION_POLICY;
}

function conflictUpdate(state, elapsedYears) {
  const threat = interactionUpdate(state, elapsedYears);
  updateDefensiveConstruction(state, elapsedYears, threat);
  summarize(state);
}

export function initializeHomininConflictConstruction(state) {
  state.homininConflictEdges ??= [];
  state.homininConflictAccumulatorYears ??= 0;
  const initialized = state.homininConflictConstructionPolicy === HOMININ_CONFLICT_CONSTRUCTION_POLICY;
  if (!initialized && (state.homininSites ?? []).length) conflictUpdate(state, 0);
  else summarize(state);
  return state;
}

export function advanceHomininConflictConstruction(state, dtYears) {
  if (state.homininConflictConstructionPolicy !== HOMININ_CONFLICT_CONSTRUCTION_POLICY) initializeHomininConflictConstruction(state);
  const dt = Math.max(0, Number(dtYears) || 0);
  if (dt <= 0) return state;
  state.homininConflictAccumulatorYears += dt;
  if (state.homininConflictAccumulatorYears >= CONFLICT_INTERVAL_YEARS) {
    const elapsed = Math.floor(state.homininConflictAccumulatorYears / CONFLICT_INTERVAL_YEARS) * CONFLICT_INTERVAL_YEARS;
    state.homininConflictAccumulatorYears -= elapsed;
    conflictUpdate(state, elapsed);
  } else {
    summarize(state);
  }
  return state;
}

export function homininConflictAt(state, siteId) {
  const site = (state?.homininSites ?? []).find((candidate) => candidate.id === siteId) ?? null;
  if (!site) return null;
  const edges = (state.homininConflictEdges ?? []).filter((edge) => edge.aSiteId === siteId || edge.bSiteId === siteId);
  const incoming = edges.reduce((sum, edge) => sum + Math.max(0, Number(edge.conflictIntensity) || 0), 0);
  const waterborne = edges.reduce((sum, edge) => sum + (edge.medium === "water" ? Math.max(0, Number(edge.conflictIntensity) || 0) : 0), 0);
  return Object.freeze({
    policy: HOMININ_CONFLICT_CONSTRUCTION_POLICY,
    siteId,
    threatIndex: Math.max(0, Number(site.threatIndex) || 0),
    territorialityIndex: clamp(site.territorialityIndex, 0, 1),
    defensiveWorksIndex: clamp(site.defensiveWorksIndex, 0, 1),
    defensiveBarrierEquivalentMeters: Math.max(0, Number(site.defensiveBarrierEquivalentMeters) || 0),
    defensiveConstructionLaborDaysPerYear: Math.max(0, Number(site.defensiveConstructionLaborDaysPerYear) || 0),
    constructionSkillIndex: clamp(site.constructionSkillIndex, 0, 1),
    interactionCount: edges.length,
    aggregateConflictIntensity: incoming,
    waterborneConflictShare: incoming > 0 ? waterborne / incoming : 0,
    resourceSeizurePersonDaysPerYear: edges.reduce((sum, edge) => sum + Math.max(0, Number(edge.resourceTransferPersonDaysPerYear) || 0), 0),
    epistemicStatus: "reduced-order territorial competition and defensive-construction model; conflict pressure follows scarcity, resource concentration, population pressure, stored value and contact, while successful resource seizure is transferred between stores rather than created"
  });
}
