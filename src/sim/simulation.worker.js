import { FreeEarthEngine } from "./free-earth.js";

let engine = null;

function diagnostics() {
  return engine?.fidelityDiagnostics?.() ?? { targets: [] };
}

function postState(type, requestId, version, startedAt) {
  self.postMessage({
    type,
    requestId,
    version,
    state: engine.snapshot(),
    fidelity: diagnostics(),
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
        postState("ready", requestId, version, startedAt);
        break;
      }
      case "advance": {
        if (!engine) throw new Error("Simulation worker was not initialized");
        engine.advance(Math.max(0, Number(message.years) || 0));
        postState("advance", requestId, version, startedAt);
        break;
      }
      case "seek": {
        if (!engine) throw new Error("Simulation worker was not initialized");
        engine.seek(Number(message.elapsedYears) || 0);
        postState("seek", requestId, version, startedAt);
        break;
      }
      case "reset": {
        if (!engine) engine = new FreeEarthEngine(Number(message.seed) >>> 0);
        else engine.reset(Number(message.seed) >>> 0);
        engine.setObserverRelevance({});
        postState("reset", requestId, version, startedAt);
        break;
      }
      case "observer-relevance": {
        if (!engine) throw new Error("Simulation worker was not initialized");
        engine.setObserverRelevance(message.observerRelevance ?? {});
        self.postMessage({
          type: "fidelity",
          requestId,
          version,
          fidelity: diagnostics(),
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
