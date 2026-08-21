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

  const baseDiagnostics = surface.terrain.diagnostics.bind(surface.terrain);
  surface.terrain.diagnostics = () => Object.freeze({
    ...baseDiagnostics(),
    surfaceNavigation: navigation.diagnostics()
  });

  const baseDispose = surface.terrain.dispose.bind(surface.terrain);
  surface.terrain.dispose = () => {
    navigation.dispose();
    baseDispose();
  };

  return { ...surface, navigation };
}
