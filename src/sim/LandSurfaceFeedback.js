const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const round = (value, digits = 4) => Number((Number(value) || 0).toFixed(digits));

export const LAND_SURFACE_FEEDBACK_POLICY = "deterministic-two-pass-vegetation-water-surface-v1";

function waterAvailability(temperatureCelsius, precipitationMmPerYear, cloudCoverPercent) {
  if (!Number.isFinite(precipitationMmPerYear)) return null;
  const temperatureDemand = Math.exp(clamp(temperatureCelsius, -35, 50) * 0.032);
  const cloudRelief = 1 - clamp((cloudCoverPercent ?? 50) / 100, 0, 1) * 0.18;
  const atmosphericDemand = 620 * temperatureDemand * cloudRelief;
  return clamp(precipitationMmPerYear / (precipitationMmPerYear + atmosphericDemand), 0.001, 0.999);
}

function vegetationCoverFromLai(lai) {
  return clamp(1 - Math.exp(-0.55 * Math.max(0, Number(lai) || 0)), 0, 0.995);
}

function surfaceState(lai, temperatureCelsius, precipitationMmPerYear, cloudCoverPercent) {
  const water = waterAvailability(temperatureCelsius, precipitationMmPerYear, cloudCoverPercent);
  if (!Number.isFinite(water)) return null;
  const cover = vegetationCoverFromLai(lai);
  const bareAlbedo = 0.31 - water * 0.13;
  const canopyAlbedo = 0.14;
  const albedo = bareAlbedo * (1 - cover) + canopyAlbedo * cover;
  const evaporativeFraction = clamp(water * (0.22 + 0.78 * cover), 0.005, 0.98);
  const roughnessMeters = 0.015 + cover * (0.08 + 0.12 * Math.sqrt(Math.max(0, Number(lai) || 0) + 0.01));
  const recyclingPotential = cover * evaporativeFraction;
  return { water, cover, albedo, evaporativeFraction, roughnessMeters, recyclingPotential };
}

export function landSurfaceFeedbackAt(globalState, checkpointVegetation, checkpointClimate, firstPassClimate) {
  const checkpointLai = Number(checkpointVegetation?.lai);
  if (!Number.isFinite(checkpointLai) || checkpointLai < 0) return null;
  if (!Number.isFinite(checkpointClimate?.temperatureCelsius)
    || !Number.isFinite(checkpointClimate?.precipitationMmPerYear)
    || !Number.isFinite(firstPassClimate?.temperatureCelsius)
    || !Number.isFinite(firstPassClimate?.precipitationMmPerYear)) return null;

  const checkpoint = surfaceState(
    checkpointLai,
    checkpointClimate.temperatureCelsius,
    checkpointClimate.precipitationMmPerYear,
    checkpointClimate.cloudCoverPercent
  );
  if (!checkpoint) return null;

  if ((Number(globalState?.elapsedYears) || 0) <= 0) {
    return Object.freeze({
      policy: LAND_SURFACE_FEEDBACK_POLICY,
      active: false,
      checkpointLai: round(checkpointLai, 3),
      estimatedLai: round(checkpointLai, 3),
      checkpointVegetationCover: round(checkpoint.cover, 4),
      vegetationCover: round(checkpoint.cover, 4),
      surfaceAlbedoDelta: 0,
      evaporativeFractionDelta: 0,
      roughnessLogRatio: 0,
      moistureRecyclingRatio: 1,
      epistemicStatus: "checkpoint-neutral deterministic land-surface state"
    });
  }

  const currentWater = waterAvailability(
    firstPassClimate.temperatureCelsius,
    firstPassClimate.precipitationMmPerYear,
    firstPassClimate.cloudCoverPercent
  );
  if (!Number.isFinite(currentWater)) return null;

  const productivity = clamp(globalState?.productivityIndex ?? 1, 0.03, 6);
  const waterRatio = clamp(currentWater / Math.max(0.02, checkpoint.water), 0.08, 6);
  const laiMultiplier = clamp(productivity ** 0.28 * waterRatio ** 0.55, 0.12, 4.5);
  const estimatedLai = checkpointLai * laiMultiplier;
  const current = surfaceState(
    estimatedLai,
    firstPassClimate.temperatureCelsius,
    firstPassClimate.precipitationMmPerYear,
    firstPassClimate.cloudCoverPercent
  );
  if (!current) return null;

  return Object.freeze({
    policy: LAND_SURFACE_FEEDBACK_POLICY,
    active: true,
    checkpointLai: round(checkpointLai, 3),
    estimatedLai: round(estimatedLai, 3),
    checkpointVegetationCover: round(checkpoint.cover, 4),
    vegetationCover: round(current.cover, 4),
    checkpointWaterAvailability: round(checkpoint.water, 4),
    waterAvailability: round(current.water, 4),
    checkpointSurfaceAlbedo: round(checkpoint.albedo, 4),
    surfaceAlbedo: round(current.albedo, 4),
    surfaceAlbedoDelta: round(current.albedo - checkpoint.albedo, 5),
    checkpointEvaporativeFraction: round(checkpoint.evaporativeFraction, 4),
    evaporativeFraction: round(current.evaporativeFraction, 4),
    evaporativeFractionDelta: round(current.evaporativeFraction - checkpoint.evaporativeFraction, 5),
    checkpointRoughnessMeters: round(checkpoint.roughnessMeters, 4),
    roughnessMeters: round(current.roughnessMeters, 4),
    roughnessLogRatio: round(Math.log(current.roughnessMeters / Math.max(0.005, checkpoint.roughnessMeters)), 5),
    moistureRecyclingRatio: round(clamp((current.recyclingPotential + 0.04) / (checkpoint.recyclingPotential + 0.04), 0.25, 3.5), 5),
    epistemicStatus: "deterministic two-pass land-surface response derived from local checkpoint LAI plus first-pass hydroclimate and branch productivity; feeds albedo, evaporative cooling, aerodynamic roughness and terrestrial moisture recycling without geographic outcome rules"
  });
}
