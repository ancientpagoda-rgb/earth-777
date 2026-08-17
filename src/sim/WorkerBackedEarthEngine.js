import { FreeEarthEngine } from "./free-earth.js";
import { SimulationWorkerClient } from "./SimulationWorkerClient.js";

export class WorkerBackedEarthEngine {
  constructor(seed = 777001, { onState = null, onError = null, worker = null } = {}) {
    this.seed = Number(seed) >>> 0;
    this.onState = onState;
    this.onError = onError;

    // Bootstrap once on the main thread so the globe can paint the exact
    // deterministic checkpoint immediately. Repeated simulation advances are
    // owned exclusively by the worker below.
    const bootstrap = new FreeEarthEngine(this.seed);
    this.state = bootstrap.snapshot();
    this.fidelity = bootstrap.fidelityDiagnostics();

    this.client = new SimulationWorkerClient({
      seed: this.seed,
      worker,
      onState: (result) => {
        this.state = result.state;
        this.fidelity = result.fidelity ?? this.fidelity;
        this.onState?.(result);
      },
      onFidelity: (fidelity) => {
        if (fidelity) this.fidelity = fidelity;
      },
      onError: (error) => this.onError?.(error)
    });
    this.ready = this.client.ready.then((result) => {
      this.state = result.state;
      this.fidelity = result.fidelity ?? this.fidelity;
      return result;
    });
  }

  snapshot() {
    return this.state;
  }

  fidelityDiagnostics() {
    return this.fidelity ?? { targets: [] };
  }

  advance(years) {
    this.client.queueAdvance(years);
    return this.state;
  }

  clearPendingAdvance() {
    this.client.clearPendingAdvance();
  }

  seek(elapsedYears) {
    this.client.seek(elapsedYears).catch((error) => this.onError?.(error));
    return this.state;
  }

  reset(seed = this.seed) {
    this.seed = Number(seed) >>> 0;
    this.client.clearPendingAdvance();

    // Reset is user-triggered and rare. A local bootstrap gives immediate,
    // deterministic reset visuals while the worker resets its authoritative
    // active engine in parallel.
    const bootstrap = new FreeEarthEngine(this.seed);
    this.state = bootstrap.snapshot();
    this.fidelity = bootstrap.fidelityDiagnostics();
    this.client.reset(this.seed).catch((error) => this.onError?.(error));
    return this.state;
  }

  setObserverRelevance(observerRelevance = {}) {
    this.client.setObserverRelevance(observerRelevance).catch((error) => this.onError?.(error));
    return this.fidelityDiagnostics();
  }

  workerDiagnostics() {
    return this.client.diagnostics();
  }

  dispose() {
    this.client.dispose();
  }
}
