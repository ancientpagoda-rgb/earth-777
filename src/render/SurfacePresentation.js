import { createSurfacePresentation as createBaseSurfacePresentation } from "./SurfacePresentationBase.js";
import { installSurfaceNavigationControls, SURFACE_NAVIGATION_POLICY } from "./SurfaceNavigationControls.js";
import {
  EARTH_MEAN_RADIUS_KM,
  SURFACE_CURVATURE_POLICY,
  surfaceCurvatureBlend
} from "./SurfacePlanetCurvature.js";
import { createSurfacePlanetFarField } from "./SurfacePlanetFarField.js";

export { SURFACE_NAVIGATION_POLICY };

const SURFACE_MAX_DISTANCE_KM = 420;
const SURFACE_PERFORMANCE_BANDS = Object.freeze({
  regional: Object.freeze({ radius: 2, segments: 12 }),
  landscape: Object.freeze({ radius: 2, segments: 16 }),
  ecology: Object.freeze({ radius: 2, segments: 14 }),
  ground: Object.freeze({ radius: 2, segments: 18 })
});

export function surfaceNearClipKm(distanceKm, {
  minimumKm = 0.00005,
  maximumKm = 0.05,
  startKm = 2,
  fullKm = 180
} = {}) {
  const distance = Math.max(0, Number(distanceKm) || 0);
  const start = Math.max(0, Number(startKm) || 0);
  const full = Math.max(start + 1e-6, Number(fullKm) || start + 1);
  const minimum = Math.max(0.000001, Number(minimumKm) || 0.00005);
  const maximum = Math.max(minimum, Number(maximumKm) || minimum);
  const linear = Math.min(1, Math.max(0, (distance - start) / (full - start)));
  const smooth = linear * linear * (3 - 2 * linear);
  return minimum + (maximum - minimum) * smooth;
}

export function createSurfacePresentation(canvas) {
  const surface = createBaseSurfacePresentation(canvas);

  surface.controls.maxDistance = SURFACE_MAX_DISTANCE_KM;
  surface.camera.far = 4000;
  surface.camera.updateProjectionMatrix();
  surface.sky?.scale?.setScalar?.(5000);

  const planetaryFarField = createSurfacePlanetFarField(surface.scene, {
    widthSegments: 64,
    heightSegments: 32
  });

  // Emergency anti-lag profile: keep only a 5x5 local working set at every
  // scale and lower base tessellation. The reconstruction inputs are unchanged;
  // only the amount of simultaneously meshed geometry is reduced.
  const scaleController = surface.terrain.surfaceScaleController;
  if (scaleController) {
    const baseConfigureTerrain = scaleController._configureTerrain.bind(scaleController);
    scaleController._configureTerrain = (band) => {
      const profile = SURFACE_PERFORMANCE_BANDS[band?.id];
      return baseConfigureTerrain(profile ? { ...band, ...profile } : band);
    };

    const baseConfigureAtmosphere = scaleController._configureAtmosphere.bind(scaleController);
    scaleController._configureAtmosphere = (band) => {
      baseConfigureAtmosphere(band);
      if (band?.id === "regional" && surface.scene.fog) {
        surface.scene.fog.near = 220;
        surface.scene.fog.far = 760;
      }
    };
  }

  let curvatureDiagnostics = Object.freeze({
    policy: SURFACE_CURVATURE_POLICY,
    strength: 1,
    cameraStrength: 0,
    distanceKm: 0,
    centerXKm: 0,
    centerZKm: 0,
    radiusKm: EARTH_MEAN_RADIUS_KM,
    materialCount: 0
  });
  const applyPlanetCurvature = () => {
    const target = surface.controls.target;
    const distanceKm = surface.camera.position.distanceTo(target);
    const cameraStrength = surfaceCurvatureBlend(distanceKm);
    const materials = new Set();
    for (const mesh of surface.terrain.chunks?.values?.() ?? []) {
      const material = mesh?.material;
      const setter = material?.userData?.setPlanetCurvature;
      if (typeof setter !== "function" || materials.has(material)) continue;
      materials.add(material);
      setter({ centerX: 0, centerZ: 0, strength: 1, radiusKm: EARTH_MEAN_RADIUS_KM });
    }
    curvatureDiagnostics = Object.freeze({
      policy: SURFACE_CURVATURE_POLICY,
      strength: 1,
      cameraStrength,
      distanceKm,
      centerXKm: 0,
      centerZKm: 0,
      radiusKm: EARTH_MEAN_RADIUS_KM,
      materialCount: materials.size
    });
  };

  const baseTerrainUpdate = surface.terrain.update.bind(surface.terrain);
  surface.terrain.update = (cameraPosition) => {
    applyPlanetCurvature();
    const nextNear = surfaceNearClipKm(surface.camera.position.distanceTo(surface.controls.target));
    if (Math.abs(surface.camera.near - nextNear) > 0.00001) {
      surface.camera.near = nextNear;
      surface.camera.updateProjectionMatrix();
    }
    const result = baseTerrainUpdate(cameraPosition);
    planetaryFarField.setOrigin(surface.terrain.origin);
    return result;
  };

  const navigation = installSurfaceNavigationControls({
    camera: surface.camera,
    controls: surface.controls,
    terrain: surface.terrain
  });

  const previousGamepadOwnership = globalThis.__earth777SurfaceOwnsGamepad;
  globalThis.__earth777SurfaceOwnsGamepad = () => {
    const diagnostics = navigation.diagnostics();
    return Boolean(surface.controls.enabled || diagnostics.exclusiveCameraOwnership);
  };

  const baseDiagnostics = surface.terrain.diagnostics.bind(surface.terrain);
  surface.terrain.diagnostics = () => Object.freeze({
    ...baseDiagnostics(),
    surfaceNavigation: navigation.diagnostics(),
    surfaceCurvature: curvatureDiagnostics,
    planetaryFarField: planetaryFarField.diagnostics(),
    surfaceZoom: Object.freeze({
      maxDistanceKm: SURFACE_MAX_DISTANCE_KM,
      performanceBands: SURFACE_PERFORMANCE_BANDS,
      regionalStreamingSpanKm: surface.terrain.chunkSizeKm * (SURFACE_PERFORMANCE_BANDS.regional.radius * 2 + 1)
    })
  });

  const baseDispose = surface.terrain.dispose.bind(surface.terrain);
  surface.terrain.dispose = () => {
    if (globalThis.__earth777SurfaceOwnsGamepad) {
      if (previousGamepadOwnership === undefined) delete globalThis.__earth777SurfaceOwnsGamepad;
      else globalThis.__earth777SurfaceOwnsGamepad = previousGamepadOwnership;
    }
    navigation.dispose();
    planetaryFarField.dispose();
    baseDispose();
  };

  return { ...surface, navigation, planetaryFarField };
}
