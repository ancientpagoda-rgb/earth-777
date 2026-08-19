import * as THREE from "three";
import { surfaceFrameForBand } from "./SurfaceScaleController.js";

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

function framePosition(frame) {
  return new THREE.Vector3(frame.position.x, frame.position.y, frame.position.z);
}

function frameTarget(frame) {
  return new THREE.Vector3(frame.target.x, frame.target.y, frame.target.z);
}

export function enterSurface(view, now) {
  view.descent = null;
  view.mode = "surface";
  const { latitude, longitude } = view.selection;
  view.terrain.setOrigin(latitude, longitude);
  view.refreshSurfaceContext?.(true);
  view.applyPerformanceSettings(false);
  // Regional entry is a clean landscape by default. Geological/atmospheric
  // structure remains available as an explicit inspection overlay.
  view.terrain.setEarthLayerInspection?.(false);

  const ground = view.terrain.heightAt(0, 0);
  const aspect = Math.max(0.5, Number(view.surfaceCamera.aspect) || 16 / 9);
  const fromFrame = surfaceFrameForBand({
    bandId: "regional",
    fovDegrees: view.surfaceCamera.fov,
    aspect,
    fill: 0.62,
    elevationDegrees: 73,
    azimuthDegrees: 3,
    groundY: ground
  });
  const toFrame = surfaceFrameForBand({
    bandId: "regional",
    fovDegrees: view.surfaceCamera.fov,
    aspect,
    fill: 0.91,
    elevationDegrees: 78,
    azimuthDegrees: 3,
    groundY: ground
  });

  // The regional view now deliberately resembles a satellite/map inspection:
  // nearly overhead, continuously filled, with enough obliquity left for relief.
  view.surfaceCamera.position.copy(framePosition(fromFrame));
  view.surfaceControls.target.copy(frameTarget(fromFrame));
  view.surfaceControls.enabled = false;
  view.updateSurfaceWater();
  view.terrain.update(view.surfaceCamera.position);
  view.terrain.pump(5);

  view.surfaceEntry = {
    started: now,
    duration: 1_850,
    fromPosition: view.surfaceCamera.position.clone(),
    toPosition: framePosition(toFrame),
    fromTarget: view.surfaceControls.target.clone(),
    toTarget: frameTarget(toFrame)
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
