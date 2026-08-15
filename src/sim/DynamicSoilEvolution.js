const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits));

export const DYNAMIC_SOIL_POLICY = "climate-weathering-erosion-deposition-pedogenesis-v1";

function validBaseline(profile) {
  return Boolean(
    profile?.validSoil
    && Number.isFinite(profile.topWaterCapacityMm)
    && Number.isFinite(profile.bottomWaterCapacityMm)
    && profile.topWaterCapacityMm >= 0
    && profile.bottomWaterCapacityMm >= 0
  );
}

function unchanged(profile, extra = {}) {
  return Object.freeze({
    ...profile,
    ...extra,
    policy: DYNAMIC_SOIL_POLICY,
    evolved: false,
    capacityMultiplier: 1,
    topCapacityMultiplier: 1,
    bottomCapacityMultiplier: 1,
    fertilityIndex: 1,
    soilProductionMmPerYear: 0,
    erosionLossMmPerYear: 0,
    depositionGainMmPerYear: 0,
    effectiveIntegrationYears: 0,
    epistemicStatus: "checkpoint-neutral BIOME4 soil profile; pedogenic branch anomaly is exactly zero at initialization"
  });
}

export function evolveSoilProfile(globalState, baselineProfile, climate, geomorphology = null) {
  if (!validBaseline(baselineProfile)) {
    return baselineProfile ? Object.freeze({
      ...baselineProfile,
      policy: DYNAMIC_SOIL_POLICY,
      evolved: false,
      capacityMultiplier: 1,
      fertilityIndex: 1,
      epistemicStatus: "BIOME4 does not define a valid two-layer soil at this cell; dynamic pedogenesis does not fabricate one"
    }) : null;
  }

  const elapsedYears = Math.max(0, Number(globalState?.elapsedYears) || 0);
  if (elapsedYears <= 0) return unchanged(baselineProfile);

  const temperatureCelsius = clamp(climate?.temperatureCelsius ?? 8, -35, 45);
  const precipitationMmPerYear = Math.max(0, Number(climate?.precipitationMmPerYear) || 0);
  const productivity = clamp(globalState?.productivityIndex ?? 1, 0.03, 6);
  const erosionRateMmPerYear = Math.max(0, Number(geomorphology?.erosionRateMmPerYear) || 0);
  const depositionRateMmPerYear = Math.max(0, Number(geomorphology?.depositionRateMmPerYear) || 0);

  // Pedogenesis is intentionally slower than the annual water cycle. The
  // saturating memory horizon avoids pretending that today's erosion rate held
  // unchanged for the entire branch while still allowing long-lived regimes to
  // substantially deepen or strip soil.
  const pedogenicMemoryYears = 35_000;
  const effectiveIntegrationYears = pedogenicMemoryYears * (1 - Math.exp(-elapsedYears / pedogenicMemoryYears));

  const moistureIndex = precipitationMmPerYear / (precipitationMmPerYear + 650);
  const temperatureFactor = Math.exp(clamp((temperatureCelsius - 8) * 0.035, -1.35, 1.35));
  const biologicalWeathering = clamp(productivity ** 0.16, 0.55, 1.45);
  const soilProductionMmPerYear = 0.018
    * temperatureFactor
    * (0.28 + 1.45 * moistureIndex)
    * biologicalWeathering;

  // Stream-power erosion is a bedrock/landscape lowering diagnostic. Soil loss
  // follows most, but not all, of that rate because roots/armoring can retain a
  // fraction. Deposited sediment contributes to new parent material with a
  // smaller immediate pedogenic efficiency.
  const erosionLossMmPerYear = erosionRateMmPerYear * 0.88;
  const depositionGainMmPerYear = depositionRateMmPerYear * 0.72;
  const netSoilFormationMmPerYear = soilProductionMmPerYear + depositionGainMmPerYear - erosionLossMmPerYear;

  const baselineCapacityMm = Math.max(1, baselineProfile.topWaterCapacityMm + baselineProfile.bottomWaterCapacityMm);
  // Capacity is used only as a depth proxy here; BIOME4 does not provide a
  // globally consistent explicit depth field in this compact runtime asset.
  const baselineDepthMeters = clamp(baselineCapacityMm / 180, 0.18, 3.6);
  const rawDepthMeters = baselineDepthMeters + netSoilFormationMmPerYear * effectiveIntegrationYears / 1000;
  const soilDepthMeters = clamp(rawDepthMeters, 0.08, 4.5);
  const depthRatio = soilDepthMeters / baselineDepthMeters;

  const organicMatterFactor = clamp(
    0.88 + 0.18 * productivity ** 0.22 + 0.16 * moistureIndex,
    0.72,
    1.34
  );
  const depositionalTextureFactor = clamp(1 + Math.log1p(depositionRateMmPerYear * 80) * 0.035, 1, 1.18);
  const capacityMultiplier = clamp(depthRatio * organicMatterFactor * depositionalTextureFactor, 0.22, 2.4);
  const topCapacityMultiplier = clamp(
    capacityMultiplier * (0.94 + 0.10 * organicMatterFactor + 0.06 * Math.min(1, depositionRateMmPerYear * 20)),
    0.20,
    2.65
  );
  const bottomCapacityMultiplier = clamp(depthRatio * (0.96 + 0.04 * depositionalTextureFactor), 0.24, 2.35);

  const topWaterCapacityMm = baselineProfile.topWaterCapacityMm * topCapacityMultiplier;
  const bottomWaterCapacityMm = baselineProfile.bottomWaterCapacityMm * bottomCapacityMultiplier;

  // Percolation coefficients are hydraulic texture parameters rather than soil
  // depth itself, so only a modest weathering/organic/deposition correction is
  // applied instead of scaling them with total depth.
  const hydraulicFactor = clamp(
    1.04
      + 0.10 * temperatureFactor * moistureIndex
      + 0.08 * Math.min(1, depositionRateMmPerYear * 25)
      - 0.12 * Math.max(0, organicMatterFactor - 1),
    0.72,
    1.32
  );
  const topPercolationCoefficient = Math.max(0, baselineProfile.topPercolationCoefficient * hydraulicFactor);
  const bottomPercolationCoefficient = Math.max(0, baselineProfile.bottomPercolationCoefficient * (0.92 + 0.08 * hydraulicFactor));

  const mineralSupply = soilProductionMmPerYear / 0.03 + depositionGainMmPerYear / 0.05;
  const erosionPenalty = erosionLossMmPerYear / 0.08;
  const fertilityIndex = clamp(
    organicMatterFactor * (0.72 + 0.28 * Math.sqrt(Math.max(0.05, mineralSupply + 0.25))) / (1 + erosionPenalty * 0.12),
    0.25,
    2.25
  );

  return Object.freeze({
    ...baselineProfile,
    topWaterCapacityMm: round(topWaterCapacityMm, 4),
    bottomWaterCapacityMm: round(bottomWaterCapacityMm, 4),
    totalWaterCapacityMm: round(topWaterCapacityMm + bottomWaterCapacityMm, 4),
    topPercolationCoefficient: round(topPercolationCoefficient, 6),
    bottomPercolationCoefficient: round(bottomPercolationCoefficient, 6),
    baselineTopWaterCapacityMm: baselineProfile.topWaterCapacityMm,
    baselineBottomWaterCapacityMm: baselineProfile.bottomWaterCapacityMm,
    baselineTotalWaterCapacityMm: baselineCapacityMm,
    baselineDepthMeters: round(baselineDepthMeters, 4),
    soilDepthMeters: round(soilDepthMeters, 4),
    capacityMultiplier: round(capacityMultiplier, 5),
    topCapacityMultiplier: round(topCapacityMultiplier, 5),
    bottomCapacityMultiplier: round(bottomCapacityMultiplier, 5),
    hydraulicFactor: round(hydraulicFactor, 5),
    fertilityIndex: round(fertilityIndex, 5),
    moistureIndex: round(moistureIndex, 5),
    temperatureFactor: round(temperatureFactor, 5),
    soilProductionMmPerYear: round(soilProductionMmPerYear, 6),
    erosionLossMmPerYear: round(erosionLossMmPerYear, 6),
    depositionGainMmPerYear: round(depositionGainMmPerYear, 6),
    netSoilFormationMmPerYear: round(netSoilFormationMmPerYear, 6),
    effectiveIntegrationYears: round(effectiveIntegrationYears, 1),
    policy: DYNAMIC_SOIL_POLICY,
    evolved: true,
    epistemicStatus: "deterministic intermediate-complexity pedogenesis: climate and productivity produce weathered soil, runoff-driven erosion removes it, sediment deposition supplies parent material, and the resulting effective depth/organic/texture response modifies BIOME4 water capacity and percolation in a fixed two-pass network solve"
  });
}

export function soilEvolutionCellFields(topology) {
  const count = topology.count;
  return {
    appliedMask: new Uint8Array(count),
    capacityMultiplier: new Float32Array(count),
    topWaterCapacityMm: new Float32Array(count),
    bottomWaterCapacityMm: new Float32Array(count),
    soilDepthMeters: new Float32Array(count),
    fertilityIndex: new Float32Array(count),
    soilProductionMmPerYear: new Float32Array(count),
    erosionLossMmPerYear: new Float32Array(count),
    depositionGainMmPerYear: new Float32Array(count)
  };
}
