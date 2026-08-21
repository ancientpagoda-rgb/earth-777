import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const activeButton = (button) => Number(button?.value) > 0.15 || button?.pressed === true;
const editableTarget = (target) => typeof HTMLElement !== "undefined"
  && target instanceof HTMLElement
  && Boolean(target.closest("input, textarea, select, button, a, summary, [contenteditable='true']"));

export const SURFACE_NAVIGATION_POLICY = "exclusive-surface-move-look-v6";

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
  for (const pad of navigator.getGamepads()) {
    if (pad?.connected && (pad.axes?.length ?? 0) >= 2 && (pad.buttons?.length ?? 0) >= 4) return pad;
  }
  return null;
}

function calibrateRightStick(state, pad, rawX, rawY) {
  const padKey = `${pad?.index ?? 0}:${pad?.id ?? "gamepad"}`;
  if (state.padKey !== padKey) {
    state.padKey = padKey;
    state.neutralFrames = 0;
    state.armed = false;
  }

  const standard = pad?.mapping === "standard" && (pad?.axes?.length ?? 0) >= 4;
  if (!standard) {
    state.neutralFrames = 0;
    state.armed = false;
    return false;
  }

  if (!state.armed) {
    // Fail closed: right-stick look is allowed only after this controller has
    // demonstrated a genuinely centered right stick for several consecutive polls.
    if (Math.hypot(Number(rawX) || 0, Number(rawY) || 0) <= 0.18) state.neutralFrames += 1;
    else state.neutralFrames = 0;
    if (state.neutralFrames >= 4) state.armed = true;
  }

  return state.armed;
}

function readGamepad(rightStickCalibration = null) {
  const pad = firstConnectedGamepad();
  if (!pad) {
    if (rightStickCalibration) {
      rightStickCalibration.padKey = null;
      rightStickCalibration.neutralFrames = 0;
      rightStickCalibration.armed = false;
    }
    return null;
  }

  const buttons = pad.buttons ?? [];
  const axes = pad.axes ?? [];
  const standard = pad.mapping === "standard";
  const leftX = applyGamepadDeadzone(axes[0] ?? 0, 0.24);
  const leftY = applyGamepadDeadzone(axes[1] ?? 0, 0.24);
  const rawRightX = Number(axes[2]) || 0;
  const rawRightY = Number(axes[3]) || 0;
  const rightStickReady = rightStickCalibration
    ? calibrateRightStick(rightStickCalibration, pad, rawRightX, rawRightY)
    : false;
  const lookX = rightStickReady ? applyGamepadDeadzone(rawRightX, 0.27) : 0;
  const lookY = rightStickReady ? applyGamepadDeadzone(rawRightY, 0.27) : 0;
  const dpadUp = standard && activeButton(buttons[12]) ? 1 : 0;
  const dpadDown = standard && activeButton(buttons[13]) ? 1 : 0;
  const dpadLeft = standard && activeButton(buttons[14]) ? 1 : 0;
  const dpadRight = standard && activeButton(buttons[15]) ? 1 : 0;

  return Object.freeze({
    id: pad.id ?? "gamepad",
    mapping: pad.mapping || "none",
    moveX: clamp(leftX + dpadRight - dpadLeft, -1, 1),
    moveForward: clamp(-leftY + dpadUp - dpadDown, -1, 1),
    lookX,
    lookY,
    rightStickReady,
    precision: standard && activeButton(buttons[4]),
    boost: standard && activeButton(buttons[5])
  });
}

function gamepadHasMovement(input) {
  return Boolean(input && (Math.abs(input.moveX) > 0.01 || Math.abs(input.moveForward) > 0.01));
}

function gamepadHasLook(input) {
  return Boolean(input && (Math.abs(input.lookX) > 0.01 || Math.abs(input.lookY) > 0.01));
}

function gamepadHasActivity(input) {
  return gamepadHasMovement(input) || gamepadHasLook(input);
}

export function installSurfaceNavigationControls({ camera, controls, terrain } = {}) {
  if (!camera || !controls) {
    return Object.freeze({ update: () => false, diagnostics: () => ({ available: false }), dispose() {} });
  }

  const held = new Set();
  const translation = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const savedCamera = new THREE.Vector3();
  const savedTarget = new THREE.Vector3();
  const savedQuaternion = new THREE.Quaternion();
  const lockedOffset = new THREE.Vector3();
  const lockedForward = new THREE.Vector3();
  const lockedRight = new THREE.Vector3();
  const spherical = new THREE.Spherical();
  const rightStickCalibration = { padKey: null, neutralFrames: 0, armed: false };

  let lastDevice = "none";
  let lastSpeedKmPerSecond = 0;
  let lastActive = false;
  let rafId = null;
  let lastFrameMs = 0;
  let disposed = false;
  let ownsCamera = false;
  let previousDamping = true;

  const movementKeys = new Set([
    "KeyW", "KeyA", "KeyS", "KeyD",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"
  ]);
  const zoomKeys = new Set(["PageUp", "PageDown", "Equal", "Minus", "NumpadAdd", "NumpadSubtract"]);
  const modifierKeys = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight"]);
  const relevantKeys = new Set([...movementKeys, ...zoomKeys, ...modifierKeys]);
  const actionKeys = new Set([...movementKeys, ...zoomKeys]);

  const controlsAvailable = () => controls.enabled || ownsCamera;
  const keyboardHasActivity = () => [...actionKeys].some((code) => held.has(code));
  const keyboardHasMovement = () => [...movementKeys].some((code) => held.has(code));
  const inputHasActivity = () => keyboardHasActivity() || gamepadHasActivity(readGamepad(rightStickCalibration));
  const ownershipHasActivity = () => {
    const gamepad = readGamepad(rightStickCalibration);
    return keyboardHasMovement() || gamepadHasMovement(gamepad) || gamepadHasLook(gamepad);
  };
  const wake = () => controls.dispatchEvent({ type: "change" });

  const keyboardAxis = (positiveCodes, negativeCodes) => {
    let value = 0;
    if (positiveCodes.some((code) => held.has(code))) value += 1;
    if (negativeCodes.some((code) => held.has(code))) value -= 1;
    return value;
  };

  const updateLockedHeading = () => {
    lockedForward.copy(controls.target).sub(camera.position);
    lockedForward.y = 0;
    if (lockedForward.lengthSq() < 1e-8) lockedForward.set(0, 0, -1);
    else lockedForward.normalize();
    lockedRight.copy(lockedForward).cross(UP).normalize();
  };

  const acquireCameraOwnership = () => {
    if (ownsCamera || !controls.enabled) return ownsCamera;

    savedCamera.copy(camera.position);
    savedTarget.copy(controls.target);
    savedQuaternion.copy(camera.quaternion);
    previousDamping = Boolean(controls.enableDamping);

    // Flush any residual OrbitControls damping, then restore the exact visible pose.
    controls.enableDamping = false;
    controls.update?.();
    camera.position.copy(savedCamera);
    controls.target.copy(savedTarget);
    camera.quaternion.copy(savedQuaternion);

    lockedOffset.subVectors(camera.position, controls.target);
    updateLockedHeading();

    // Surface keyboard/gamepad input becomes the sole camera writer while active.
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
  };

  const orbitSurface = (lookX, lookY, deltaSeconds) => {
    if (Math.hypot(lookX, lookY) < 1e-5 || !acquireCameraOwnership()) return false;

    spherical.setFromVector3(lockedOffset);
    spherical.theta -= lookX * 1.55 * deltaSeconds;
    spherical.phi = clamp(
      spherical.phi + lookY * 1.15 * deltaSeconds,
      Math.max(0.08, Number(controls.minPolarAngle) || 0.08),
      Math.min(Math.PI * 0.495, Number(controls.maxPolarAngle) || Math.PI * 0.495)
    );
    lockedOffset.setFromSpherical(spherical);
    camera.position.copy(controls.target).add(lockedOffset);
    camera.lookAt(controls.target);
    updateLockedHeading();
    return true;
  };

  const translateSurface = (moveX, moveForward, distanceKm) => {
    const magnitude = Math.hypot(moveX, moveForward);
    if (magnitude < 1e-5 || !(distanceKm > 0) || !acquireCameraOwnership()) return false;

    const scale = magnitude > 1 ? 1 / magnitude : 1;
    const oldX = controls.target.x;
    const oldZ = controls.target.z;
    translation.set(0, 0, 0)
      .addScaledVector(lockedForward, moveForward * scale * distanceKm)
      .addScaledVector(lockedRight, moveX * scale * distanceKm);

    controls.target.add(translation);
    followTerrainElevation(oldX, oldZ);
    camera.position.copy(controls.target).add(lockedOffset);
    camera.lookAt(controls.target);
    return true;
  };

  const zoomSurface = (zoomInput, deltaSeconds) => {
    if (Math.abs(zoomInput) < 1e-5 || ownsCamera) return false;
    offset.subVectors(camera.position, controls.target);
    const current = Math.max(1e-8, offset.length());
    const next = clamp(
      current * Math.exp(zoomInput * 1.9 * deltaSeconds),
      Number(controls.minDistance) || 0.00035,
      Number(controls.maxDistance) || 420
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
    const gamepad = readGamepad(rightStickCalibration);
    const keyboardMoveX = keyboardAxis(["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]);
    const keyboardForward = keyboardAxis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]);
    const moveX = clamp(keyboardMoveX + (gamepad?.moveX ?? 0), -1, 1);
    const moveForward = clamp(keyboardForward + (gamepad?.moveForward ?? 0), -1, 1);
    const lookX = gamepad?.lookX ?? 0;
    const lookY = gamepad?.lookY ?? 0;
    const hasMovement = Math.hypot(moveX, moveForward) > 0.01;
    const hasLook = Math.hypot(lookX, lookY) > 0.01;

    if (!hasMovement && !hasLook && ownsCamera) releaseCameraOwnership();

    // Apply look before movement so forward travel immediately follows the new heading.
    const orbited = hasLook ? orbitSurface(lookX, lookY, dt) : false;

    const boost = held.has("ShiftLeft") || held.has("ShiftRight") || Boolean(gamepad?.boost);
    const precision = held.has("ControlLeft") || held.has("ControlRight") || Boolean(gamepad?.precision);
    const speed = surfaceTravelSpeedKmPerSecond(camera.position.distanceTo(controls.target), { boost, precision });
    const translated = hasMovement ? translateSurface(moveX, moveForward, speed * dt) : false;

    // Keyboard zoom remains available when movement/look do not own the camera.
    const keyboardZoom = keyboardAxis(["PageDown", "Minus", "NumpadSubtract"], ["PageUp", "Equal", "NumpadAdd"]);
    const zoomed = zoomSurface(keyboardZoom, dt);
    const active = translated || orbited || zoomed;

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

    const dt = lastFrameMs > 0 ? Math.min(0.08, Math.max(0.001, (now - lastFrameMs) / 1000)) : 1 / 60;
    lastFrameMs = now;
    update(dt);
    if (!disposed && controlsAvailable() && inputHasActivity()) rafId = requestAnimationFrame(driveFrame);
    else {
      if (ownsCamera && !ownershipHasActivity()) releaseCameraOwnership();
      lastFrameMs = 0;
    }
  };

  const ensureDriveLoop = () => {
    if (disposed || rafId != null || !controlsAvailable() || !inputHasActivity() || typeof requestAnimationFrame !== "function") return;
    rafId = requestAnimationFrame(driveFrame);
  };

  // Capture-phase ownership is deliberate. main.js still has legacy globe
  // shortcuts (notably KeyS -> Sources and arrows -> orbit). Surface navigation
  // must consume these keys before that bubble-phase handler sees them.
  const onKeyDown = (event) => {
    if (!controlsAvailable() || editableTarget(event.target) || event.metaKey || event.altKey) return;
    if (!relevantKeys.has(event.code)) return;
    held.add(event.code);
    if (actionKeys.has(event.code)) event.preventDefault();
    event.stopPropagation();
    wake();
    ensureDriveLoop();
  };

  const onKeyUp = (event) => {
    if (!relevantKeys.has(event.code)) return;
    if (controlsAvailable()) {
      if (actionKeys.has(event.code)) event.preventDefault();
      event.stopPropagation();
    }
    held.delete(event.code);
    if (ownsCamera && !ownershipHasActivity()) releaseCameraOwnership();
  };

  const onBlur = () => {
    held.clear();
    releaseCameraOwnership();
  };

  addEventListener("keydown", onKeyDown, { passive: false, capture: true });
  addEventListener("keyup", onKeyUp, { passive: false, capture: true });
  addEventListener("blur", onBlur);

  const gamepadWakeTimer = setInterval(() => {
    const gamepad = readGamepad(rightStickCalibration);
    if (!controlsAvailable() || !gamepadHasActivity(gamepad)) {
      if (ownsCamera && !keyboardHasMovement() && !gamepadHasActivity(gamepad)) releaseCameraOwnership();
      return;
    }
    wake();
    ensureDriveLoop();
  }, 50);

  const diagnostics = () => {
    const gamepad = readGamepad(rightStickCalibration);
    return Object.freeze({
      available: true,
      policy: SURFACE_NAVIGATION_POLICY,
      keyboard: "WASD/arrows move; Shift boost; Ctrl precision; PageUp/PageDown zoom",
      gamepad: "left stick/D-pad move; right stick view; LB precision; RB boost",
      gamepadConnected: Boolean(gamepad),
      gamepadId: gamepad?.id ?? null,
      gamepadMapping: gamepad?.mapping ?? null,
      rightStickReady: Boolean(gamepad?.rightStickReady),
      controllerCameraControl: Boolean(gamepad?.rightStickReady),
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
      removeEventListener("keydown", onKeyDown, true);
      removeEventListener("keyup", onKeyUp, true);
      removeEventListener("blur", onBlur);
      held.clear();
    }
  });
}
