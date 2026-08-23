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
const REGIONAL_STREAM_RADIUS = 4;

export function createSurfacePresentation(canvas) {
  const surface = createBaseSurfacePresentation(canvas);

  // Surface mode is allowed to pull back into a broad aerial view without
  // forcing a return to the globe. Keep the camera, sky and clip plane large
  // enough that the extra zoom range remains a normal surface presentation.
  surface.controls.maxDistance = SURFACE_MAX_DISTANCE_KM;
  surface.camera.far = 4000;
  surface.camera.updateProjectionMatrix();
  surface.sky?.scale?.setScalar?.(5000);

  // The local reconstruction is only the high-detail foreground. Continue it
  // with the same georeferenced Earth used by globe mode, tangent beneath the
  // selection, so distant terrain reaches a curved planetary horizon.
  const planetaryFarField = createSurfacePlanetFarField(surface.scene);

  // A larger camera range needs a wider coarse terrain window or the user would
  // simply reveal the edge of the local map. Expand only the regional band from
  // 5x5 to 9x9 chunks; the landscape/ecology/ground bands retain their existing
  // smaller radii and costs. Concentric LOD still keeps the outer chunks coarse.
  const scaleController = surface.terrain.surfaceScaleController;
  if (scaleController) {
    const baseConfigureTerrain = scaleController._configureTerrain.bind(scaleController);
    scaleController._configureTerrain = (band) => baseConfigureTerrain(
      band?.id === "regional"
        ? { ...band, radius: REGIONAL_STREAM_RADIUS }
        : band
    );

    const baseConfigureAtmosphere = scaleController._configureAtmosphere.bind(scaleController);
    scaleController._configureAtmosphere = (band) => {
      baseConfigureAtmosphere(band);
      if (band?.id === "regional" && surface.scene.fog) {
        surface.scene.fog.near = 300;
        surface.scene.fog.far = 980;
      }
    };
  }

  // Bend the rendered regional terrain onto Earth's mean sphere while keeping
  // science, hydrology and streaming coordinates deterministic in their tangent
  // frame. The far field supplies the rest of that same sphere beyond the detail.
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
      setter({
        centerX: 0,
        centerZ: 0,
        strength: 1,
        radiusKm: EARTH_MEAN_RADIUS_KM
      });
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
    const result = baseTerrainUpdate(cameraPosition);
    planetaryFarField.setOrigin(surface.terrain.origin);
    return result;
  };

  const navigation = installSurfaceNavigationControls({
    camera: surface.camera,
    controls: surface.controls,
    terrain: surface.terrain
  });

  // The app already has a legacy globe gamepad driver whose left stick means
  // orbit. Surface mode uses the same physical controller for translation, so
  // expose one tiny ownership hook that lets that older driver stand down while
  // the surface controls are active. Prewarmed-but-inactive surface runtimes do
  // not claim the gamepad because controls.enabled is still false.
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
      regionalStreamRadius: REGIONAL_STREAM_RADIUS,
      regionalStreamingSpanKm: surface.terrain.chunkSizeKm * (REGIONAL_STREAM_RADIUS * 2 + 1)
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
