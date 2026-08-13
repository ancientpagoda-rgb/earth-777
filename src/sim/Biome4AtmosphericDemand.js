import { biome4DailyMidmonthInterpolation } from "./Biome4PftWaterPhenology.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 6) => Number(value.toFixed(digits));
const RAD = Math.PI / 180;
const MID_MONTH_DAYS = Object.freeze([16, 44, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350]);

export const BIOME4_ATMOSPHERIC_DEMAND_POLICY = "biome4-4.1-ppeett-independent-v1";
export const BIOME4_RADIATION_ANOMALY_MULTIPLIER = Object.freeze(Array.from({ length: 12 }, () => 1));

const THERMODYNAMIC_TABLE = Object.freeze([
  Object.freeze({ maximumTemperatureCelsius: -5, psychrometricConstantPaPerK: 64.6, latentHeatMjKg: 2.513 }),
  Object.freeze({ maximumTemperatureCelsius: 0, psychrometricConstantPaPerK: 64.9, latentHeatMjKg: 2.501 }),
  Object.freeze({ maximumTemperatureCelsius: 5, psychrometricConstantPaPerK: 65.2, latentHeatMjKg: 2.489 }),
  Object.freeze({ maximumTemperatureCelsius: 10, psychrometricConstantPaPerK: 65.6, latentHeatMjKg: 2.477 }),
  Object.freeze({ maximumTemperatureCelsius: 15, psychrometricConstantPaPerK: 65.9, latentHeatMjKg: 2.465 }),
  Object.freeze({ maximumTemperatureCelsius: 20, psychrometricConstantPaPerK: 66.1, latentHeatMjKg: 2.454 }),
  Object.freeze({ maximumTemperatureCelsius: 25, psychrometricConstantPaPerK: 66.5, latentHeatMjKg: 2.442 }),
  Object.freeze({ maximumTemperatureCelsius: 30, psychrometricConstantPaPerK: 66.8, latentHeatMjKg: 2.430 }),
  Object.freeze({ maximumTemperatureCelsius: 35, psychrometricConstantPaPerK: 67.2, latentHeatMjKg: 2.418 }),
  Object.freeze({ maximumTemperatureCelsius: 40, psychrometricConstantPaPerK: 67.5, latentHeatMjKg: 2.406 }),
  Object.freeze({ maximumTemperatureCelsius: Number.POSITIVE_INFINITY, psychrometricConstantPaPerK: 67.8, latentHeatMjKg: 2.394 })
]);

function requireMonthly(values, label) {
  if (!Array.isArray(values) || values.length !== 12) throw new TypeError(`${label} requires exactly 12 monthly values.`);
  const result = values.map(Number);
  if (result.some((value) => !Number.isFinite(value))) throw new TypeError(`${label} requires finite monthly values.`);
  return result;
}

export function biome4ThermodynamicLookup(temperatureCelsius) {
  const temperature = Number(temperatureCelsius);
  if (!Number.isFinite(temperature)) throw new TypeError("BIOME4 thermodynamic lookup requires finite temperature.");
  const row = THERMODYNAMIC_TABLE.find((entry) => temperature <= entry.maximumTemperatureCelsius) ?? THERMODYNAMIC_TABLE.at(-1);
  return Object.freeze({
    psychrometricConstantPaPerK: row.psychrometricConstantPaPerK,
    latentHeatMjKg: row.latentHeatMjKg
  });
}

function hourAngle(u, v) {
  if (u >= v) return Math.PI;
  if (u <= -v) return 0;
  if (Math.abs(v) < 1e-12) return u > 0 ? Math.PI : 0;
  return Math.acos(clamp(-u / v, -1, 1));
}

function dailyRadiationGeometry(latitude, dayOfYear, temperatureCelsius, cloudCoverPercent) {
  const latitudeRadians = clamp(latitude, -90, 90) * RAD;
  const day = clamp(Math.floor(dayOfYear), 1, 365);
  const temperature = Number(temperatureCelsius) || 0;
  const cloud = clamp(cloudCoverPercent, 0, 100) / 100;
  const b = 0.2;
  const radup = 107;
  const qoo = 1360;
  const d = 0.5;
  const c = 0.25;
  const albedo = 0.17;
  const outgoingLongwave = (b + (1 - b) * cloud) * (radup - temperature);
  const solarConstant = qoo * (1 + 2 * 0.01675 * Math.cos(RAD * (360 * day) / 365));
  const shortwave = solarConstant * (c + d * cloud) * (1 - albedo);
  const declination = -RAD * 23.4 * Math.cos(RAD * 360 * (day + 10) / 365);
  const cla = Math.cos(latitudeRadians) * Math.cos(declination);
  const sla = Math.sin(latitudeRadians) * Math.sin(declination);
  const u = shortwave * sla - outgoingLongwave;
  const v = shortwave * cla;
  const ho = hourAngle(u, v);
  return { shortwave, outgoingLongwave, cla, sla, ho };
}

export function biome4AtmosphericEquilibriumDemand({
  latitude,
  monthlyTemperatureCelsius,
  monthlyCloudCoverPercent
}) {
  const monthlyTemperature = requireMonthly(monthlyTemperatureCelsius, "BIOME4 atmospheric demand temperature");
  const monthlyCloud = requireMonthly(monthlyCloudCoverPercent, "BIOME4 atmospheric demand cloud");
  const dailyTemperature = biome4DailyMidmonthInterpolation(monthlyTemperature);
  const dailyCloud = biome4DailyMidmonthInterpolation(monthlyCloud);
  const dailyEquilibriumDemandMm = new Float64Array(365);
  const dailyEffectiveDaylengthHours = new Float64Array(365);
  const monthlyIncomingSolarJm2Day = new Float64Array(12);
  const monthlyEffectiveDaylengthHours = new Float64Array(12);

  for (let index = 0; index < 365; index += 1) {
    const day = index + 1;
    const temperature = dailyTemperature[index];
    const radiation = dailyRadiationGeometry(latitude, day, temperature, dailyCloud[index]);
    const saturationSlope = (2.5e6 * Math.exp((17.27 * temperature) / (237.3 + temperature))) /
      ((237.3 + temperature) ** 2);
    const thermo = biome4ThermodynamicLookup(temperature);
    const conversion = (3600 / (thermo.latentHeatMjKg * 1e6)) *
      (saturationSlope / (saturationSlope + thermo.psychrometricConstantPaPerK));
    dailyEquilibriumDemandMm[index] = conversion * 2 *
      (((radiation.shortwave * radiation.sla - radiation.outgoingLongwave) * radiation.ho) +
        radiation.shortwave * radiation.cla * Math.sin(radiation.ho)) /
      (Math.PI / 12);
    dailyEffectiveDaylengthHours[index] = radiation.ho === 0 ? 0 : 24 * (radiation.ho / Math.PI);

    const monthIndex = MID_MONTH_DAYS.indexOf(day);
    if (monthIndex >= 0) {
      monthlyEffectiveDaylengthHours[monthIndex] = dailyEffectiveDaylengthHours[index];
      const us = radiation.shortwave * radiation.sla;
      const vs = radiation.shortwave * radiation.cla;
      const hos = hourAngle(us, vs);
      const incomingSolar = 2 *
        (radiation.shortwave * radiation.sla * hos + radiation.shortwave * radiation.cla * Math.sin(hos)) *
        (3600 * 12 / Math.PI);
      monthlyIncomingSolarJm2Day[monthIndex] = incomingSolar <= 0 ? 0 : incomingSolar;
    }
  }

  return Object.freeze({
    policy: BIOME4_ATMOSPHERIC_DEMAND_POLICY,
    latitude: clamp(latitude, -90, 90),
    dailyTemperatureCelsius: dailyTemperature,
    dailyCloudCoverPercent: dailyCloud,
    dailyEquilibriumDemandMm,
    dailyEffectiveDaylengthHours,
    monthlyIncomingSolarJm2Day,
    monthlyEffectiveDaylengthHours,
    radiationAnomalyMultiplier: BIOME4_RADIATION_ANOMALY_MULTIPLIER,
    annualEquilibriumDemandMm: round(Array.from(dailyEquilibriumDemandMm).reduce((sum, value) => sum + value, 0)),
    epistemicStatus: "independent reproduction of BIOME4 4.1 ppeett equilibrium atmospheric demand from temperature, cloud and latitude; the source version fixes all monthly radiation-anomaly multipliers to 1.0 and does not require an external humidity/VPD field"
  });
}
