import { FreeEarthEngine } from "./free-earth.js";

let engine = null;
let lastPostedState = null;
let lastFidelitySignature = "";

function diagnostics() {
  return engine?.fidelityDiagnostics?.() ?? { targets: [] };
}

function valueSignature(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.stringify(value);
}

function statePatch(previous, next) {
  if (!previous) return { ...next };
  const patch = {};
  for (const [key, value] of Object.entries(next)) {
    if (!Object.is(valueSignature(previous[key]), valueSignature(value))) patch[key] = value;
  }
  return patch;
}

function rememberState(state) {
  lastPostedState = typeof structuredClone === "function"
    ? structuredClone(state)
    : JSON.parse(JSON.stringify(state));
}

function fidelityPayload() {
  const fidelity = diagnostics();
  const signature = JSON.stringify(fidelity);
  if (signature === lastFidelitySignature) return {};
  lastFidelitySignature = signature;
  return { fidelity };
}

function postState(type, requestId, version, startedAt) {
  const state = engine.snapshot();
  const incremental = type === "advance" && lastPostedState != null;
  const patch = incremental ? statePatch(lastPostedState, state) : null;
  rememberState(state);
  self.postMessage({
    type,
    requestId,
    version,
    ...(incremental ? { statePatch: patch, stateMode: "delta", patchKeys: Object.keys(patch).length } : { state, stateMode: "full" }),
    ...fidelityPayload(),
    durationMs: performance.now() - startedAt
  });
}

self.addEventListener("message", (event) => {
  const message = event.data ?? {};
  const requestId = Number(message.requestId) || 0;
  const version = Number(message.version) || 0;
  const startedAt = performance.now();

  try {
    switch (message.type) {
      case "init": {
        engine = new FreeEarthEngine(Number(message.seed) >>> 0);
        lastPostedState = null;
        lastFidelitySignature = "";
        postState("ready", requestId, version, startedAt);
        break;
      }
      case "advance": {
        if (!engine) throw new Error("Simulation worker was not initialized");
        engine.advance(Math.max(0, Number(message.years) || 0), {
          maxStepYears: Math.max(25, Number(message.maxStepYears) || 25)
        });
        postState("advance", requestId, version, startedAt);
        break;
      }
      case "seek": {
        if (!engine) throw new Error("Simulation worker was not initialized");
        engine.seek(Number(message.elapsedYears) || 0);
        lastPostedState = null;
        postState("seek", requestId, version, startedAt);
        break;
      }
      case "reset": {
        if (!engine) engine = new FreeEarthEngine(Number(message.seed) >>> 0);
        else engine.reset(Number(message.seed) >>> 0);
        engine.setObserverRelevance({});
        lastPostedState = null;
        lastFidelitySignature = "";
        postState("reset", requestId, version, startedAt);
        break;
      }
      case "observer-relevance": {
        if (!engine) throw new Error("Simulation worker was not initialized");
        engine.setObserverRelevance(message.observerRelevance ?? {});
        const fidelity = diagnostics();
        lastFidelitySignature = JSON.stringify(fidelity);
        self.postMessage({
          type: "fidelity",
          requestId,
          version,
          fidelity,
          durationMs: performance.now() - startedAt
        });
        break;
      }
      default:
        throw new Error(`Unknown simulation worker message: ${String(message.type)}`);
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      version,
      sourceType: message.type,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
