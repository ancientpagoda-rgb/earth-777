const positive = (value, floor = 1e-12) => Math.max(floor, Number(value) || 0);
const relaxFraction = (dtYears, tauYears) => 1 - Math.exp(-positive(dtYears, 0) / positive(tauYears));

export const BIOGEOCHEMISTRY_BASELINE = Object.freeze({
  co2Ppm: 245,
  methanePpb: 631,
  nitrousOxidePpb: 270,
  temperatureAnomalyK: -1.27,
  iceIndex: 0.18,
  atmosphericCarbonPgCPerPpm: 2.12,
  methaneCarbonPgCPerPpb: 0.00213,
  n2oNitrogenTgNPerPpb: 4.96,
  carbon: Object.freeze({
    oceanSurfacePgC: 900,
    oceanDeepPgC: 37_100,
    terrestrialPgC: 1_900,
    sedimentPgC: 60_000_000
  }),
  nitrogen: Object.freeze({
    atmosphericN2TgN: 3_860_000_000,
    terrestrialReactiveTgN: 120_000,
    oceanReactiveTgN: 650_000
  })
});

function move(state, fromKey, toKey, amount) {
  const requested = Math.max(0, Number(amount) || 0);
  if (requested <= 0) return 0;
  const available = Math.max(0, Number(state[fromKey]) || 0);
  const moved = Math.min(available, requested);
  state[fromKey] = available - moved;
  state[toKey] = Math.max(0, Number(state[toKey]) || 0) + moved;
  return moved;
}

function moveSigned(state, aKey, bKey, amount) {
  return amount >= 0
    ? move(state, aKey, bKey, amount)
    : -move(state, bKey, aKey, -amount);
}

export function initializeBiogeochemistry(state) {
  const b = BIOGEOCHEMISTRY_BASELINE;
  state.atmosphericCarbonPgC ??= positive(state.co2 ?? b.co2Ppm) * b.atmosphericCarbonPgCPerPpm;
  state.oceanSurfaceCarbonPgC ??= b.carbon.oceanSurfacePgC;
  state.oceanDeepCarbonPgC ??= b.carbon.oceanDeepPgC;
  state.terrestrialCarbonPgC ??= b.carbon.terrestrialPgC;
  state.sedimentCarbonPgC ??= b.carbon.sedimentPgC;
  state.methaneCarbonPgC ??= positive(state.methane ?? b.methanePpb) * b.methaneCarbonPgCPerPpb;

  state.atmosphericN2NitrogenTgN ??= b.nitrogen.atmosphericN2TgN;
  state.terrestrialReactiveNitrogenTgN ??= b.nitrogen.terrestrialReactiveTgN;
  state.oceanReactiveNitrogenTgN ??= b.nitrogen.oceanReactiveTgN;
  state.atmosphericN2ONitrogenTgN ??= positive(state.nitrousOxide ?? b.nitrousOxidePpb) * b.n2oNitrogenTgNPerPpb;

  state.geologicActivityIndex ??= 1;
  state.greenhouseForcing ??= 0;
  state.carbonFluxes ??= Object.freeze({});
  state.methaneFluxes ??= Object.freeze({});
  state.nitrogenFluxes ??= Object.freeze({});
  syncAtmosphereFromReservoirs(state);
  return state;
}

export function syncAtmosphereFromReservoirs(state) {
  const b = BIOGEOCHEMISTRY_BASELINE;
  state.co2 = positive(state.atmosphericCarbonPgC) / b.atmosphericCarbonPgCPerPpm;
  state.methane = positive(state.methaneCarbonPgC) / b.methaneCarbonPgCPerPpb;
  state.nitrousOxide = positive(state.atmosphericN2ONitrogenTgN) / b.n2oNitrogenTgNPerPpb;
  state.greenhouseForcing = greenhouseRadiativeForcing(state);
  return state;
}

export function greenhouseRadiativeForcing(state, reference = BIOGEOCHEMISTRY_BASELINE) {
  const co2 = positive(state.co2 ?? reference.co2Ppm);
  const methane = positive(state.methane ?? reference.methanePpb);
  const n2o = positive(state.nitrousOxide ?? reference.nitrousOxidePpb);

  // Myhre-style compact expressions. These intentionally remain an
  // intermediate-complexity approximation; the state variables themselves are
  // free to move beyond late-Pleistocene ranges instead of being concentration-capped.
  const co2Forcing = 5.35 * Math.log(co2 / reference.co2Ppm);
  const methaneForcing = 0.036 * (Math.sqrt(methane) - Math.sqrt(reference.methanePpb));
  const n2oForcing = 0.12 * (Math.sqrt(n2o) - Math.sqrt(reference.nitrousOxidePpb));
  return co2Forcing + methaneForcing + n2oForcing;
}

export function trackedCarbonPgC(state) {
  return [
    "atmosphericCarbonPgC",
    "oceanSurfaceCarbonPgC",
    "oceanDeepCarbonPgC",
    "terrestrialCarbonPgC",
    "sedimentCarbonPgC",
    "methaneCarbonPgC"
  ].reduce((sum, key) => sum + (Number(state[key]) || 0), 0);
}

export function trackedNitrogenTgN(state) {
  return [
    "atmosphericN2NitrogenTgN",
    "terrestrialReactiveNitrogenTgN",
    "oceanReactiveNitrogenTgN",
    "atmosphericN2ONitrogenTgN"
  ].reduce((sum, key) => sum + (Number(state[key]) || 0), 0);
}

export function advanceCarbonCycle(state, dtYears, { perturbation = 0 } = {}) {
  initializeBiogeochemistry(state);
  const b = BIOGEOCHEMISTRY_BASELINE;
  const co2 = positive(state.atmosphericCarbonPgC) / b.atmosphericCarbonPgCPerPpm;
  const temperature = Number(state.temperatureAnomaly ?? b.temperatureAnomalyK);
  const oceanTemperature = Number(state.oceanTemperatureAnomaly ?? temperature);
  const ice = Number(state.iceIndex ?? b.iceIndex);
  const productivity = positive(state.productivityIndex ?? 1, 0.01);
  const nitrogenAvailability = positive(state.terrestrialReactiveNitrogenTgN) / b.nitrogen.terrestrialReactiveTgN;

  const oceanSolubility = Math.exp(-0.018 * (oceanTemperature - b.temperatureAnomalyK));
  const oceanSurfaceTarget = b.carbon.oceanSurfacePgC * (co2 / b.co2Ppm) ** 0.78 * oceanSolubility;
  const airSeaFlux = (oceanSurfaceTarget - state.oceanSurfaceCarbonPgC) / 85;

  const co2Fertilization = ((co2 / (co2 + 180)) / (b.co2Ppm / (b.co2Ppm + 180))) ** 0.55;
  const thermalSuitability = Math.exp(
    -0.022 * ((temperature - 0.5) ** 2 - (b.temperatureAnomalyK - 0.5) ** 2)
  );
  const icePenalty = Math.exp(-0.55 * (ice - b.iceIndex));
  const landCarbonTarget = b.carbon.terrestrialPgC * co2Fertilization * thermalSuitability * icePenalty * nitrogenAvailability ** 0.18;
  const landFlux = (landCarbonTarget - state.terrestrialCarbonPgC) / 140;

  const weatheringFlux = 0.065
    * (co2 / b.co2Ppm) ** 0.32
    * Math.exp(0.055 * (temperature - b.temperatureAnomalyK))
    * productivity ** 0.10;
  const burialFlux = 0.065 * (state.oceanSurfaceCarbonPgC / b.carbon.oceanSurfacePgC) ** 1.30;
  const volcanicFlux = 0.065 * positive(state.geologicActivityIndex ?? 1, 0.05) * Math.exp((Number(perturbation) || 0) * 0.035);

  const movedLand = moveSigned(state, "atmosphericCarbonPgC", "terrestrialCarbonPgC", landFlux * dtYears);
  const movedAirSea = moveSigned(state, "atmosphericCarbonPgC", "oceanSurfaceCarbonPgC", airSeaFlux * dtYears);
  const movedWeathering = move(state, "atmosphericCarbonPgC", "oceanSurfaceCarbonPgC", weatheringFlux * dtYears);
  const movedBurial = move(state, "oceanSurfaceCarbonPgC", "sedimentCarbonPgC", burialFlux * dtYears);
  const movedVolcanic = move(state, "sedimentCarbonPgC", "atmosphericCarbonPgC", volcanicFlux * dtYears);

  state.carbonFluxes = Object.freeze({
    airSeaPgCPerYear: movedAirSea / dtYears,
    surfaceToDeepPgCPerYear: Number(state.oceanCirculationCarbonFluxPgCPerYear) || 0,
    atmosphereToLandPgCPerYear: movedLand / dtYears,
    weatheringPgCPerYear: movedWeathering / dtYears,
    carbonateBurialPgCPerYear: movedBurial / dtYears,
    volcanicPgCPerYear: movedVolcanic / dtYears
  });
}

export function advanceMethaneCycle(state, dtYears) {
  initializeBiogeochemistry(state);
  const b = BIOGEOCHEMISTRY_BASELINE;
  const temperature = Number(state.temperatureAnomaly ?? b.temperatureAnomalyK);
  const ice = Number(state.iceIndex ?? b.iceIndex);
  const productivity = positive(state.productivityIndex ?? 1, 0.01);
  const wetlandFactor = productivity ** 0.62
    * Math.exp(0.075 * (temperature - b.temperatureAnomalyK))
    * Math.exp(-0.75 * (ice - b.iceIndex));

  const wetlandRate = 0.118 * wetlandFactor;
  const inlandOceanRate = 0.012 * productivity ** 0.35 * Math.exp(0.035 * (temperature - b.temperatureAnomalyK));
  const geologicRate = 0.014 * positive(state.geologicActivityIndex ?? 1, 0.05);

  const wetlandAmount = move(state, "terrestrialCarbonPgC", "methaneCarbonPgC", wetlandRate * dtYears);
  const oceanAmount = move(state, "oceanSurfaceCarbonPgC", "methaneCarbonPgC", inlandOceanRate * dtYears);
  const geologicAmount = move(state, "sedimentCarbonPgC", "methaneCarbonPgC", geologicRate * dtYears);
  const sourceAmount = wetlandAmount + oceanAmount + geologicAmount;
  const sourceRate = sourceAmount / dtYears;

  const sourceAddedState = state.methaneCarbonPgC;
  // Methane oxidation accelerates somewhat in warmer/moister atmospheres through OH.
  const lifetimeYears = Math.max(2.5, 9.3 * Math.exp(-0.045 * (temperature - b.temperatureAnomalyK)));
  const retainedFraction = Math.exp(-dtYears / lifetimeYears);
  const methaneBeforeContinuousCorrection = sourceAddedState - sourceAmount;
  const finalMethane = methaneBeforeContinuousCorrection * retainedFraction
    + sourceRate * lifetimeYears * (1 - retainedFraction);
  const oxidized = Math.max(0, methaneBeforeContinuousCorrection + sourceAmount - finalMethane);
  state.methaneCarbonPgC = finalMethane;
  state.atmosphericCarbonPgC += oxidized;

  state.methaneFluxes = Object.freeze({
    wetlandPgCPerYear: wetlandAmount / dtYears,
    inlandWaterPgCPerYear: oceanAmount / dtYears,
    geologicPgCPerYear: geologicAmount / dtYears,
    oxidationPgCPerYear: oxidized / dtYears,
    lifetimeYears
  });
}

export function advanceNitrogenCycle(state, dtYears) {
  initializeBiogeochemistry(state);
  const b = BIOGEOCHEMISTRY_BASELINE;
  const temperature = Number(state.temperatureAnomaly ?? b.temperatureAnomalyK);
  const productivity = positive(state.productivityIndex ?? 1, 0.01);
  const soilAvailability = positive(state.terrestrialReactiveNitrogenTgN) / b.nitrogen.terrestrialReactiveTgN;
  const oceanAvailability = positive(state.oceanReactiveNitrogenTgN) / b.nitrogen.oceanReactiveTgN;

  const landFixationRate = 7.4 * productivity ** 0.42 / soilAvailability ** 0.08;
  const oceanFixationRate = 4.15 * productivity ** 0.20 / oceanAvailability ** 0.05;
  const fixedLand = move(state, "atmosphericN2NitrogenTgN", "terrestrialReactiveNitrogenTgN", landFixationRate * dtYears);
  const fixedOcean = move(state, "atmosphericN2NitrogenTgN", "oceanReactiveNitrogenTgN", oceanFixationRate * dtYears);

  const landN2oRate = 7.4
    * soilAvailability ** 0.30
    * productivity ** 0.35
    * Math.exp(0.045 * (temperature - b.temperatureAnomalyK));
  const oceanN2oRate = 4.15
    * oceanAvailability ** 0.25
    * Math.exp(0.025 * (temperature - b.temperatureAnomalyK));
  const landN2o = move(state, "terrestrialReactiveNitrogenTgN", "atmosphericN2ONitrogenTgN", landN2oRate * dtYears);
  const oceanN2o = move(state, "oceanReactiveNitrogenTgN", "atmosphericN2ONitrogenTgN", oceanN2oRate * dtYears);
  const sourceAmount = landN2o + oceanN2o;
  const sourceRate = sourceAmount / dtYears;

  const sourceAddedState = state.atmosphericN2ONitrogenTgN;
  const lifetimeYears = Math.max(60, 116 * Math.exp(-0.012 * (temperature - b.temperatureAnomalyK)));
  const retainedFraction = Math.exp(-dtYears / lifetimeYears);
  const n2oBeforeContinuousCorrection = sourceAddedState - sourceAmount;
  const finalN2o = n2oBeforeContinuousCorrection * retainedFraction
    + sourceRate * lifetimeYears * (1 - retainedFraction);
  const destroyed = Math.max(0, n2oBeforeContinuousCorrection + sourceAmount - finalN2o);
  state.atmosphericN2ONitrogenTgN = finalN2o;
  state.atmosphericN2NitrogenTgN += destroyed;

  state.nitrogenFluxes = Object.freeze({
    terrestrialFixationTgNPerYear: fixedLand / dtYears,
    oceanFixationTgNPerYear: fixedOcean / dtYears,
    terrestrialN2oTgNPerYear: landN2o / dtYears,
    oceanN2oTgNPerYear: oceanN2o / dtYears,
    n2oPhotolysisTgNPerYear: destroyed / dtYears,
    n2oLifetimeYears: lifetimeYears
  });
}

export function advanceBiogeochemistry(state, dtYears, { perturbation = 0 } = {}) {
  initializeBiogeochemistry(state);
  const dt = positive(dtYears, 0);
  if (dt <= 0) return state;
  advanceCarbonCycle(state, dt, { perturbation });
  advanceMethaneCycle(state, dt);
  advanceNitrogenCycle(state, dt);
  syncAtmosphereFromReservoirs(state);
  return state;
}