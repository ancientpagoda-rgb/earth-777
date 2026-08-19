import * as THREE from "three";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = (value) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

export function beginDescent(view) {
  if (!view.selectionDirection || !view.selection || view.mode !== "globe") return false;
  view.mode = "descent";
  view.controls.enabled = false;
  view.interacting = false;
  view.descent = {
    started: performance.now(),
    duration: 1_950,
    fromPosition: view.camera.position.clone(),
    fromFov: view.camera.fov,
    normal: view.selectionDirection.clone()
  };
  view.onModeChange?.("descent", view.selection);
  view.invalidate();
  return true;
}

export function updateDescent(view, now) {
  if (!view.descent) return false;
  const t = clamp((now - view.descent.started) / view.descent.duration, 0, 1);
  const eased = smoothstep(t);
  const target = view.descent.normal.clone().multiplyScalar(1.505 + (1 - eased) * 0.045);
  view.camera.position.lerpVectors(view.descent.fromPosition, target, eased);
  view.camera.lookAt(0, 0, 0);
  view.camera.fov = view.descent.fromFov + (63 - view.descent.fromFov) * eased;
  view.camera.updateProjectionMatrix();
  if (t < 1) return true;
  enterSurface(view, now);
  return true;
}

export function enterSurface(view, now) {
  view.descent = null;
  view.mode = "surface";
  const { latitude, longitude } = view.selection;
  view.terrain.setOrigin(latitude, longitude);
  view.refreshSurfaceContext?.(true);
  view.applyPerformanceSettings(false);

  const ground = view.terrain.heightAt(0, 0);

  // Regional entry must frame the terrain footprint rather than sit inside it.
  // Begin around 125 km from the selected point and settle near 100 km, giving
  // the ~84 km terrain window enough screen-space margin to read as geography.
  view.surfaceCamera.position.set(12, ground + 78, 96);
  view.surfaceControls.target.set(0, ground + 0.04, 0);
  view.surfaceControls.enabled = false;
  view.updateSurfaceWater();
  view.terrain.update(view.surfaceCamera.position);
  view.terrain.pump(4);

  view.surfaceEntry = {
    started: now,
    duration: 1_950,
    fromPosition: view.surfaceCamera.position.clone(),
    toPosition: new THREE.Vector3(8, ground + 64, 80),
    fromTarget: view.surfaceControls.target.clone(),
    toTarget: new THREE.Vector3(0, ground + 0.02, 0)
  };
  view.onModeChange?.("surface", view.selection);
  view.invalidate();
}

export function updateSurfaceEntry(view, now) {
  if (!view.surfaceEntry) return false;
  const t = clamp((now - view.surfaceEntry.started) / view.surfaceEntry.duration, 0, 1);
  const eased = smoothstep(t);
  view.surfaceCamera.position.lerpVectors(view.surfaceEntry.fromPosition, view.surfaceEntry.toPosition, eased);
  view.surfaceControls.target.lerpVectors(view.surfaceEntry.fromTarget, view.surfaceEntry.toTarget, eased);
  if (t >= 1) {
    view.surfaceEntry = null;
    view.surfaceControls.enabled = true;
  }
  return true;
}

export function returnToGlobe(view) {
  if (view.mode !== "surface") return false;
  view.mode = "globe";
  view.surfaceEntry = null;
  view.surfaceControls.enabled = false;
  view.surfaceEcology?.clear();
  view.camera.fov = 42;
  view.camera.position.copy(view.selectionDirection ?? new THREE.Vector3(0, 0, 1)).multiplyScalar(2.35);
  view.camera.lookAt(0, 0, 0);
  view.camera.updateProjectionMatrix();
  view.controls.target.set(0, 0, 0);
  view.controls.enabled = true;
  view.controls.update();
  view.continuousUntilMs = performance.now() + 700;
  view.onModeChange?.("globe", view.selection);
  view.invalidate();
  return true;
}
