const DEFAULT_DEADZONE = 0.18;
const BUTTON_THRESHOLD = 0.35;
const IDLE_GAMEPAD_POLL_MS = 66;

export const POINTER_HINT = "DRAG TO ORBIT · SCROLL TO ZOOM · CLICK TO SELECT";
export const KEYBOARD_HINT = "KEYS: ARROWS ORBIT · +/- ZOOM · ENTER SELECT · F DESCEND · SPACE PLAY · S SOURCES";
export const GAMEPAD_HINT = `${POINTER_HINT} · GAMEPAD: LEFT STICK ORBIT · RIGHT STICK OR TRIGGERS ZOOM · A SELECT · X DESCEND · START PLAY`;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function applyDeadzone(value, deadzone = DEFAULT_DEADZONE) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(value) * clamp(scaled, 0, 1);
}

export function buttonValue(button) {
  if (button == null) return 0;
  if (typeof button === "number") return clamp(button, 0, 1);
  if (button.pressed) return 1;
  return clamp(button.value ?? 0, 0, 1);
}

export function isPressed(button, threshold = BUTTON_THRESHOLD) {
  return buttonValue(button) >= threshold;
}

export function pickGamepad(gamepads, preferredIndex = null) {
  if (preferredIndex != null) {
    const preferred = gamepads[preferredIndex];
    if (preferred?.connected) return preferred;
  }
  return gamepads.find((gamepad) => gamepad?.connected) ?? null;
}

export function readGamepadState(gamepad) {
  const orbitX = applyDeadzone(gamepad?.axes?.[0] ?? 0);
  const orbitY = applyDeadzone(gamepad?.axes?.[1] ?? 0);
  const rightY = applyDeadzone(gamepad?.axes?.[3] ?? 0);
  const triggerZoom = buttonValue(gamepad?.buttons?.[6]) - buttonValue(gamepad?.buttons?.[7]);
  const zoom = clamp(Math.abs(rightY) > Math.abs(triggerZoom) ? rightY : triggerZoom, -1, 1);
  const pressedButtons = Array.from(gamepad?.buttons ?? [], (button) => isPressed(button));

  return { orbitX, orbitY, zoom, pressedButtons };
}

export class GamepadDriver {
  constructor(handlers = {}) {
    this.handlers = handlers;
    // Public `connected` means the controller currently needs full-rate frames.
    // Physical connection is tracked separately so an idle plugged-in controller
    // no longer forces the whole renderer to run at 60 FPS forever.
    this.connected = false;
    this.physicallyConnected = false;
    this.connectedIndex = null;
    this.lastId = "";
    this.previousButtons = [];

    // Gamepad API has no stick-movement event. Poll cheaply while idle, then the
    // existing main RAF loop takes over immediately once activity is detected.
    this.idlePollTimer = typeof setInterval === "function"
      ? setInterval(() => {
          if (!this.connected) this.update(IDLE_GAMEPAD_POLL_MS / 1000);
        }, IDLE_GAMEPAD_POLL_MS)
      : null;
  }

  update(deltaSeconds) {
    const getGamepads = globalThis.navigator?.getGamepads?.bind(globalThis.navigator);
    const gamepad = getGamepads ? pickGamepad(Array.from(getGamepads()), this.connectedIndex) : null;

    if (!gamepad) {
      this.connected = false;
      if (this.physicallyConnected) {
        this.physicallyConnected = false;
        this.connectedIndex = null;
        this.lastId = "";
        this.previousButtons = [];
        this.handlers.onConnectionChange?.(false, null);
      }
      return false;
    }

    if (!this.physicallyConnected || this.connectedIndex !== gamepad.index || this.lastId !== gamepad.id) {
      this.physicallyConnected = true;
      this.connectedIndex = gamepad.index;
      this.lastId = gamepad.id;
      this.handlers.onConnectionChange?.(true, gamepad);
    }

    const state = readGamepadState(gamepad);
    const surfaceOwnsGamepad = globalThis.__earth777SurfaceOwnsGamepad?.() === true;
    const axisActive = !surfaceOwnsGamepad && Boolean(state.orbitX || state.orbitY || state.zoom);
    const buttonsActive = state.pressedButtons.some(Boolean);

    if (!surfaceOwnsGamepad && (state.orbitX || state.orbitY)) {
      this.handlers.onOrbit?.({ x: state.orbitX, y: state.orbitY, deltaSeconds, gamepad });
    }
    if (!surfaceOwnsGamepad && state.zoom) {
      this.handlers.onZoom?.({ value: state.zoom, deltaSeconds, gamepad });
    }

    this._dispatchEdge(state.pressedButtons, 0, () => this.handlers.onSelect?.(gamepad));
    this._dispatchEdge(state.pressedButtons, 1, () => this.handlers.onBack?.(gamepad));
    this._dispatchEdge(state.pressedButtons, 2, () => this.handlers.onFocus?.(gamepad));
    this._dispatchEdge(state.pressedButtons, 3, () => this.handlers.onToggleSources?.(gamepad));
    this._dispatchEdge(state.pressedButtons, 4, () => this.handlers.onPreviousSpeed?.(gamepad));
    this._dispatchEdge(state.pressedButtons, 5, () => this.handlers.onNextSpeed?.(gamepad));
    this._dispatchEdge(state.pressedButtons, 9, () => this.handlers.onTogglePlay?.(gamepad));
    this._dispatchEdge(state.pressedButtons, 14, () => this.handlers.onTimelineStep?.(-1, gamepad));
    this._dispatchEdge(state.pressedButtons, 15, () => this.handlers.onTimelineStep?.(1, gamepad));

    this.previousButtons = state.pressedButtons;
    this.connected = axisActive || buttonsActive;
    return this.connected;
  }

  _dispatchEdge(buttons, index, handler) {
    if (buttons[index] && !this.previousButtons[index]) handler();
  }
}
