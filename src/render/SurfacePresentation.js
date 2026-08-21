import { createSurfacePresentation as createBaseSurfacePresentation } from "./SurfacePresentationBase.js";
import { installSurfaceNavigationControls, SURFACE_NAVIGATION_POLICY } from "./SurfaceNavigationControls.js";

export { SURFACE_NAVIGATION_POLICY };

export function createSurfacePresentation(canvas) {
  const surface = createBaseSurfacePresentation(canvas);
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
    surfaceNavigation: navigation.diagnostics()
  });

  const baseDispose = surface.terrain.dispose.bind(surface.terrain);
  surface.terrain.dispose = () => {
    if (globalThis.__earth777SurfaceOwnsGamepad) {
      if (previousGamepadOwnership === undefined) delete globalThis.__earth777SurfaceOwnsGamepad;
      else globalThis.__earth777SurfaceOwnsGamepad = previousGamepadOwnership;
    }
    navigation.dispose();
    baseDispose();
  };

  return { ...surface, navigation };
}
