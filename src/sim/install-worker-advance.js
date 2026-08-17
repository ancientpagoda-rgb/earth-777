import { EarthView } from "../render/earth-view.js";
import { FreeEarthEngine } from "./free-earth.js";
import { SimulationWorkerClient } from "./SimulationWorkerClient.js";

const BRIDGE = Symbol.for("earth777.simulationWorkerBridge");
const INSTALL = Symbol.for("earth777.simulationWorkerAdvanceInstalled");
const activeBridges = new Set();

const prototype = FreeEarthEngine.prototype;

if (!prototype[INSTALL]) {
  const originalAdvance = prototype.advance;
  const originalSeek = prototype.seek;
  const originalReset = prototype.reset;
  const originalSnapshot = prototype.snapshot;
  const originalFidelityDiagnostics = prototype.fidelityDiagnostics;
  const originalSetObserverRelevance = prototype.setObserverRelevance;

  function canUseWorker() {
    return typeof Worker === "function";
  }

  function ensureBridge(engine) {
    if (!canUseWorker()) return null;
    if (engine[BRIDGE]) return engine[BRIDGE];

    const bridge = {
      client: null,
      ready: false,
      pendingBeforeReady: 0,
      latestSnapshot: originalSnapshot.call(engine),
      fidelity: originalFidelityDiagnostics.call(engine),
      observerRelevance: {},
      lastWorkerMs: 0
    };

    bridge.client = new SimulationWorkerClient({
      seed: engine.seed,
      onState: (result) => {
        bridge.latestSnapshot = result.state;
        bridge.fidelity = result.fidelity ?? bridge.fidelity;
        bridge.lastWorkerMs = result.durationMs;
      },
      onFidelity: (fidelity) => {
        if (fidelity) bridge.fidelity = fidelity;
      },
      onError: (error) => console.error("Simulation worker failed; future advances will fall back to the main thread.", error)
    });

    bridge.client.ready
      .then(async () => {
        const elapsedYears = Number(bridge.latestSnapshot?.elapsedYears) || 0;
        if (elapsedYears > 0) await bridge.client.seek(elapsedYears);
        if (Object.keys(bridge.observerRelevance).length) {
          await bridge.client.setObserverRelevance(bridge.observerRelevance);
        }
        bridge.ready = true;
        if (bridge.pendingBeforeReady > 0) {
          bridge.client.queueAdvance(bridge.pendingBeforeReady);
          bridge.pendingBeforeReady = 0;
        }
      })
      .catch((error) => {
        activeBridges.delete(bridge);
        engine[BRIDGE] = null;
        console.error("Simulation worker initialization failed; using main-thread simulation.", error);
      });

    engine[BRIDGE] = bridge;
    activeBridges.add(bridge);
    return bridge;
  }

  prototype.advance = function advanceInWorker(years) {
    if (!canUseWorker()) return originalAdvance.call(this, years);
    const delta = Math.max(0, Number(years) || 0);
    if (!delta) return this.snapshot();
    const bridge = ensureBridge(this);
    if (!bridge) return originalAdvance.call(this, delta);
    if (bridge.ready) bridge.client.queueAdvance(delta);
    else bridge.pendingBeforeReady += delta;
    return bridge.latestSnapshot;
  };

  prototype.snapshot = function workerAwareSnapshot() {
    return this[BRIDGE]?.latestSnapshot ?? originalSnapshot.call(this);
  };

  prototype.fidelityDiagnostics = function workerAwareFidelityDiagnostics() {
    return this[BRIDGE]?.fidelity ?? originalFidelityDiagnostics.call(this);
  };

  prototype.setObserverRelevance = function workerAwareObserverRelevance(observerRelevance = {}) {
    const result = originalSetObserverRelevance.call(this, observerRelevance);
    const bridge = ensureBridge(this);
    if (bridge) {
      bridge.observerRelevance = { ...observerRelevance };
      bridge.fidelity = result;
      bridge.client.setObserverRelevance(observerRelevance).catch(() => {});
    }
    return result;
  };

  prototype.reset = function workerAwareReset(seed = this.seed) {
    const bridge = this[BRIDGE] ?? null;
    const state = originalReset.call(this, seed);
    if (bridge) {
      bridge.pendingBeforeReady = 0;
      bridge.client.clearPendingAdvance();
      bridge.latestSnapshot = state;
      bridge.fidelity = originalFidelityDiagnostics.call(this);
      bridge.observerRelevance = {};
      bridge.client.reset(seed).catch(() => {});
    }
    return state;
  };

  prototype.seek = function workerAwareSeek(elapsedYears) {
    if (!canUseWorker()) return originalSeek.call(this, elapsedYears);
    const target = Math.max(0, Math.min(777000, Math.round(Number(elapsedYears) || 0)));
    const bridge = ensureBridge(this);

    // Keep seeking deterministic and immediately visible. It is a deliberate
    // user action rather than the continuous Play hot path, so recomputing from
    // the seed on the main thread is acceptable here and avoids stale PRNG state.
    originalReset.call(this, this.seed);
    const state = originalAdvance.call(this, target);

    if (bridge) {
      bridge.pendingBeforeReady = 0;
      bridge.client.clearPendingAdvance();
      bridge.latestSnapshot = state;
      bridge.fidelity = originalFidelityDiagnostics.call(this);
      bridge.client.reset(this.seed)
        .then(() => bridge.client.seek(target))
        .catch(() => {});
    }
    return state;
  };

  Object.defineProperty(prototype, INSTALL, { value: true });

  const originalSetSimulationPlaying = EarthView.prototype.setSimulationPlaying;
  EarthView.prototype.setSimulationPlaying = function workerAwarePlayingState(playing) {
    if (!playing) {
      for (const bridge of activeBridges) {
        bridge.pendingBeforeReady = 0;
        bridge.client.clearPendingAdvance();
      }
    }
    return originalSetSimulationPlaying.call(this, playing);
  };
}
