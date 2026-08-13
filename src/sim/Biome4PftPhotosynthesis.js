import {
  BIOME4_PFTS,
  BIOME4_PHOTOSYNTHESIS_MINIMUM_MONTHLY_TEMPERATURE_C
} from "./Biome4PftEligibility.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 6) => Number(value.toFixed(digits));

export const BIOME4_PFT_PHOTOSYNTHESIS_POLICY = "biome4-4.1-pft-photosynthesis-conductance-independent-v1";

export const BIOME4_EXTINCTION_COEFFICIENT = Object.freeze([
  0.7, 0.7, 0.6, 0.6, 0.5, 0.5, 0.4, 0.4, 0.4, 0.3, 0.5, 0.3, 0.6
]);

export const BIOME4_MAX_C3_CI_CA_RATIO = Object.freeze([
  0.95, 0.90, 0.80, 0.80, 0.90, 0.80, 0.90, 0.65, 0.65, 0.70, 0.90, 0.75, 0.80
]);

export const BIOME4_C3_TEMPERATURE_CURVE = Object.freeze([
  1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.8, 1.0, 1.0, 1.0, 0.6, 0.6, 0.5
]);

export const BIOME4_C4_INITIAL_PFT_IDS = Object.freeze([9, 10]);
export const BIOME4_C4_CONDUCTANCE_CI_CA_RATIO = 0.4;

export const BIOME4_C4_OXYGEN_ORDER_DISCREPANCY = Object.freeze({
  sourceOperationalText: "BIOME4 4.1 c4photo computes the CO2 compensation point from o2 before assigning o2 from pressure in the shown executable source order.",
  earth777Policy: "Earth 777 uses pressure-derived O2 before the compensation-point calculation because reproducing an uninitialized Fortran scalar is not deterministic. This is an explicit source-code repair, not a claim that the original executable had a stable alternative value."
});

const C3 = Object.freeze({
  quantumEfficiency: 0.08,
  darkRespirationCoefficient: 0.015,
  theta: 0.7,
  seaLevelO2PartialPressurePa: 20.9e3,
  joulesToEinsteins: 2.3e-6,
  vmaxEstimationCiCaRatio: 0.95,
  ko25Pa: 30e3,
  kc25Pa: 30,
  tau25: 2600,
  kcQ10: 2.1,
  koQ10: 1.2,
  tauQ10: 0.57,
  carbonMolarMass: 12,
  twigLoss: 1,
  tune: 1
});

const C4 = Object.freeze({
  darkRespirationCoefficient: 0.03,
  theta: 0.7,
  seaLevelO2PartialPressurePa: 20.9e3,
  joulesToEinsteins: 2.3e-6,
  vmaxEstimationCiCaRatio: 0.95,
  tau25: 2600,
  tauQ10: 0.57,
  carbonMolarMass: 12,
  twigLoss: 1,
  minimumTemperatureCelsius: 10,
  maximumTemperatureCelsius: 55
});

function pftById(pftId) {
  const id = Math.trunc(Number(pftId));
  if (!(id >= 1 && id <= BIOME4_PFTS.length)) throw new RangeError(`Unknown BIOME4 PFT ${pftId}.`);
  return BIOME4_PFTS[id - 1];
}

function positiveRadicand(value) {
  if (value >= 0) return value;
  if (value > -1e-10) return 0;
  return Number.NaN;
}

function coLimitation(je, jc, theta, daytimeHours, damage = 1) {
  if (je === 0 && jc === 0) return 0;
  const radicand = positiveRadicand((je + jc) ** 2 - 4 * theta * je * jc);
  if (!Number.isFinite(radicand)) return 0;
  return damage * daytimeHours / (2 * theta) * (je + jc - Math.sqrt(radicand));
}

function normalizedInputs({
  pftId,
  ciCaRatio,
  incomingSolarJm2Day,
  effectiveDaylengthHours,
  temperatureCelsius,
  fpar,
  pressurePa,
  co2Ppm
}) {
  const pft = pftById(pftId);
  return {
    pft,
    pftId: pft.id,
    ratio: clamp(ciCaRatio, 0, 1.2),
    solar: Math.max(0, finite(incomingSolarJm2Day)),
    daytime: Math.max(4, finite(effectiveDaylengthHours, 4)),
    temperature: finite(temperatureCelsius),
    fpar: clamp(fpar, 0, 1),
    pressure: Math.max(1, finite(pressurePa, 101325)),
    ca: Math.max(0, finite(co2Ppm, 245)) * 1e-6
  };
}

export function biome4FvcFromLai(pftId, lai) {
  pftById(pftId);
  const extinction = BIOME4_EXTINCTION_COEFFICIENT[Math.trunc(Number(pftId)) - 1];
  const leafArea = Math.max(0, finite(lai));
  return 1 - Math.exp(-extinction * leafArea);
}

export function biome4InitialPhotosyntheticPathway(pftId) {
  const id = pftById(pftId).id;
  return BIOME4_C4_INITIAL_PFT_IDS.includes(id) ? "c4" : "c3";
}

export function biome4C3Photosynthesis(input) {
  const values = normalizedInputs(input);
  const { pft, pftId, ratio, solar, daytime, temperature, fpar, pressure, ca } = values;
  const minimum = BIOME4_PHOTOSYNTHESIS_MINIMUM_MONTHLY_TEMPERATURE_C[pftId - 1];
  const temperatureCurve = BIOME4_C3_TEMPERATURE_CURVE[pftId - 1];
  const temperatureStress = temperature > minimum + 0.1
    ? temperatureCurve * Math.exp(-10 / (temperature - minimum))
    : 0;

  const ko = C3.ko25Pa * C3.koQ10 ** ((temperature - 25) / 10);
  const kc = C3.kc25Pa * C3.kcQ10 ** ((temperature - 25) / 10);
  const tau = C3.tau25 * C3.tauQ10 ** ((temperature - 25) / 10);
  const o2 = pressure * (C3.seaLevelO2PartialPressurePa / 1e5);
  const respirationRatio = C3.darkRespirationCoefficient * (24 / daytime);
  const compensationPoint = o2 / (2 * tau);
  const michaelis = kc * (1 + o2 / ko);
  const z = C3.carbonMolarMass * C3.joulesToEinsteins * solar * fpar * C3.twigLoss * C3.tune;

  const vmaxPi = C3.vmaxEstimationCiCaRatio * ca * pressure;
  const vmaxC1 = vmaxPi > compensationPoint
    ? temperatureStress * C3.quantumEfficiency * ((vmaxPi - compensationPoint) / (vmaxPi + 2 * compensationPoint))
    : 0;
  const vmaxC2 = vmaxPi > compensationPoint
    ? (vmaxPi - compensationPoint) / (vmaxPi + michaelis)
    : 0;
  let vmax = 0;
  if (z > 0 && vmaxC1 > 0 && vmaxC2 > 0) {
    const denominator = vmaxC2 - C3.theta * respirationRatio;
    const numerator = respirationRatio - C3.theta * respirationRatio;
    const oc = denominator > 0 && numerator >= 0 ? Math.sqrt(numerator / denominator) : Number.NaN;
    if (Number.isFinite(oc)) {
      vmax = (z / C3.darkRespirationCoefficient) * (vmaxC1 / vmaxC2) *
        ((2 * C3.theta - 1) * respirationRatio - (2 * C3.theta * respirationRatio - vmaxC2) * oc);
      if (!Number.isFinite(vmax) || vmax < 0) vmax = 0;
    }
  }

  const pi = ratio * ca * pressure;
  let grossPhotosynthesis = 0;
  if (pi > compensationPoint && z > 0 && vmax > 0) {
    const c1 = temperatureStress * C3.quantumEfficiency * ((pi - compensationPoint) / (pi + 2 * compensationPoint));
    const c2 = (pi - compensationPoint) / (pi + michaelis);
    const je = c1 * z / daytime;
    const jc = c2 * vmax / 24;
    grossPhotosynthesis = coLimitation(je, jc, C3.theta, daytime);
  }

  const netDaytimeCarbon = grossPhotosynthesis - (daytime / 24) * C3.darkRespirationCoefficient * vmax;
  const leafCost = (pft.parameters.leafLongevityMonths / 12) ** 0.25;
  const leafRespiration = Math.max(0, C3.darkRespirationCoefficient * vmax * leafCost);
  const gasExchangeAday = netDaytimeCarbon === 0
    ? 0
    : (netDaytimeCarbon / C3.carbonMolarMass) * (8.314 * (temperature + 273.3) / pressure) * 1000;

  return Object.freeze({
    pathway: "c3",
    pftId,
    ciCaRatio: ratio,
    fpar,
    daytimeHours: daytime,
    temperatureStress: round(temperatureStress),
    compensationPointPa: round(compensationPoint),
    vmax: round(vmax),
    grossPhotosynthesis: round(grossPhotosynthesis),
    netDaytimeCarbon: round(netDaytimeCarbon),
    leafRespiration: round(leafRespiration),
    gasExchangeAday: round(gasExchangeAday),
    leafCost: round(leafCost),
    policy: BIOME4_PFT_PHOTOSYNTHESIS_POLICY,
    epistemicStatus: "independent BIOME4 4.1 C3 source-equation implementation for a single PFT/LAI climate trial; this is model-derived physiology, not an observation"
  });
}

export function biome4C4Photosynthesis(input) {
  const values = normalizedInputs(input);
  const { pft, pftId, ratio, solar, daytime, temperature, fpar, pressure, ca } = values;
  if (![8, 9, 10].includes(pftId)) throw new RangeError(`BIOME4 C4 routine is parameterized only for PFT 8, 9, or 10; got ${pftId}.`);
  const quantumEfficiency = pftId === 10 ? 0.0565 : 0.0633;
  const tune = pftId === 10 ? 0.75 : 1;
  const temperatureStress = temperature > C4.minimumTemperatureCelsius + 0.1 && temperature < C4.maximumTemperatureCelsius
    ? Math.min(1, Math.exp(-10 / (temperature - C4.minimumTemperatureCelsius)))
    : 0;
  const tau = C4.tau25 * C4.tauQ10 ** ((temperature - 25) / 10);
  const o2 = pressure * (C4.seaLevelO2PartialPressurePa / 1e5);
  const compensationPoint = o2 / (2 * tau);
  const respirationRatio = C4.darkRespirationCoefficient * (24 / daytime);
  const z = C4.carbonMolarMass * C4.joulesToEinsteins * solar * fpar * C4.twigLoss * tune;

  const vmaxPi = C4.vmaxEstimationCiCaRatio * ca * pressure;
  const vmaxC1 = quantumEfficiency * temperatureStress;
  const vmaxC2 = 1;
  let vmax = 0;
  if (z > 0 && vmaxPi > compensationPoint && vmaxC1 > 0) {
    const denominator = vmaxC2 - C4.theta * respirationRatio;
    const numerator = respirationRatio - C4.theta * respirationRatio;
    const oc = denominator > 0 && numerator >= 0 ? Math.sqrt(numerator / denominator) : Number.NaN;
    if (Number.isFinite(oc)) {
      vmax = (z / C4.darkRespirationCoefficient) * (vmaxC1 / vmaxC2) *
        ((2 * C4.theta - 1) * respirationRatio - (2 * C4.theta * respirationRatio - vmaxC2) * oc);
      if (!Number.isFinite(vmax) || vmax < 0) vmax = 0;
    }
  }

  const pi = ratio * ca * pressure;
  let grossPhotosynthesis = 0;
  if (pi > compensationPoint && z > 0 && vmax > 0) {
    const je = quantumEfficiency * temperatureStress * z / daytime;
    const jc = vmax / 24;
    const damage = ratio < 0.4 ? clamp(ratio / 0.4, 0, 1) : 1;
    grossPhotosynthesis = coLimitation(je, jc, C4.theta, daytime, damage);
  }

  const netDaytimeCarbon = grossPhotosynthesis - (daytime / 24) * C4.darkRespirationCoefficient * vmax;
  const leafCost = (pft.parameters.leafLongevityMonths / 12) ** 0.25;
  const leafRespiration = Math.max(0, C4.darkRespirationCoefficient * vmax * leafCost);
  const gasExchangeAday = grossPhotosynthesis === 0 && vmax === 0
    ? 0
    : (netDaytimeCarbon / C4.carbonMolarMass) * (8.314 * (temperature + 273.3) / pressure) * 1000;

  return Object.freeze({
    pathway: "c4",
    pftId,
    ciCaRatio: ratio,
    fpar,
    daytimeHours: daytime,
    temperatureStress: round(temperatureStress),
    compensationPointPa: round(compensationPoint),
    vmax: round(vmax),
    grossPhotosynthesis: round(grossPhotosynthesis),
    netDaytimeCarbon: round(netDaytimeCarbon),
    leafRespiration: round(leafRespiration),
    gasExchangeAday: round(gasExchangeAday),
    leafCost: round(leafCost),
    c4DamageFactor: round(ratio < 0.4 ? clamp(ratio / 0.4, 0, 1) : 1),
    sourceRepair: BIOME4_C4_OXYGEN_ORDER_DISCREPANCY,
    policy: BIOME4_PFT_PHOTOSYNTHESIS_POLICY,
    epistemicStatus: "independent BIOME4 4.1 C4 source-equation implementation with an explicit deterministic repair for the source routine's uninitialized-O2 ordering; this is model-derived physiology, not an observation"
  });
}

export function biome4PftPhotosynthesis(input, pathway = "auto") {
  const pftId = pftById(input?.pftId).id;
  const selected = pathway === "auto" ? biome4InitialPhotosyntheticPathway(pftId) : String(pathway).toLowerCase();
  if (selected === "c4") return biome4C4Photosynthesis(input);
  if (selected === "c3") return biome4C3Photosynthesis(input);
  throw new RangeError(`Unknown photosynthetic pathway ${pathway}.`);
}

export function biome4OptimumCanopyConductance({
  pftId,
  lai,
  incomingSolarJm2Day,
  effectiveDaylengthHours,
  temperatureCelsius,
  pressurePa,
  co2Ppm,
  pathway = "auto"
}) {
  const pft = pftById(pftId);
  const selected = pathway === "auto" ? biome4InitialPhotosyntheticPathway(pft.id) : String(pathway).toLowerCase();
  const fpar = biome4FvcFromLai(pft.id, lai);
  const ciCaRatio = selected === "c4"
    ? BIOME4_C4_CONDUCTANCE_CI_CA_RATIO
    : BIOME4_MAX_C3_CI_CA_RATIO[pft.id - 1];
  const photosynthesis = biome4PftPhotosynthesis({
    pftId: pft.id,
    ciCaRatio,
    incomingSolarJm2Day,
    effectiveDaylengthHours,
    temperatureCelsius,
    fpar,
    pressurePa,
    co2Ppm
  }, selected);
  const daytimeSeconds = 3600 * Math.max(0, finite(effectiveDaylengthHours));
  const ca = Math.max(0, finite(co2Ppm, 245)) * 1e-6;
  let optimumConductance = 0;
  if (daytimeSeconds > 0 && photosynthesis.gasExchangeAday > 0 && ca > 0 && ciCaRatio < 1) {
    optimumConductance = pft.parameters.minimumCanopyConductance +
      ((1.6 * photosynthesis.gasExchangeAday) / (ca * (1 - ciCaRatio))) / daytimeSeconds;
  }
  if (!Number.isFinite(optimumConductance) || optimumConductance < 0) optimumConductance = 0;
  return Object.freeze({
    pftId: pft.id,
    pathway: selected,
    lai: Math.max(0, finite(lai)),
    fpar: round(fpar),
    ciCaRatio,
    minimumCanopyConductance: pft.parameters.minimumCanopyConductance,
    optimumConductance: round(optimumConductance),
    photosynthesis,
    policy: BIOME4_PFT_PHOTOSYNTHESIS_POLICY,
    epistemicStatus: "BIOME4 4.1 source-equation optimum non-water-stressed canopy conductance for one monthly PFT/LAI trial; water limitation is not applied here"
  });
}
