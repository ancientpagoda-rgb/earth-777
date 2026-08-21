import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const activeButton = (button) => Number(button?.value) > 0.15 || button?.pressed === true;
const editableTarget = (target) => typeof HTMLElement !== "undefined" && target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, button, a, summary, [contenteditable='true']"));

export const SURFACE_NAVIGATION_POLICY = "exclusive-camera-translation-gamepad-v4";

export function applyGamepadDeadzone(value, deadzone = 0.16) {
  const input = clamp(value, -1, 1);
  const threshold = clamp(deadzone, 0, 0.7);
  const magnitude = Math.abs(input);
  if (magnitude <= threshold) return 0;
  return Math.sign(input) * ((magnitude - threshold) / Math.max(1e-6, 1 - threshold));
}

export function surfaceTravelSpeedKmPerSecond(cameraDistanceKm, { boost = false, precision = false } = {}) {
  let speed = clamp(Number(cameraDistanceKm) * 0.28, 0.003, 24);
  if (boost) speed *= 4;
  if (precision) speed *= 0.24;
  return speed;
}

function firstConnectedGamepad() {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return null;
  const pads = navigator.getGamepads();
  for (const pad of pads) {
    if (!pad?.connected) continue;
    if (pad.axes?.length >= 2 && pad.buttons?.length >= 4) return pad;
  }
  return null;
}

function readGamepad() {
  const pad = firstConnectedGamepad();
  if (!pad) return null;
  const buttons = pad.buttons ?? [];
  const axes = pad.axes ?? [];
  const standard = pad.mapping === "standard";
  const leftX = applyGamepadDeadzone(axes[0] ?? 0, 0.24);
  const leftY = applyGamepadDeadzone(axes[1] ?? 0, 0.24);
  const dpadUp = standard && activeButton(buttons[12]) ? 1 : 0;
  const dpadDown = standard && activeButton(buttons[13]) ? 1 : 0;
  const dpadLeft = standard && activeButton(buttons[14]) ? 1 : 0;
  const dpadRight = standard && activeButton(buttons[15]) ? 1 : 0;

  return Object.freeze({
    id: pad.id ?? "gamepad",
    mapping: pad.mapping || "none",
    moveX: clamp(leftX + dpadRight - dpadLeft, -1, 1),
    moveForward: clamp(-leftY + dpadUp - dpadDown, -1, 1),
    precision: standard && activeButton(buttons[4]),
    boost: standard && activeButton(buttons[5])
  });
}

function gamepadHasActivity(input) {
  return Boolean(input && (Math.abs(input.moveX) > 0.01 || Math.abs(input.moveForward) > 0.01));
}

export function installSurfaceNavigationControls({ camera, controls, terrain } = {}) {
  if (!camera || !controls) return Object.freeze({ update: () => false, diagnostics: () => ({ available: false }), dispose() {} });

  const held = new Set();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const translation = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const savedCamera = new THREE.Vector3();
  const savedTarget = new THREE.Vector3();
  const savedQuaternion = new THREE.Quaternion();
  const lockedOffset = new THREE.Vector3();
  const lockedForward = new THREE.Vector3();
  const lockedRight = new THREE.Vector3();
  let lastDevice = "none";
  let lastSpeedKmPerSecond = 0;
  let lastActive = false;
  let rafId = null;
  let lastFrameMs = 0;
  let disposed = false;
  let ownsCamera = false;
  let previousDamping = true;

  const relevantKeys = new Set([
    "KeyW", "KeyA", "KeyS", "KeyD",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
    "PageUp", "PageDown", "Equal", "Minus", "NumpadAdd", "NumpadSubtract"
  ]);
  const movementKeys = new Set([
    "KeyW", "KeyA", "KeyS", "KeyD",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"
  ]);
  const actionKeys = new Set([
    ...movementKeys,
    "PageUp", "PageDown", "Equal", "Minus", "NumpadAdd", "NumpadSubtract"
  ]);

  const wake = () => controls.dispatchEvent({ type: "change" });
  const keyboardHasActivity = () => [...actionKeys].some((code) => held.has(code));
  const keyboardHasMovement = () => [...movementKeys].some((code) => held.has(code));
  const inputHasActivity = () => keyboardHasActivity() || gamepadHasActivity(readGamepad());
  const movementHasActivity = () => keyboardHasMovement() || gamepadHasActivity(readGamepad());
  const controlsAvailable = () => controls.enabled || ownsCamera;

  const keyboardAxis = (positiveCodes, negativeCodes) => {
    let value = 0;
    if (positiveCodes.some((code) => held.has(code))) value += 1;
    if (negativeCodes.some((code) => held.has(code))) value -= 1;
    return value;
  };

  const acquireCameraOwnership = () => {
    if (ownsCamera || !controls.enabled) return ownsCamera;

    // OrbitControls may still contain private spherical/pan damping deltas from a
    // preceding mouse gesture. Run one non-damped update to zero those internals,
    // but restore the exact visible pose afterward so clearing inertia is invisible.
    savedCamera.copy(camera.position);
    savedTarget.copy(controls.target);
    savedQuaternion.copy(camera.quaternion);
    previousDamping = Boolean(controls.enableDamping);
    controls.enableDamping = false;
    controls.update?.();
    camera.position.copy(savedCamera);
    controls.target.copy(savedTarget);
    camera.quaternion.copy(savedQuaternion);

    lockedOffset.subVectors(camera.position, controls.target);
    lockedForward.copy(controls.target).sub(camera.position);
    lockedForward.y = 0;
    if (lockedForward.lengthSq() < 1e-8) lockedForward.set(0, 0, -1);
    else lockedForward.normalize();
    lockedRight.copy(lockedForward).cross(UP).normalize();

    // EarthView only calls OrbitControls.update() when enabled. Disable it while
    // travel owns the camera so there can be no second writer rotating the pose.
    controls.enabled = false;
    ownsCamera = true;
    return true;
  };

  const releaseCameraOwnership = () => {
    if (!ownsCamera) return;
    ownsCamera = false;
    controls.enabled = true;
    controls.enableDamping = previousDamping;
    lastSpeedKmPerSecond = 0;
    wake();
  };

  const followTerrainElevation = (oldX, oldZ) => {
    if (!terrain?.heightAt) return;
    const oldGround = Number(terrain.heightAt(oldX, oldZ));
    const newGround = Number(terrain.heightAt(controls.target.x, controls.target.z));
    if (!Number.isFinite(oldGround) || !Number.isFinite(newGround)) return;
    const deltaY = clamp(newGround - oldGround, -2, 2);
    controls.target.y += deltaY;
    camera.position.y += deltaY;
  };

  const translateSurface = (moveX, moveForward, distanceKm) => {
    const magnitude = Math.hypot(moveX, moveForward);
    if (magnitude < 1e-5 || !(distanceKm > 0)) return false;
    if (!acquireCameraOwnership()) return false;

    const scale = magnitude > 1 ? 1 / magnitude : 1;
    const oldX = controls.target.x;
    const oldZ = controls.target.z;

    translation.set(0, 0, 0)
      .addScaledVector(lockedForward, moveForward * scale * distanceKm)
      .addScaledVector(lockedRight, moveX * scale * distanceKm);

    controls.target.add(translation);
    camera.position.add(translation);
    followTerrainElevation(oldX, oldZ);

    // Hard invariant: a travel frame may change position, never camera-to-target
    // orientation. Reapply the offset captured when travel began every frame.
    camera.position.copy(controls.target).add(lockedOffset);
    return true;
  };

  const zoomSurface = (zoomInput, deltaSeconds) => {
    if (Math.abs(zoomInput) < 1e-5 || ownsCamera) return false;
    offset.subVectors(camera.position, controls.target);
    const current = Math.max(1e-8, offset.length());
    const next = clamp(
      current * Math.exp(zoomInput * 1.9 * deltaSeconds),
      Number(controls.minDistance) || 0.00035,
      Number(controls.maxDistance) || 220
    );
    offset.setLength(next);
    camera.position.copy(controls.target).add(offset);
    return true;
  };

  const update = (deltaSeconds = 1 / 60) => {
    if (!controlsAvailable()) {
      lastActive = false;
      lastSpeedKmPerSecond = 0;
      return false;
    }

    const dt = clamp(deltaSeconds, 0, 0.08);
    const gamepad = readGamepad();
    const keyboardMoveX = keyboardAxis(["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]);
    const keyboardForward = keyboardAxis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]);
    const moveX = clamp(keyboardMoveX + (gamepad?.moveX ?? 0), -1, 1);
    const moveForward = clamp(keyboardForward + (gamepad?.moveForward ?? 0), -1, 1);
    const hasMovement = Math.hypot(moveX, moveForward) > 0.01;

    if (!hasMovement && ownsCamera) releaseCameraOwnership();

    const boost = held.has("ShiftLeft") || held.has("ShiftRight") || Boolean(gamepad?.boost);
    const precision = held.has("ControlLeft") || held.has("ControlRight") || Boolean(gamepad?.precision);
    const cameraDistance = camera.position.distanceTo(controls.target);
    const speed = surfaceTravelSpeedKmPerSecond(cameraDistance, { boost, precision });
    const translated = hasMovement ? translateSurface(moveX, moveForward, speed * dt) : false;

    // Controller look/zoom stay disabled. Keyboard zoom operates only when travel
    // does not own the camera, keeping camera ownership single-writer at all times.
    const keyboardZoom = keyboardAxis(["PageDown", "Minus", "NumpadSubtract"], ["PageUp", "Equal", "NumpadAdd"]);
    const zoomed = zoomSurface(keyboardZoom, dt);

    const active = translated || zoomed;
    lastActive = active;
    lastSpeedKmPerSecond = translated ? speed : 0;
    if (active) {
      lastDevice = gamepadHasActivity(gamepad) ? "gamepad" : "keyboard";
      wake();
    }
    return active;
  };

  const driveFrame = (now) => {
    rafId = null;
    if (disposed || !controlsAvailable() || !inputHasActivity()) {
      if (ownsCamera) releaseCameraOwnership();
      lastFrameMs = 0;
      lastActive = false;
      return;
    }
    const deltaSeconds = lastFrameMs > 0 ? Math.min(0.08, Math.max(0.001, (now - lastFrameMs) / 1000)) : 1 / 60;
    lastFrameMs = now;
    update(deltaSeconds);
    if (!disposed && controlsAvailable() && inputHasActivity()) rafId = requestAnimationFrame(driveFrame);
    else {
      if (ownsCamera && !movementHasActivity()) releaseCameraOwnership();
      lastFrameMs = 0;
    }
  };

  const ensureDriveLoop = () => {
    if (disposed || rafId != null || !controlsAvailable() || !inputHasActivity() || typeof requestAnimationFrame !== "function") return;
    rafId = requestAnimationFrame(driveFrame);
  };

  const onKeyDown = (event) => {
    if ((!controls.enabled && !ownsCamera) || editableTarget(event.target) || event.metaKey || event.altKey) return;
    if (!relevantKeys.has(event.code)) return;
    held.add(event.code);
    if (event.code.startsWith("Arrow") || event.code.startsWith("Page")) event.preventDefault();
    wake();
    ensureDriveLoop();
  };
  const onKeyUp = (event) => {
    if (!relevantKeys.has(event.code)) return;
    held.delete(event.code);
    if (ownsCamera && !movementHasActivity()) releaseCameraOwnership();
  };
  const onBlur = () => {
    held.clear();
    releaseCameraOwnership();
  };

  addEventListener("keydown", onKeyDown, { passive: false });
  addEventListener("keyup", onKeyUp);
  addEventListener("blur", onBlur);

  const gamepadWakeTimer = setInterval(() => {
    const gamepad = readGamepad();
    if ((!controls.enabled && !ownsCamera) || !gamepadHasActivity(gamepad)) {
      if (ownsCamera && !keyboardHasMovement() && !gamepadHasActivity(gamepad)) releaseCameraOwnership();
      return;
    }
    wake();
    ensureDriveLoop();
  }, 50);

  const diagnostics = () => {
    const gamepad = readGamepad();
    return Object.freeze({
      available: true,
      policy: SURFACE_NAVIGATION_POLICY,
      keyboard: "WASD/arrows move; Shift boost; Ctrl precision; PageUp/PageDown zoom",
      gamepad: "left stick/D-pad move only; LB precision; RB boost; camera look disabled",
      gamepadConnected: Boolean(gamepad),
      gamepadId: gamepad?.id ?? null,
      gamepadMapping: gamepad?.mapping ?? null,
      controllerCameraControl: false,
      exclusiveCameraOwnership: ownsCamera,
      active: lastActive,
      lastDevice,
      speedKmPerSecond: lastSpeedKmPerSecond
    });
  };

  return Object.freeze({
    update,
    diagnostics,
    dispose() {
      disposed = true;
      clearInterval(gamepadWakeTimer);
      if (rafId != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
      rafId = null;
      releaseCameraOwnership();
      removeEventListener("keydown", onKeyDown);
      removeEventListener("keyup", onKeyUp);
      removeEventListener("blur", onBlur);
      held.clear();
    }
  });
}
